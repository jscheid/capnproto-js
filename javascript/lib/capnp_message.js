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

goog.provide('capnp.message');

goog.require('kj.debug');

var defaultReaderOptions = {
  traversalLimitInWords: 8 * 1024 * 1024,
  nestingLimit: 64
};

/**
 * @enum {number}
 */
capnp.message.AllocationStrategy = {

  FIXED_SIZE: 0,
  // The builder will prefer to allocate the same amount of space for each segment with no
  // heuristic growth.  It will still allocate larger segments when the preferred size is too small
  // for some single object.  This mode is generally not recommended, but can be particularly useful
  // for testing in order to force a message to allocate a predictable number of segments.  Note
  // that you can force every single object in the message to be located in a separate segment by
  // using this mode with firstSegmentWords = 0.

  GROW_HEURISTICALLY: 1
  // The builder will heuristically decide how much space to allocate for each segment.  Each
  // allocated segment will be progressively larger than the previous segments on the assumption
  // that message sizes are exponentially distributed.  The total number of segments that will be
  // allocated for a message of size n is O(log n).
};

/**
 * @constructor
 */
capnp.message.MessageReader = function(options) {

  this.options = {};
  this.options.traversalLimitInWords = (options && options.traversalLimitInWords) || defaultReaderOptions.traversalLimitInWords;
  this.options.nestingLimit = (options && options.nestingLimit) || defaultReaderOptions.nestingLimit;

  return this;
};

capnp.message.MessageReader.prototype.getRootInternal = function() {
  if (!this.arena) {
    this.arena = new capnp.arena.ReaderArena(this);
  }

  var segment = this.arena.tryGetSegment(0);

  /*
    KJ_REQUIRE(segment != nullptr &&
    segment->containsInterval(segment->getStartPtr(), segment->getStartPtr() + 1),
    "Message did not contain a root pointer.") {
    return _::StructReader();
    }
  */

  return capnp.layout.StructReader.readRoot(0, segment, this.options.nestingLimit);
};

capnp.message.MessageReader.prototype.getRoot = function(RootType) {
  return new RootType.Reader(this.getRootInternal());
};

/**
 * @constructor
 * @extends capnp.message.MessageReader
 */
capnp.message.SegmentArrayMessageReader = function(segments, options) {
  capnp.message.MessageReader.call(this, options);
  this.segments = segments;
};

goog.inherits(capnp.message.SegmentArrayMessageReader, capnp.message.MessageReader);

capnp.message.SegmentArrayMessageReader.prototype.getSegment = function(id) {

  if (id < this.segments.length) {
    return this.segments[id];
  }
  else {
    return null;
  }
};

capnp.message.SegmentArrayMessageReader.prototype.toString = function() {
  return 'SegmentArrayMessageReader{...}';
};


/**
 * @constructor
 * @extends capnp.message.MessageReader
 */
capnp.message.FlatArrayMessageReader = function(arrayBuffer, options) {

  capnp.message.MessageReader.call(this, options);

  kj.debug.REQUIRE(kj.util.isArrayBuffer(arrayBuffer), 'FlatArrayMessageReader argument must be an ArrayBuffer');

  var arraySize = arrayBuffer.byteLength >>> 3;

  if (arraySize < 1) {
    // Assume empty message.
    return;
  }

  var table = new Uint32Array(arrayBuffer);

  var segmentCount = table[0] + 1;
  var offset = (segmentCount >>> 1) + 1;
  this.moreSegments = [];

  kj.debug.REQUIRE(arraySize >= offset, 'Message ends prematurely in segment table.');

  if (segmentCount === 0) {
    return;
  }

  var segmentSize = table[1];

  kj.debug.REQUIRE(arraySize >= offset + segmentSize,
                   'Message ends prematurely in first segment.');

  this.segment0 = new DataView(arrayBuffer, offset << 3, segmentSize << 3);
  offset += segmentSize;

  if (segmentCount > 1) {
    this.moreSegments = [];

    for (var i = 1; i < segmentCount; i++) {
      var segmentSize = table[i + 1];

      kj.debug.REQUIRE(arraySize >= offset + segmentSize, 'Message ends prematurely.');

      this.moreSegments[i - 1] = new DataView(arrayBuffer, offset << 3, segmentSize << 3);
      offset += segmentSize;
    }
  }
}

goog.inherits(capnp.message.FlatArrayMessageReader, capnp.message.MessageReader);

capnp.message.FlatArrayMessageReader.prototype.getSegment = function(id) {
  if (id == 0) {
    return this.segment0;
  } else if (id <= this.moreSegments.length) {
    return this.moreSegments[id - 1];
  } else {
    return null;
  }
};

