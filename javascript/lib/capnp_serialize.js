/*
 * Copyright (c) 2013, Julian Scheid <julians37@gmail.com>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

goog.provide('capnp.serialize');

goog.require('capnp.message');
goog.require('kj.io');

capnp.serialize.writeMessageSegments = function(output, arg) {
  var segments;
  if (goog.isArray(arg)) {
    segments = arg;
  }
  else {
    segments = arg.getSegmentsForOutput();
  }

  var headerNumInt32Values = (segments.length + 2) & ~1;
  var headerBuffer = new ArrayBuffer(headerNumInt32Values * 4);
  var headerView = new DataView(headerBuffer);

  // We write the segment count - 1 because this makes the first
  // word zero for single-segment messages, improving
  // compression.  We don't bother doing this with segment sizes
  // because one-word segments are rare anyway.

  headerView.setUint32(0, (segments.length - 1), true);

  for (var i = 0, len = segments.length; i < len; ++i) {
    headerView.setUint32((i + 1) << 2, segments[i].byteLength >> 3, true);
  }

  output.write(headerBuffer, 0, headerBuffer.byteLength);

  for (var i = 0, len = segments.length; i < len; ++i) {
    output.write(segments[i].buffer, segments[i].byteOffset, segments[i].byteLength);
  }
};


capnp.serialize.messageToFlatArray = function(segments) {

  kj.debug.REQUIRE(segments.length > 0, 'Tried to serialize uninitialized message.');

  var totalSize = (segments.length >>> 1) + 1;

  for (var i = 0, len = segments.length; i < len; ++i) {
    kj.debug.REQUIRE(segments[i].byteLength % 8 === 0, 'Segment byte length not a multiple of 8');
    totalSize += segments[i].byteLength >> 3;
  }

  var buffer = new ArrayBuffer(totalSize * capnp.common.BYTES_PER_WORD);
  var result = new DataView(buffer);

  var table = new Uint32Array(buffer); // FIXME: endian-ness

  // We write the segment count - 1 because this makes the first word zero for single-segment
  // messages, improving compression.  We don't bother doing this with segment sizes because
  // one-word segments are rare anyway.
  table[0] = segments.length - 1;

  for (var i = 0, len = segments.length; i < len; ++i) {
    table[i + 1] = segments[i].byteLength >> 3;
  }

  if (segments.length % 2 === 0) {
    // Set padding byte.
    table[segments.length + 1] = 0;
  }

  var dst = ((segments.length >>> 1) + 1) << 1;

  for (var i = 0, len = segments.length; i < len; ++i) {
    var segment = segments[i];
    new Uint8Array(buffer).set(new Uint8Array(segment.buffer, segment.byteOffset, segment.byteLength), dst << 2);
    //table.set(new Uint32Array(segment.buffer, segment.byteOffset, segment.byteLength >> 2), dst); // FIXME: endian-ness
    dst += (segment.byteLength >> 2);
  }

  kj.debug.DASSERT((dst << 2) === buffer.byteLength, 'Buffer overrun/underrun bug in code above.');

  return buffer;
};

/**
 * @constructor
 * @extends capnp.message.MessageReader
 */
capnp.serialize.InputStreamMessageReader = function(inputStream, options, scratchSpace) {

  capnp.message.MessageReader.call(this, options);

  var firstWordBuffer = new ArrayBuffer(8);
  var firstWordView = new DataView(firstWordBuffer);
  inputStream.read(firstWordBuffer, 0, 8);
  var segmentCount = firstWordView.getUint32(0, true) + 1;

  var segment0Size = segmentCount == 0 ? 0 : firstWordView.getUint32(4, true);

  var totalWords = segment0Size;
  var ownedSpace = null;

  // Reject messages with too many segments for security reasons.
  if (segmentCount >= 512) {
    console.error('Message has too many segments.');
    segmentCount = 1;
    segment0Size = 1;
  }

  // Read sizes for all segments except the first.  Include padding if necessary.
  var moreSizes = new ArrayBuffer((segmentCount & ~1) * 4);
  var moreSizesArray;
  if (segmentCount > 1) {
    moreSizesArray = new DataView(moreSizes); // FIXME: endian-ness
    inputStream.read(moreSizes, 0, moreSizes.byteLength);
    for (var i = 0; i < segmentCount - 1; i++) {
      totalWords += moreSizesArray.getUint32(i * 4, true);
    }
  }

  // Don't accept a message which the receiver couldn't possibly traverse without hitting the
  // traversal limit.  Without this check, a malicious client could transmit a very large segment
  // size to make the receiver allocate excessive space and possibly crash.
  kj.debug.REQUIRE(totalWords <= this.options.traversalLimitInWords,
                   'Message is too large.  To increase the limit on the receiving end, see capnp::ReaderOptions.');

  if (!scratchSpace || scratchSpace.byteLength < totalWords * 8) {
    // TODO(perf):  Consider allocating each segment as a separate chunk to reduce memory
    //   fragmentation.
    ownedSpace = new ArrayBuffer(totalWords * 8);
    scratchSpace = ownedSpace;
  }

  this.inputStream = inputStream;

  this.moreSegments = [];

  this.arena = null;
  this.options = { nestingLimit: 64 };

  this.readPos = 0;

  this.scratchSpace = scratchSpace;

  if (segmentCount > 1) {
    var offset = segment0Size;

    for (var i = 0; i < segmentCount - 1; i++) {
      var segmentSize = moreSizesArray.getUint32(i * 4, true);
      this.moreSegments.push(new DataView(scratchSpace, offset * 8, segmentSize * 8));
      offset += segmentSize;
    }
  }

  if (segmentCount == 1) {
    this.inputStream.read(scratchSpace, 0, totalWords * 8);
  } else if (segmentCount > 1) {
    this.readPos = 0;
    this.readPos += this.inputStream.read(scratchSpace, 0, segment0Size * 8, totalWords * 8);
  }

  this.segment0 = new DataView(this.scratchSpace, 0, segment0Size * 8);
};

