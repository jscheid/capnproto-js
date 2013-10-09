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

goog.provide('capnp.packed');

goog.require('kj.debug');
goog.require('kj.io');
goog.require('kj.util');
goog.require('goog.asserts');
goog.require('capnp.common');
goog.require('capnp.serialize');

/**
 * @constructor
 */
capnp.packed.PackedOutputStream = function(inner) {
  kj.io.OutputStream.call(this);
  this.inner = inner;
};
capnp.packed.PackedOutputStream.prototype = Object.create(kj.io.OutputStream.prototype);
capnp.packed.PackedOutputStream.prototype.constructor = capnp.packed.PackedOutputStream;
capnp.packed.PackedOutputStream.prototype.write = function(src, offset, size) {

  goog.asserts.assert(kj.util.isArrayBuffer(src), 'PackedOutputStream.write requires ArrayBuffer as first argument');
  goog.asserts.assert(kj.util.isRegularNumber(offset), 'PackedOutputStream.write requires numeric offset as second argument');
  goog.asserts.assert(kj.util.isRegularNumber(size), 'PackedOutputStream.write requires numeric size as third argument');
  goog.asserts.assert(offset + size <= src.byteLength, 'PackedOutputStream.write asked to access buffer beyond end; byteLength=' + src.byteLength + ', offset=' + offset + ', size=' + size);

  var buffer = this.inner.getWriteBuffer();
  var slowBuffer = new ArrayBuffer(20);

  var inArray = new Uint8Array(src, offset, size);

  var inPos = 0;
  var outPos = 0;

  while (inPos < size) {

    if (buffer.byteLength - outPos < 10) {
      // Oops, we're out of space.  We need at least 10 bytes for the fast path, since we don't
      // bounds-check on every byte.

      // Write what we have so far.
      this.inner.write(buffer, 0, outPos);

      // Use a slow buffer into which we'll encode 10 to 20 bytes.  This should get us past the
      // output stream's buffer boundary.
      outPos = 0;
    }

    var tagPos = outPos++;

    var tag = 0;
    for (var j = 0; j < 8; ++j) {
      var bit = inArray[inPos] != 0;
      buffer[outPos] = inArray[inPos];
      outPos += bit;
      ++inPos;
      tag |= bit << j;
    }

    buffer[tagPos] = tag;

    if (tag === 0) {
      // An all-zero word is followed by a count of consecutive zero words (not including the
      // first one).

      // We can check a whole word at a time.
      var inLong = new Uint32Array(src);
      var inLongPos = inPos >>> 3;

      // The count must fit it 1 byte, so limit to 255 words.
      var limit = size >>> 3;
      if (limit - inLongPos > 255) {
        limit = inLongPos + 255;
      }

      while (inLongPos < limit && inLong[inLongPos * 2 + 0] === 0 && inLong[inLongPos * 2 + 1] === 0) {
        ++inLongPos;
      }

      // Write the count.
      buffer[outPos++] = inLongPos - (inPos >>> 3);

      // Advance input.
      inPos = inLongPos << 3;

    } else if (tag === 0xff) {

      // An all-nonzero word is followed by a count of consecutive uncompressed words, followed
      // by the uncompressed words themselves.

      // Count the number of consecutive words in the input which have no more than a single
      // zero-byte.  We look for at least two zeros because that's the point where our compression
      // scheme becomes a net win.
      // TODO(perf):  Maybe look for three zeros?  Compressing a two-zero word is a loss if the
      //   following word has no zeros.
      var runStartPos = inPos;

      var limitPos = size;
      if (limitPos - inPos > 255 * capnp.common.BYTES_PER_WORD) {
        limitPos = inPos + 255 * capnp.common.BYTES_PER_WORD;
      }

      while (inPos < limitPos) {
        // Check eight input bytes for zeros.
        var c = inArray[inPos++] === 0;
        c += inArray[inPos++] === 0;
        c += inArray[inPos++] === 0;
        c += inArray[inPos++] === 0;
        c += inArray[inPos++] === 0;
        c += inArray[inPos++] === 0;
        c += inArray[inPos++] === 0;
        c += inArray[inPos++] === 0;

        if (c >= 2) {
          // Un-read the word with multiple zeros, since we'll want to compress that one.
          inPos -= 8;
          break;
        }
      }

      // Write the count.
      var count = inPos - runStartPos;

      buffer[outPos++] = count / 8;

      if (count <= buffer.byteLength - outPos) {
        // There's enough space to memcpy.
        buffer.set(inArray.subarray(runStartPos, runStartPos + count), outPos);
        outPos += count;
      } else {
        // Input overruns the output buffer.  We'll give it to the output stream in one chunk
        // and let it decide what to do.
        this.inner.write(buffer, 0, outPos);
        this.inner.write(runStartPos, 0, inPos - runStartPos);
        buffer = this.inner.getWriteBuffer();
        outPos = 0;
      }
    }
  }

  // Write whatever is left.
  this.inner.write(buffer, 0, outPos);
};