/**
 * @constructor
 */
capnp.message.MessageBuilder = function() {
  this.arena = null;
}

capnp.message.MessageBuilder.prototype.getRootSegment = function() {
  if (this.arena) {
    return this.arena.getSegment(0);
  }
  else {
    this.arena = new capnp.arena.BuilderArena(this);
    var allocation = this.arena.allocate(capnp.common.POINTER_SIZE_IN_WORDS);
    return allocation.segment;
  }
};

capnp.message.MessageBuilder.prototype.getArena = function() {
  return this.arena;
};

capnp.message.MessageBuilder.prototype.getSegmentsForOutput = function() {
  if (this.arena) {
    return this.arena.getSegmentsForOutput();
  } else {
    return null;
  }
};

/**
 * @constructor
 * @extends capnp.message.MessageBuilder
 */
capnp.message.MallocMessageBuilder = function(firstSegmentWords, allocationStrategy) {

  var SUGGESTED_ALLOCATION_STRATEGY = capnp.message.AllocationStrategy.GROW_HEURISTICALLY;

  if (firstSegmentWords === undefined) {
    firstSegmentWords = 1024;
  }
  if (allocationStrategy === undefined) {
    allocationStrategy = SUGGESTED_ALLOCATION_STRATEGY;
  }
  this.allocationStrategy = allocationStrategy;

  var self = this;
  this.nextSize = firstSegmentWords;
  this.ownFirstSegment = true;
  this.returnedFirstSegment = false;
  this.firstSegment = null;
  this.moreSegments = [];
};

goog.inherits(capnp.message.MallocMessageBuilder, capnp.message.MessageBuilder);

capnp.message.MallocMessageBuilder.prototype.initRoot = function(RootType) {

  var self = this;
  var initRootWithSize = function(structSize) {
    goog.asserts.assert(structSize instanceof capnp.layout.StructSize, 'initRootWithSize got invalid structSize: ' + structSize);
    var rootSegment = self.getRootSegment();
    return capnp.layout.StructBuilder.initRoot(rootSegment, 0, structSize);
  };

  return new RootType.Builder(initRootWithSize(RootType.STRUCT_SIZE)); //RootType.StructBuilder.initRoot(rootSegment, rootSegment.dataView, 0));
};

capnp.message.MallocMessageBuilder.prototype.setRootInternal = function(reader) {
  var rootSegment = this.getRootSegment();
  capnp.layout.StructBuilder.setRoot(rootSegment, 0, reader);
};

capnp.message.MallocMessageBuilder.prototype.setRoot = function(value) {
  /* FIXME
     typedef FromReader<Reader> RootType;
     static_assert(kind<RootType>() == Kind::STRUCT,
     "Parameter must be a Reader for a Cap'n Proto struct type.");
  */
  this.setRootInternal(value._getReader());
};

capnp.message.MallocMessageBuilder.prototype.getRoot = function(RootType) {
  var rootSegment = this.getRootSegment();
  return new RootType.Builder(capnp.layout.StructBuilder.getRoot(rootSegment, 0, RootType.STRUCT_SIZE));
};

capnp.message.MallocMessageBuilder.prototype.adoptRoot = function(orphan) {
  throw new Error("NYI");
};

capnp.message.MallocMessageBuilder.prototype.getOrphanage = function() {
  if (!this.arena) this.getRootSegment();

  return new capnp.orphan.Orphanage(this.arena);
};

capnp.message.MallocMessageBuilder.prototype.allocateSegment = function(minimumSize) {

  var size = Math.max(minimumSize, this.nextSize);

  var result = new ArrayBuffer(size * capnp.common.BYTES_PER_WORD);

  if (!this.returnedFirstSegment) {
    this.firstSegment = result;
    this.returnedFirstSegment = true;

    // After the first segment, we want nextSize to equal the total size allocated so far.
    if (this.allocationStrategy === capnp.message.AllocationStrategy.GROW_HEURISTICALLY) this.nextSize = size;
  } else {
    this.moreSegments.push(result);
    if (this.allocationStrategy === capnp.message.AllocationStrategy.GROW_HEURISTICALLY) this.nextSize += size;
  }

  return new DataView(result);
};


capnp.message.readMessageUnchecked = function(type, data) {
  return new type.Reader(capnp.layout.StructReader.readRootUnchecked(data));
};

capnp.message.SUGGESTED_FIRST_SEGMENT_WORDS = 1024;