goog.inherits(capnp.serialize.InputStreamMessageReader, capnp.message.MessageReader);

capnp.serialize.InputStreamMessageReader.prototype.getSegment = function(id) {

  if (id > this.moreSegments.length) {
    return null;
  }

  var segment = id == 0 ? this.segment0 : this.moreSegments[id - 1];

  if (this.readPos != 0) {

    // May need to lazily read more data.
    var segmentEnd = segment.byteOffset + segment.byteLength;
    if (this.readPos < segmentEnd) {
      // Note that lazy reads only happen when we have multiple segments, so moreSegments.back() is
      // valid.
      var lastSegment = this.moreSegments[this.moreSegments.length - 1];
      var allEnd = lastSegment.byteOffset + lastSegment.byteLength;
      this.readPos += this.inputStream.read(this.scratchSpace, this.readPos, segmentEnd - this.readPos, allEnd - this.readPos);
    }
  }

  return segment;

};

capnp.serialize.InputStreamMessageReader.prototype.toString = function() {
  return 'InputStreamMessageReader{...}';
};

// var fs = require('fs');

// /**
//  * @constructor
//  */
// var FdInputStream = function(fd) {
//     exports.InputStream.call(this);
//     this.fd = fd;
// };
// FdInputStream.prototype = Object.create(kj.io.InputStream.prototype);
// FdInputStream.prototype.constructor = FdInputStream;
// FdInputStream.prototype.tryRead = function(buffer, offset, minBytes, maxBytes) {
//     var nodeBuffer = new Buffer(minBytes);
//     var count = fs.readSync(this.fd, nodeBuffer, 0, minBytes);
//     for (var i = 0; i < minBytes; ++i) {
//         buffer[offset + i] = nodeBuffer[i];
//     }
//     return count;
// };

// /**
//  * @constructor
//  */
// capnp.serialize.StreamFdMessageReader = function(fd, options, scratchSpace) {
//     capnp.serialize.InputStreamMessageReader.call(this, new FdInputStream(fd), options, scratchSpace);
// };
// capnp.serialize.StreamFdMessageReader.prototype = Object.create(capnp.serialize.InputStreamMessageReader.prototype);
// capnp.serialize.StreamFdMessageReader.prototype.constructor = capnp.serialize.StreamFdMessageReader;

// /**
//  * @constructor
//  */
// capnp.serialize.NodeJsBufferMessageReader = function(buffer, options) {

//     if (options) {
//         this.options = options;
//     }
//     else {
//         this.options = defaultReaderOptions;
//     }

//     var segmentCount = buffer.readUInt32LE(0) + 1;

//     // Reject messages with too many segments for security reasons.
//     kj.debug.REQUIRE(segmentCount < 512, 'Message has too many segments.');

//     var segmentSizes = [];
//     var totalWords = 0;
//     for (var i = 0; i < segmentCount; ++i) {
//         segmentSizes[i] = buffer.readUInt32LE((i + 1) * 4, true);
//         totalWords += segmentSizes[i];
//     }

//     // Don't accept a message which the receiver couldn't possibly traverse without hitting the
//     // traversal limit.  Without this check, a malicious client could transmit a very large segment
//     // size to make the receiver allocate excessive space and possibly crash.
//     if (totalWords > this.options.traversalLimitInWords) {
//         console.error('Message is too large.  To increase the limit on the receiving end, see capnp::ReaderOptions.');
//     }

//     var offset = 8 + ((segmentCount & ~1) * 4);
//     var segments = [];
//     for (var i = 0; i < segmentCount; i++) {

//         segments.push(new DataView(new Uint8Array(buffer).buffer, offset, segmentSizes[i] * 8));

//         offset += segmentSizes[i];
//     }

//     this.getSegment = function(id) {

//         if (id <= segments.length) {
//             return segments[id];
//         }
//         else {
//             return null;
//         }
//     };

//     this.toString = function() {
//         return 'NodeJsBufferMessageReader{...}';
//     };

//     return this;
// };
// capnp.serialize.NodeJsBufferMessageReader.prototype = new capnp.message.MessageReader();

// capnp.serialize.writeMessageToFd = function(fd, object) {

//     var FdOutputStream = function() {};
//     FdOutputStream.prototype = Object.create(kj.io.OutputStream.prototype);
//     FdOutputStream.prototype.constructor = FdOutputStream;
//     FdOutputStream.prototype.write = function(buffer, offset, byteLength) {
//         var nodeBuffer = new Buffer(byteLength);
//         for (var i = 0; i < byteLength; ++i) {
//             nodeBuffer[i] = buffer[offset + i];
//         }
//         fs.writeSync(fd, nodeBuffer, 0, byteLength);
//     };

//     capnp.serialize.writeMessageSegments(new FdOutputStream(), object);
// };
