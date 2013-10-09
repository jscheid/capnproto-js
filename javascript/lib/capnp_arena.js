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

goog.provide('capnp.arena');

goog.require('goog.asserts');

goog.require('kj.util');


/**
 * @constructor
 */
capnp.arena.ReadLimiter = function() {
  this.unread = function(amount) { };
  this.toString = function() { return 'ReadLimiter{...}'; };
  return this;
};

/**
 * @constructor
 */
capnp.arena.SegmentReader = function(arena, id, segment, readLimiter) {

  goog.asserts.assert(kj.util.isDataView(segment), 'expected dataView but got ' + segment);

  var uint8Array = null;

  this.getArena = function() { return arena; };

  this.createWirePointerAt = function(offset) {
    goog.asserts.assert(kj.util.isRegularNumber(offset) && offset >= 0);
    return new capnp.layout.WirePointer(offset, this.createSubDataView(offset, 8));
  };

  this.containsInterval = function(start, end) {
    kj.util.warnOnce('containsInterval not yet implemented');
    return true;
  };

  this.toString = function() {
    return 'SegmentReader{id=' + id + '}';
  };

  this.unread = function(amount) {
    readLimiter.unread(amount);
  };

  this.getDataView = function() {
    return segment;
  };

  this.createSubDataView = function(offset, length) {
    goog.asserts.assert(offset + length <= segment.byteLength);
    return new DataView(segment.buffer, segment.byteOffset + offset, length);
  };

  this.getUint8Array = function() {
    if (uint8Array === null) {
      uint8Array = new Uint8Array(segment.buffer, segment.byteOffset, segment.byteLength);
    }
    return uint8Array;
  };
};


/**
 * @constructor
 */
capnp.arena.SegmentBuilder = function(arena, id, segment, readLimiter) {

  capnp.arena.SegmentReader.call(this, arena, id, segment, readLimiter);

  goog.asserts.assert(arena, 'SegmentBuilder constructor got invalid arena: ' + arena);
  goog.asserts.assert(typeof(id) === 'number', 'SegmentBuilder constructor got invalid id: ' + id);
  goog.asserts.assert(segment, 'SegmentBuilder constructor got invalid segment: ' + segment);
  goog.asserts.assert(readLimiter, 'SegmentBuilder constructor got invalid readLimiter: ' + readLimiter);

  goog.asserts.assert(segment instanceof DataView, 'SegmentBuilder constructor got invalid segment: ' + segment);

  this.getSegmentId = function() { return id; };
  this.getArena = function() { return arena; };

  var pos = 0;

  this.allocate = function(amount) {

    goog.asserts.assert(amount % 1 == 0, 'SegmentBuilder.allocate asked to allocate fractional amount: ' + amount);
    goog.asserts.assert(amount >= 0, 'SegmentBuilder.allocate asked to zero or negative amount: ' + amount);

    var newPos = pos + amount * capnp.common.BYTES_PER_WORD;

    if (newPos <= segment.byteLength) {
      var result = pos;
      pos = newPos;
      return result >>> 3;
    }
    else {
      // Not enough space in the segment for this allocation.
      return null;
    }
  };

  this.validateIntegrity = function() {

    var uint8Array = this.getUint8Array();
    for (var i = pos; i < segment.byteLength; ++i) {
      if (uint8Array[i] != 0) {
        throw new Error('free space unclean at ' + i);
      }
    }
  };

  this.currentlyAllocated = function() {
    return this.createSubDataView(0, pos);
  };

  this.toString = function() {
    return 'SegmentBuilder{id=' + id + '}';
  };

  return this;
};
capnp.arena.SegmentBuilder.prototype = Object.create(capnp.arena.SegmentReader.prototype);


/**
 * @constructor
 */
capnp.arena.BuilderArena = function(message) {

  goog.asserts.assert(message, 'BuilderArena constructor got invalid message: ' + message);

  var segment0 = null;
  var builders = [];
  var dummyLimiter = new capnp.arena.ReadLimiter();

  this.tryGetSegment = function(id) {
    if (id == 0) {
      return segment0;
    }
    else if (id <= builders.length) {
      return builders[id - 1];
    }
    else {
      return null;
    }
  };

  this.getSegment = function(id) {
    // This method is allowed to fail if the segment ID is not valid.
    if (id == 0) {
      return segment0;
    } else {
      kj.debug.REQUIRE(id - 1 < builders.length, 'invalid segment id ' + id + ' (have ' + (1 + builders.length) + ' segments)');
      // TODO(cleanup):  Return a const SegmentBuilder and tediously constify all SegmentBuilder
      //   pointers throughout the codebase.
      return builders[id - 1];
    }
  };

  this.allocate = function(amount) {

    if (!segment0) {
      // We're allocating the first segment.

      var ptr = message.allocateSegment(amount);
      segment0 = new capnp.arena.SegmentBuilder(this, 0, ptr, dummyLimiter);
      return { segment: segment0, words: segment0.allocate(amount) };
    }
    else {
      // Check if there is space in the first segment.  We can do this without locking.
      var attempt = segment0.allocate(amount);
      if (attempt !== null) {
        return { segment: segment0, words: attempt };
      }

      // Need to fall back to additional segments.

      if (builders.length > 0) {
        attempt = builders[builders.length - 1].allocate(amount);
        if (attempt !== null) {
          return { segment: builders[builders.length - 1], words: attempt };
        }
      }

      var newBuilder = new capnp.arena.SegmentBuilder(this, builders.length + 1, message.allocateSegment(amount), dummyLimiter);
      builders.push(newBuilder);

      // Allocating from the new segment is guaranteed to succeed since no other thread could have
      // received a pointer to it yet (since we still hold the lock).
      return { segment: newBuilder, words: newBuilder.allocate(amount) };
    }
  };

  this.getSegmentsForOutput = function() {
    var result = [segment0.currentlyAllocated()];
    for (var i = 0, len = builders.length; i < len; i++) {
      result.push(builders[i].currentlyAllocated());
    }
    return result;
  };

  this.toString = function() { return 'BuilderArena{...}; ' };

  this.getSegment0 = function() { return segment0; };

  return this;
};

/**
 * @constructor
 */
capnp.arena.ReaderArena = function(message) {

  if (!kj.util.isDataView(message.getSegment(0))) {
    throw new Error('not a dataview: ' + message);
  }

  var readLimiter = new capnp.arena.ReadLimiter();
  var segment0 = new capnp.arena.SegmentReader(this, 0, message.getSegment(0), readLimiter);
  var segments = {};

  this.tryGetSegment = function(id) {

    if (id == 0) {
      return segment0;
    }
    else if (segments.hasOwnProperty(id)) {
      return segments[id];
    }
    else {
      var newSegment = message.getSegment(id);
      if (newSegment === null) {
        return null;
      }
      if (newSegment === undefined) {
        goog.asserts.assert(false);
      }

      var segment = new capnp.arena.SegmentReader(this, id, newSegment, readLimiter);
      segments[id] = segment;
      return segment;
    }
  };

  this.reportReadLimitReached = function() {
  };

};