/**
 * @constructor
 */
capnp.packed.PackedInputStream = function(inner) {
  kj.io.InputStream.call(this);
  this.inner = inner;
};
capnp.packed.PackedInputStream.prototype = Object.create(kj.io.InputStream.prototype);
capnp.packed.PackedInputStream.prototype.constructor = capnp.packed.PackedInputStream;
capnp.packed.PackedInputStream.prototype.tryRead = function(dst, offset, minBytes, maxBytes) {

  if (maxBytes === 0) {
    return 0;
  }

  kj.debug.DREQUIRE(minBytes % capnp.common.BYTES_PER_WORD === 0, 'PackedInputStream reads must be word-aligned: ' + minBytes);
  kj.debug.DREQUIRE(maxBytes % capnp.common.BYTES_PER_WORD === 0, 'PackedInputStream reads must be word-aligned: ' + maxBytes);

  var outPos = offset;
  var outEnd = offset + maxBytes;
  var outMin = offset + minBytes;
  var outArray = new Uint8Array(dst);

  var buffer = this.inner.getReadBuffer();
  if (buffer.byteLength === 0) {
    return 0;
  }
  var inPos = 0;
  var inArray = new Uint8Array(buffer);

  var self = this;
  var REFRESH_BUFFER = function() {
    self.inner.skip(buffer.byteLength);
    buffer = self.inner.getReadBuffer();
    inArray = new Uint8Array(buffer);
    kj.debug.REQUIRE(buffer.byteLength > 0, 'Premature end of packed input.');
    inPos = 0;
  };

  var BUFFER_END = function() { return buffer.byteLength; };
  var BUFFER_REMAINING = function() { return BUFFER_END() - inPos; };

  for (;;) {
    var tag;

    kj.debug.DASSERT(outPos % capnp.common.BYTES_PER_WORD === 0,
                     'Output pointer should always be aligned here.');

    if (BUFFER_REMAINING() < 10) {

      if (outPos >= outMin) {
        // We read at least the minimum amount, so go ahead and return.
        this.inner.skip(inPos);
        return outPos - offset;
      }

      if (BUFFER_REMAINING() === 0) {
        REFRESH_BUFFER();
        continue;
      }

      // We have at least 1, but not 10, bytes available.  We need to read slowly, doing a bounds
      // check on each byte.

      tag = inArray[inPos++];

      for (var i = 0; i < 8; i++) {
        if (tag & (1 << i)) {
          if (BUFFER_REMAINING() === 0) {
            REFRESH_BUFFER();
          }
          outArray[outPos++] = inArray[inPos++];
        } else {
          outArray[outPos++] = 0;
        }
      }

      if (BUFFER_REMAINING() === 0 && (tag === 0 || tag === 0xff)) {
        REFRESH_BUFFER();
      }
    } else {

      tag = inArray[inPos++];

      for (var n = 0; n < 8; ++n) {
        var isNonzero = (tag & (1 << n)) != 0;
        outArray[outPos++] = inArray[inPos] & (isNonzero ? 0xff : 0x00);
        inPos += isNonzero;
      }
    }

    if (tag === 0) {
      kj.debug.DASSERT(BUFFER_REMAINING() > 0, 'Should always have non-empty buffer here.');

      var runLength = inArray[inPos++] * capnp.common.BYTES_PER_WORD;

      kj.debug.REQUIRE(runLength <= outEnd - outPos,
                       'Packed input did not end cleanly on a segment boundary.');
      for (var i = 0; i < runLength; ++i) {
        outArray[outPos + i] = 0;
      }
      outPos += runLength;

    } else if (tag === 0xff) {
      kj.debug.DASSERT(BUFFER_REMAINING() > 0, 'Should always have non-empty buffer here.');

      var runLength = inArray[inPos++] * capnp.common.BYTES_PER_WORD;

      kj.debug.REQUIRE(runLength <= outEnd - outPos,
                       'Packed input did not end cleanly on a segment boundary.');

      var inRemaining = BUFFER_REMAINING();
      if (inRemaining >= runLength) {
        // Fast path.
        outArray.set(inArray.subarray(inPos, inPos + runLength), outPos);
        outPos += runLength;
        inPos += runLength;
      } else {
        // Copy over the first buffer, then do one big read for the rest.
        outArray.set(inArray.subarray(inPos, inPos + inRemaining), outPos);
        outPos += inRemaining;
        runLength -= inRemaining;

        this.inner.skip(buffer.byteLength);
        this.inner.read(dst, outPos, runLength);
        outPos += runLength;

        if (outPos === outEnd) {
          return maxBytes;
        } else {
          buffer = this.inner.getReadBuffer();
          inArray = new Uint8Array(buffer);
          inPos = 0;

          // Skip the bounds check below since we just did the same check above.
          continue;
        }
      }
    }

    if (outPos === outEnd) {
      this.inner.skip(inPos);
      return maxBytes;
    }
  }

  kj.debug.FAIL_ASSERT("Can't get here.");
  return 0;  // GCC knows kj.debug.FAIL_ASSERT doesn't return, but Eclipse CDT still warns...
};

capnp.packed.PackedInputStream.prototype.skip = function(bytes) {

  if (bytes === 0) {
    return;
  }

  kj.debug.DREQUIRE(bytes % capnp.common.BYTES_PER_WORD === 0, 'PackedInputStream reads must be word-aligned: ' + bytes);

  var buffer = this.inner.getReadBuffer();
  var inPos = 0;
  var inArray = new Uint8Array(buffer);

  var self = this;
  var REFRESH_BUFFER = function() {
    self.inner.skip(self.buffer.byteLength);
    self.buffer = self.inner.getReadBuffer();
    inArray = new Uint8Array(buffer);
    kj.debug.REQUIRE(self.buffer.byteLength > 0, 'Premature end of packed input.');
    inPos = 0;
  };

  var BUFFER_END = function() { return buffer.byteLength; };
  var BUFFER_REMAINING = function() { return BUFFER_END() - inPos; };

  for (;;) {
    var tag;

    if (BUFFER_REMAINING() < 10) {
      if (BUFFER_REMAINING() === 0) {
        REFRESH_BUFFER();
        continue;
      }

      // We have at least 1, but not 10, bytes available.  We need to read slowly, doing a bounds
      // check on each byte.

      tag = inArray[inPos++];

      for (var i = 0; i < 8; i++) {
        if (tag & (1 << i)) {
          if (BUFFER_REMAINING() === 0) {
            REFRESH_BUFFER();
          }
          inPos++;
        }
      }
      bytes -= 8;

      if (BUFFER_REMAINING() === 0 && (tag === 0 || tag === 0xff)) {
        REFRESH_BUFFER();
      }
    } else {
      tag = inArray[inPos++];

      for (var n = 0; n < 8; ++n) {
        inPos += (tag & (1 << n)) != 0;
      }
      bytes -= 8;
    }


    if (tag === 0) {
      kj.debug.DASSERT(BUFFER_REMAINING() > 0, 'Should always have non-empty buffer here.');

      var runLength = inArray[inPos++] * capnp.common.BYTES_PER_WORD;

      kj.debug.REQUIRE(runLength <= bytes, 'Packed input did not end cleanly on a segment boundary.');

      bytes -= runLength;


    } else if (tag === 0xff) {
      kj.debug.DASSERT(BUFFER_REMAINING() > 0, 'Should always have non-empty buffer here.');

      var runLength = inArray[inPos++] * capnp.common.BYTES_PER_WORD;

      kj.debug.REQUIRE(runLength <= bytes, 'Packed input did not end cleanly on a segment boundary.');

      bytes -= runLength;

      var inRemaining = BUFFER_REMAINING();
      if (inRemaining > runLength) {
        // Fast path.
        inPos += runLength;
      } else {
        // Forward skip to the underlying stream.
        runLength -= inRemaining;
        this.inner.skip(buffer.byteLength + runLength);

        if (bytes === 0) {
          return;
        } else {
          buffer = this.inner.getReadBuffer();
          inArray = new Uint8Array(buffer);
          inPos = 0;

          // Skip the bounds check below since we just did the same check above.
          continue;
        }
      }
    }

    if (bytes === 0) {
      this.inner.skip(inPos);
      return;
    }
  }

  kj.debug.FAIL_ASSERT("Can't get here.");
};

capnp.packed.writePackedMessage = function(output, arg) {

  if (!(output instanceof kj.io.BufferedOutputStream)) {
    output = new kj.io.BufferedOutputStreamWrapper(output);
  }

  var segments;
  if (kj.util.isArray(arg)) {
    segments = arg;
  }
  else {
    segments = arg.getSegmentsForOutput();
  }

  var packedOutput = new capnp.packed.PackedOutputStream(output);
  capnp.serialize.writeMessageSegments(packedOutput, segments);
  output.flush();
};


/**
 * @constructor
 */
capnp.packed.PackedMessageReader = function(inputStream, options, scratchSpace) {
  capnp.serialize.InputStreamMessageReader.call(this, new capnp.packed.PackedInputStream(inputStream), options, scratchSpace);
};
capnp.packed.PackedMessageReader.prototype = Object.create(capnp.serialize.InputStreamMessageReader.prototype);
capnp.packed.PackedMessageReader.prototype.constructor = capnp.packed.PackedMessageReader;
