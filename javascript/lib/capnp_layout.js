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

goog.provide('capnp.layout');

goog.require('capnp.arena');
goog.require('capnp.common');
goog.require('kj.util');

var boundsCheck = function(segment, start, end) {
  // If segment is null, this is an unchecked message, so we
  // don't do bounds checks.
  return segment === null || segment.containsInterval(start, end);
};

var checkAlignment = function(segment, ptr) {
  // FIXME:
  // KJ_DASSERT((uintptr_t)ptr % sizeof(void*) === 0,
  //            "Pointer section of struct list element not aligned.");
  return segment.createWirePointerAt(ptr);
};

function memcpy(destSegment, destOffset, srcSegment, srcOffset, numBytes) {

  var destUint8Array = destSegment.getUint8Array();
  var srcUint8Array = srcSegment.getUint8Array();

  destUint8Array.set(srcUint8Array.subarray(
    srcOffset, srcOffset + numBytes), destOffset);
}

function memclear(destSegment, destOffset, numBytes) {

  goog.asserts.assert(kj.util.isRegularNumber(destOffset));
  goog.asserts.assert(kj.util.isRegularNumber(numBytes));

  var destUint8Array = destSegment.getUint8Array();
  for (var i = destOffset, end = destOffset + numBytes; i < end; ++i) {
    destUint8Array[i] = 0;
  }
}

/**
 *  @param {capnp.layout.SegmentBuilder} segment
 *  @param {capnp.layout.WirePointer} ref
 */
var zeroPointerAndFars = function(segment, ref) {
  // Zero out the pointer itself and, if it is a far pointer, zero the landing pad as well, but
  // do not zero the object body.  Used when upgrading.

  if (ref.kind() === capnp.layout.Kind.FAR) {
    var padSegment = segment.getArena().getSegment(ref.farRef().segmentId);
    var pad = ref.farPositionInSegment();
    memclear(padSegment, pad << 3, capnp.layout.WirePointer.SIZE_IN_BYTES * (1 + (ref.isDoubleFar() ? 1 : 0)));
  }
  ref.clear();
};

/**
 *  @param {capnp.layout.SegmentBuilder} segment
 *  @param {capnp.layout.WirePointer} ref
 */
var zeroObject = function(segment, ref) {
  // Zero out the pointed-to object.  Use when the pointer is about to be overwritten making the
  // target object no longer reachable.

  switch (ref.kind()) {
  case capnp.layout.Kind.STRUCT:
    zeroObjectTag(segment, ref, ref.target());
    break;
  case capnp.layout.Kind.LIST:
    zeroObjectTag(segment, ref, ref.target());
    break;
  case capnp.layout.Kind.FAR: {
    segment = segment.getArena().getSegment(ref.farRef().segmentId);
    var pad = segment.createWirePointerAt(ref.farPositionInSegment() << 3);

    if (ref.isDoubleFar()) {
      var pad1 = segment.createWirePointerAt((ref.farPositionInSegment() + 1) << 3);
      segment = segment.getArena().getSegment(pad.farRef().segmentId);
      zeroObject(segment, pad1, pad.farPositionInSegment());
      memclear(segment, pad.getByteOffset(), 0, capnp.layout.WirePointer.SIZE_IN_BYTES * 2);
    } else {
      zeroObject(segment, pad);
      memclear(segment, pad.getByteOffset(), 0, capnp.layout.WirePointer.SIZE_IN_BYTES);
    }
    break;
  }
  case capnp.layout.Kind.RESERVED_3:
    kj.debug.FAIL_ASSERT("Don't know how to handle RESERVED_3.");
    break;
  }
};

/**
 *  @param {capnp.layout.SegmentBuilder} segment
 *  @param {capnp.layout.WirePointer} tag
 *  @param {Pointer} ptr
 */
var zeroObjectTag = function(segment, tag, ptr) {
  goog.asserts.assert(kj.util.isRegularNumber(ptr) && ptr >= 0);
  switch (tag.kind()) {
  case capnp.layout.Kind.STRUCT: {
    var pointerSection = ptr + tag.getStructRef().dataSize();
    var count = tag.getStructRef().ptrCount();
    for (var i = 0; i < count; i++) {
      zeroObject(segment, segment.createWirePointerAt((pointerSection + i) << 3));
    }
    memclear(segment, ptr << 3, tag.getStructRef().wordSize() * capnp.common.BYTES_PER_WORD);
    break;
  }
  case capnp.layout.Kind.LIST: {
    switch (tag.getListRef().elementSize()) {
    case capnp.layout.FieldSize.VOID:
      // Nothing.
      break;
    case capnp.layout.FieldSize.BIT:
    case capnp.layout.FieldSize.BYTE:
    case capnp.layout.FieldSize.TWO_BYTES:
    case capnp.layout.FieldSize.FOUR_BYTES:
    case capnp.layout.FieldSize.EIGHT_BYTES:
      memclear(segment, ptr << 3,
               capnp.common.roundBitsUpToWords(tag.getListRef().elementCount() *
                                               capnp.layout.dataBitsPerElement(tag.getListRef().elementSize()))
               * capnp.common.BYTES_PER_WORD);
      break;
    case capnp.layout.FieldSize.POINTER: {
      var count = tag.getListRef().elementCount();
      for (var i = 0; i < count; i++) {
        zeroObject(segment, segment.createWirePointerAt((ptr + i) << 3));
      }
      memclear(segment, ptr << 3, capnp.common.POINTER_SIZE_IN_WORDS * count * capnp.common.BYTES_PER_WORD);
      break;
    }
    case capnp.layout.FieldSize.INLINE_COMPOSITE: {
      var elementTag = segment.createWirePointerAt(ptr << 3);

      goog.asserts.assert(elementTag.kind() === capnp.layout.Kind.STRUCT,
                          "Don't know how to handle non-STRUCT inline composite.");

      var dataSize = elementTag.getStructRef().dataSize();
      var pointerCount = elementTag.getStructRef().ptrCount();

      var pos = ptr + capnp.common.POINTER_SIZE_IN_WORDS;
      var count = elementTag.inlineCompositeListElementCount();
      for (var i = 0; i < count; i++) {
        pos += dataSize;

        for (var j = 0; j < pointerCount; j++) {
          zeroObject(segment, segment.createWirePointerAt(pos << 3));
          pos += capnp.common.POINTER_SIZE_IN_WORDS;
        }
      }

      memclear(segment, ptr << 3, (elementTag.getStructRef().wordSize() * count + capnp.common.POINTER_SIZE_IN_WORDS)
               * capnp.common.BYTES_PER_WORD);
      break;
    }
    }
    break;
  }
  case capnp.layout.Kind.FAR:
    kj.debug.FAIL_ASSERT('Unexpected FAR pointer.');
    break;
  case capnp.layout.Kind.RESERVED_3:
    kj.debug.FAIL_ASSERT("Don't know how to handle RESERVED_3.");
    break;
  }
};


var copyStruct = function(dstSegment, dst, srcSegment, src, dataSize, pointerCount) {

  var dstUint8Array = dstSegment.getUint8Array();
  var srcUint8Array = srcSegment.getUint8Array();
  dstUint8Array.set(srcUint8Array.subarray(src << 3, (src << 3) + dataSize * capnp.common.BYTES_PER_WORD), dst << 3);

  for (var i = 0; i < pointerCount; i++) {
    var srcRef = srcSegment.createWirePointerAt((src + dataSize + i) << 3);
    var dstRef = dstSegment.createWirePointerAt((dst + dataSize + i) << 3);
    copyMessage(dstSegment, dstRef, srcSegment, srcRef);
  }
};

var copyMessage = function(segment, dst, srcSegment, src) {
  // Not always-inline because it's recursive.

  goog.asserts.assert(dst.kind() != capnp.layout.Kind.RESERVED_3, 'invalid pointer: ' + dst);

  switch (src.kind()) {
  case capnp.layout.Kind.STRUCT: {
    if (src.isNull()) {
      var uint8Array = segment.getUint8Array();
      for (var i = 0; i < capnp.common.BYTES_PER_WORD; ++i) {
        uint8Array[dst.getByteOffset() + i] = 0;
      }
      return [segment, dst, null];
    } else {
      var srcPtr = src.target();
      var allocateResult = capnp.layout.allocate(
        dst, segment, src.getStructRef().wordSize(), capnp.layout.Kind.STRUCT, null);
      var dstPtr = allocateResult[0];
      segment = allocateResult[1];
      dst = allocateResult[2];

      copyStruct(segment, dstPtr, srcSegment, srcPtr, src.getStructRef().dataSize(),
                 src.getStructRef().ptrCount());

      dst.setStructRef(new capnp.layout.StructSize(src.getStructRef().dataSize(), src.getStructRef().ptrCount()));
      return [segment, dst, dstPtr];
    }
  }
  case capnp.layout.Kind.LIST: {
    switch (src.getListRef().elementSize()) {
    case capnp.layout.FieldSize.VOID:
    case capnp.layout.FieldSize.BIT:
    case capnp.layout.FieldSize.BYTE:
    case capnp.layout.FieldSize.TWO_BYTES:
    case capnp.layout.FieldSize.FOUR_BYTES:
    case capnp.layout.FieldSize.EIGHT_BYTES: {
      var wordCount = capnp.common.roundBitsUpToWords(
        src.getListRef().elementCount() * capnp.layout.dataBitsPerElement(src.getListRef().elementSize()));
      var srcPtr = src.target();
      var allocateResult = capnp.layout.allocate(dst, segment, wordCount, capnp.layout.Kind.LIST, null);
      var dstPtr = allocateResult[0];
      segment = allocateResult[1];
      dst = allocateResult[2];

      var dstUint8Array = segment.getUint8Array();
      var srcUint8Array = srcSegment.getUint8Array();
      dstUint8Array.set(srcUint8Array.subarray(srcPtr << 3, (srcPtr << 3) + wordCount * capnp.common.BYTES_PER_WORD), dstPtr << 3);

      dst.setListRef(src.getListRef().elementSize(), src.getListRef().elementCount());
      return [segment, dst, dstPtr];
    }

    case capnp.layout.FieldSize.POINTER: {

      var allocateResult = capnp.layout.allocate(dst, segment, src.getListRef().elementCount() * capnp.common.WORDS_PER_POINTER,
                                                 capnp.layout.Kind.LIST, null);
      var dstRefs = allocateResult[0];
      segment = allocateResult[1];
      dst = allocateResult[2];

      var n = src.getListRef().elementCount();
      for (var i = 0; i < n; i++) {
        copyMessage(segment, segment.createWirePointerAt((dstRefs + i) << 3),
                    srcSegment, srcSegment.createWirePointerAt((src.target() + i) << 3));
      }

      dst.setListRef(capnp.layout.FieldSize.POINTER, src.getListRef().elementCount());
      return [segment, dst, dstRefs];
    }

    case capnp.layout.FieldSize.INLINE_COMPOSITE: {
      var srcPtr = src.target();
      var allocateResult = capnp.layout.allocate(dst, segment,
                                                 src.getListRef().inlineCompositeWordCount() + capnp.common.POINTER_SIZE_IN_WORDS,
                                                 capnp.layout.Kind.LIST, null);
      var dstPtr = allocateResult[0];
      segment = allocateResult[1];
      dst = allocateResult[2];

      dst.setListRefInlineComposite(src.getListRef().inlineCompositeWordCount());

      var dstUint8Array = segment.getUint8Array();
      var srcUint8Array = srcSegment.getUint8Array();
      dstUint8Array.set(srcUint8Array.subarray(srcPtr << 3, (srcPtr << 3) + capnp.common.BYTES_PER_WORD), dstPtr << 3);

      var srcElement = srcPtr + capnp.common.POINTER_SIZE_IN_WORDS;
      var dstElement = dstPtr + capnp.common.POINTER_SIZE_IN_WORDS;

      var srcTag = srcSegment.createWirePointerAt(srcPtr << 3);

      goog.asserts.assert(srcTag.kind() === capnp.layout.Kind.STRUCT,
                          'INLINE_COMPOSITE of lists is not yet supported.');

      var n = srcTag.inlineCompositeListElementCount();
      for (var i = 0; i < n; i++) {
        copyStruct(segment, dstElement, srcSegment, srcElement,
                   srcTag.getStructRef().dataSize(), srcTag.getStructRef().ptrCount());
        srcElement += srcTag.getStructRef().wordSize();
        dstElement += srcTag.getStructRef().wordSize();
      }
      return [segment, dst, dstPtr];
    }
    }
    break;
  }
  default:
    kj.debug.FAIL_REQUIRE('Copy source message contained unexpected kind.');
    break;
  }

  return [segment, dst, null];
};


var transferPointerWithSrcPtr = function(dstSegment, dst, srcSegment, srcTag, srcPtr) {

  // Like the other overload, but splits src into a tag and a target.  Particularly useful for
  // OrphanBuilder.

  if (dstSegment === srcSegment) {
    // Same segment, so create a direct pointer.
    dst.setKindAndTarget(srcTag.kind(), srcPtr, dstSegment);
    // We can just copy the upper 32 bits.  (Use memcpy() to comply with aliasing rules.)
    dst.setUpper32Bits(srcTag.getUpper32Bits());
  } else {
    // Need to create a far pointer.  Try to allocate it in the same segment as the source, so
    // that it doesn't need to be a double-far.

    var allocateResult = srcSegment.allocate(1);
    if (allocateResult === null) {
      // Darn, need a double-far.
      var allocation = srcSegment.getArena().allocate(2);
      var farSegment = allocation.segment;
      var landingPad0 = farSegment.createWirePointerAt((allocation.words + 0) << 3);
      var landingPad1 = farSegment.createWirePointerAt((allocation.words + 1) << 3);

      landingPad0.setFar(false, srcPtr);
      landingPad0.setFarRef(srcSegment.getSegmentId());

      landingPad1.setKindWithZeroOffset(srcTag.kind());
      landingPad1.setUpper32Bits(srcTag.getUpper32Bits());

      dst.setFar(true, allocation.words);
      dst.setFarRef(farSegment.getSegmentId());

    } else {
      var landingPad = srcSegment.createWirePointerAt(allocateResult << 3);
      // Simple landing pad is just a pointer.
      landingPad.setKindAndTarget(srcTag.kind(), srcPtr, srcSegment);
      landingPad.setUpper32Bits(srcTag.getUpper32Bits());

      dst.setFar(false, allocateResult);
      dst.setFarRef(srcSegment.getSegmentId());
    }
  }

};

var transferPointer = function(dstSegment, dst, srcSegment, src) {
  // Make *dst point to the same object as *src.  Both must reside in the same message, but can
  // be in different segments.  Not always-inline because this is rarely used.
  //
  // Caller MUST zero out the source pointer after calling this, to make sure no later code
  // mistakenly thinks the source location still owns the object.  transferPointer() doesn't do
  // this zeroing itself because many callers transfer several pointers in a loop then zero out
  // the whole section.

  kj.debug.DASSERT(dst.isNull());
  // We expect the caller to ensure the target is already null so won't leak.

  if (src.isNull()) {
    memclear(dstSegment, dst.getByteOffset(), capnp.layout.WirePointer.SIZE_IN_BYTES);
  } else if (src.kind() === capnp.layout.Kind.FAR) {
    // Far pointers are position-independent, so we can just copy.
    memcpy(dstSegment, dst.getByteOffset(), srcSegment, src.getByteOffset(), capnp.layout.WirePointer.SIZE_IN_BYTES);
  } else {
    transferPointerWithSrcPtr(dstSegment, dst, srcSegment, src, src.target());
  }
};


/**
 * @enum {number}
 */
capnp.layout.FieldSize = {

  VOID: 0,
  BIT: 1,
  BYTE: 2,
  TWO_BYTES: 3,
  FOUR_BYTES: 4,
  EIGHT_BYTES: 5,

  // Indicates that the field lives in the pointer section, not the
  // data section.
  POINTER: 6,
  INLINE_COMPOSITE: 7
};

/**
 * @enum {number}
 */
capnp.layout.Kind = {

  // Reference points at / describes a struct.
  STRUCT: 0,

  // Reference points at / describes a list.
  LIST: 1,

  // Reference is a "far pointer", which points at data located in a
  // different segment.  The eventual target is one of the other
  // kinds.
  FAR: 2,

  RESERVED_3: 3
};

/**
 *  @constructor
 *  @param {number} dataSize
 *  @param {number} ptrCount
 */
capnp.layout.StructRef = function(dataSize, ptrCount) {
  this.dataSize = function() { return dataSize; };
  this.ptrCount = function() { return ptrCount; };
  this.wordSize = function() { return dataSize + ptrCount * capnp.common.WORDS_PER_POINTER; };
  this.toString = function() { return 'StructRef{dataSize=' + dataSize + ',ptrCount=' + ptrCount + '}'; };
};

/**
 * @constructor
 *  @param {number} elementSize
 *  @param {number} elementCount
 */
capnp.layout.ListRef = function(elementSize, elementCount) {
  this.elementSize = function() { return elementSize; };
  this.elementCount = function() { return elementCount; };
  this.inlineCompositeWordCount = function() { return elementCount; };
};

/**
 *  @constructor
 *  @param {number} baseOffset
 */
capnp.layout.WirePointer = function(baseOffset, dataView) {

  goog.asserts.assert(kj.util.isRegularNumber(baseOffset));
  goog.asserts.assert(kj.util.isDataView(dataView), 'WirePointer constructor got invalid dataView: ', dataView);

  this.getByteOffset = function() {
    return baseOffset;
  };

  this.asPointer = function() {
    return baseOffset >> 3;
  };

  this.getOffsetAndKind = function() {
    return dataView.getUint32(0, true);
  };

  this.setOffsetAndKind = function(offsetAndKind) {
    dataView.setUint32(0, offsetAndKind, true);
  };

  this.setKindWithZeroOffset = function(kind) {
    this.setOffsetAndKind(kind);
  };

  this.getUpper32Bits = function() {
    return dataView.getUint32(4, true);
  };

  this.setUpper32Bits = function(upper32bits) {
    dataView.setUint32(4, upper32bits, true);
  };

  this.isNull = function() {
    return this.getOffsetAndKind() === 0 && this.getUpper32Bits() === 0;
  };

  this.clear = function() {
    this.setOffsetAndKind(0);
    this.setUpper32Bits(0);
  };

  this.kind = function() {
    return this.getOffsetAndKind() & 3;
  };

  this.target = function() {
    var offset = this.getOffsetAndKind() >> 2;
    return (baseOffset >>> 3) + 1 + offset;
  };

  this.setKindAndTarget = function(kind, target, segment) {
    var relOffset = target - (baseOffset >>> 3) - 1;
    this.setOffsetAndKind((relOffset << 2) | kind);
  };

  this.setKindAndTargetForEmptyStruct = function() {
    this.setOffsetAndKind(0xfffffffc);
  };

  this.setKindForOrphan = function(kind) {
    kj.debug.DREQUIRE(kind !== capnp.layout.Kind.FAR);
    this.setOffsetAndKind(kind | 0xfffffffc);
  };

  this.setListRefInlineComposite = function(wordCount) {
    this.setUpper32Bits((wordCount << 3) | capnp.layout.FieldSize.INLINE_COMPOSITE);
  };

  this.setKindAndInlineCompositeListElementCount = function(kind, elementCount) {
    this.setOffsetAndKind((elementCount << 2) | kind);
  };

  this.setStructRef = function(structSize) {
    goog.asserts.assert(structSize instanceof capnp.layout.StructSize);
    //this.setUpper32Bits(structSize.getDataWordCount() << 16 | structSize.getPointerCount());
    dataView.setUint16(4, structSize.getDataWordCount(), true);
    dataView.setUint16(6, structSize.getPointerCount(), true);
  };

  this.setFar = function(isDoubleFar, pos) {
    this.setOffsetAndKind((pos << 3) | (isDoubleFar << 2) | capnp.layout.Kind.FAR);
  };

  this.setFarRef = function(segmentId) {
    this.setUpper32Bits(segmentId);
  };

  this.farRef = function() {
    return { segmentId: this.getUpper32Bits() };
  };

  this.farPositionInSegment = function() {
    kj.debug.DREQUIRE(this.kind() === capnp.layout.Kind.FAR,
                      'positionInSegment() should only be called on FAR pointers.');
    return this.getOffsetAndKind() >>> 3;
  };

  this.isDoubleFar = function() {
    kj.debug.DREQUIRE(this.kind() === capnp.layout.Kind.FAR,
                      'isDoubleFar() should only be called on FAR pointers.');
    return (this.getOffsetAndKind() >> 2) & 1;
  };

  this.getStructRef = function() {
    var dataSize = dataView.getUint16(4, true);
    var ptrCount = dataView.getUint16(6, true);
    return new capnp.layout.StructRef(dataSize, ptrCount);
  };

  this.setListRef = function(fieldSize, elementCount) {
    this.setUpper32Bits((elementCount << 3) | fieldSize);
  };

  this.getListRef = function() {
    var upper32Bits = this.getUpper32Bits();
    return new capnp.layout.ListRef(upper32Bits & 7, upper32Bits >> 3);
  };

  this.inlineCompositeListElementCount = function() {
    return this.getOffsetAndKind() >>> 2;
  };

  this.toString = function() {
    return 'WirePointer{byteOffset=' + baseOffset + ', kind=' + this.kind() + ', data=' + kj.util.decimalToHex(this.getOffsetAndKind(), 8) + ' ' + kj.util.decimalToHex(this.getUpper32Bits(), 8) + '}';
  };

  return this;
};

capnp.layout.WirePointer.zero = function() {

  var zeroBuffer = new ArrayBuffer(8);
  return new capnp.layout.WirePointer(0, new DataView(zeroBuffer));
};

/** @const */ capnp.layout.WirePointer.SIZE_IN_BYTES = capnp.common.BYTES_PER_WORD;


capnp.layout.initStructListPointer = function(ref, segment, elementCount, elementSize, orphanArena) {

  if (elementSize.getPreferredListEncoding() != capnp.layout.FieldSize.INLINE_COMPOSITE) {
    // Small data-only struct.  Allocate a list of primitives instead.
    return capnp.layout.initListPointer(ref, segment, elementCount, elementSize.getPreferredListEncoding(),
                                        orphanArena);
  }

  var wordsPerElement = elementSize.getTotal();

  // Allocate the list, prefixed by a single WirePointer.
  var wordCount = elementCount * wordsPerElement;
  var allocateResult = capnp.layout.allocate(ref, segment, capnp.common.POINTER_SIZE_IN_WORDS + wordCount, capnp.layout.Kind.LIST,
                                             orphanArena);
  var ptr = allocateResult[0];
  segment = allocateResult[1];
  ref = allocateResult[2];

  // Initialize the pointer.
  // INLINE_COMPOSITE lists replace the element count with the word count.
  ref.setListRefInlineComposite(wordCount);

  // Initialize the list tag.
  var listTag = segment.createWirePointerAt(ptr << 3);
  listTag.setKindAndInlineCompositeListElementCount(capnp.layout.Kind.STRUCT, elementCount);
  listTag.setStructRef(elementSize);
  ptr += capnp.common.POINTER_SIZE_IN_WORDS;

  // Build the ListBuilder.
  return new capnp.layout.ListBuilder(segment, ptr, wordsPerElement * capnp.common.BITS_PER_WORD, elementCount,
                                      elementSize.getDataWordCount() * capnp.common.BITS_PER_WORD, elementSize.getPointerCount());
};

/**
 * @constructor
 */
capnp.layout.ListBuilder = function(segment, ptr, step, elementCount, structDataSize, structPointerCount) {

  goog.asserts.assert(typeof(elementCount) === 'number', 'elementCount NaN');
  goog.asserts.assert(!isNaN(step));

  this.segment = segment;

  this.toString = function() { return 'ListBuilder{ptr=' + ptr + ',step=' + step + ',elementCount=' + elementCount + '}'; };

  this.asReader = function() {
    return new capnp.layout.ListReader(segment, ptr, elementCount, step, structDataSize, structPointerCount, Number.MAX_VALUE);
  };

  this.size = function() { return elementCount; };


  this.getLocation = function() {
    // Get the object's location.  Only valid for independently-allocated objects (i.e. not list
    // elements).

    if (step <= capnp.common.BITS_PER_WORD) {
      return ptr;
    } else {
      return ptr - capnp.common.POINTER_SIZE_IN_WORDS;
    }
  }

  this.getStructElement = function(index) {

    var indexBit = index * step;
    var structData = (ptr << 3) + (indexBit / capnp.common.BITS_PER_BYTE) >>> 0;

    return new capnp.layout.StructBuilder(segment,
                                          structData,
                                          (structData + (structDataSize / capnp.common.BITS_PER_BYTE) >>> 0) >> 3,
                                          structDataSize,
                                          structPointerCount,
                                          indexBit % capnp.common.BITS_PER_BYTE);
  };

  this.getTextBlobElement = function(index) {
    var ref = segment.createWirePointerAt((ptr << 3) + index * step / capnp.common.BITS_PER_BYTE);
    return capnp.layout.getWritableTextPointer(ref, ref.target(), segment, '', 0);
  };

  this.getDataBlobElement = function(index) {
    var ref = segment.createWirePointerAt((ptr << 3) + index * step / capnp.common.BITS_PER_BYTE);
    return capnp.layout.getWritableDataPointer(ref, ref.target(), segment, null, 0);
  };

  this.setTextBlobElement = function(index, value) {
    var ref = segment.createWirePointerAt((ptr << 3) + index * step / capnp.common.BITS_PER_BYTE);
    capnp.layout.setTextPointer(ref, segment, value);
  };

  this.setDataBlobElement = function(index, value) {
    var ref = segment.createWirePointerAt((ptr << 3) + index * step / capnp.common.BITS_PER_BYTE);
    capnp.layout.setDataPointer(ref, segment, value);
  };

  this.getListElement = function(index, expectedElementSize) {
    var ref = segment.createWirePointerAt((ptr << 3) + index * step / capnp.common.BITS_PER_BYTE);
    return capnp.layout.getWritableListPointer(ref, ref.target(), segment, expectedElementSize, null);
  };

  this.setListElement = function(index, value) {
    var ref = segment.createWirePointerAt((ptr << 3) + index * step / capnp.common.BITS_PER_BYTE);
    capnp.layout.setListPointer(segment, ref, value);
  };

  this.initListElement = function(index, elementSize, elementCount) {
    goog.asserts.assert(elementSize !== undefined);
    var ref = segment.createWirePointerAt((ptr << 3) + index * step / capnp.common.BITS_PER_BYTE);
    return capnp.layout.initListPointer(ref, segment, elementCount, elementSize);
  };

  this.getStructListElement = function(index, elementSize) {
    var ref = segment.createWirePointerAt((ptr << 3) + index * step / capnp.common.BITS_PER_BYTE);
    return capnp.layout.getWritableStructListPointer(ref, ref.target(), segment, elementSize, null);
  };

  this.initStructListElement = function(index, elementCount, elementSize) {
    var ref = segment.createWirePointerAt((ptr << 3) + index * step / capnp.common.BITS_PER_BYTE);
    return capnp.layout.initStructListPointer(ref, segment, elementCount, elementSize);
  };

  this.getDataElement = function(clazz, index) {
    var offset = (ptr * capnp.common.BITS_PER_WORD) + index * step;
    return clazz.getValue(segment.getDataView(), offset);
  };

  this.setDataElement = function(clazz, index, value) {
    var offset = (ptr * capnp.common.BITS_PER_WORD) + index * step;
    clazz.setValue(segment.getDataView(), offset, value);
  };

  return this;
};


/**
 * @constructor
 */
capnp.layout.ListReader = function(segment, ptr, elementCount, step, structDataSize, structPointerCount, nestingLimit) {

  goog.asserts.assert(kj.util.isRegularNumber(nestingLimit));

  this.ptr = ptr;
  this.segment = segment;
  this.elementCount = elementCount;
  this.step = step;
  this.structDataSize = structDataSize;
  this.structPointerCount = structPointerCount;
  this.nestingLimit = nestingLimit;

  this.getSegment = function() { return segment; };
  this.size = function() { return elementCount; };

  this.getDataElement = function(clazz, index) {
    var offset = (ptr * capnp.common.BITS_PER_WORD) + index * step;
    return clazz.getValue(segment.getDataView(), offset);
  };

  this.getStructElement = function(index) {

    var indexBit = index * step;
    var structData = (ptr << 3) + ((indexBit / capnp.common.BITS_PER_BYTE) >>> 0);

    return new capnp.layout.StructReader(segment, structData,
                                         (structData >> 3) + (structDataSize / capnp.common.BITS_PER_WORD),
                                         structDataSize, structPointerCount, indexBit % capnp.common.BITS_PER_BYTE,
                                         nestingLimit - 1);
  };

  this.getListElement = function(index, expectedElementSize) {
    var ref = checkAlignment(segment, (ptr << 3) + (index * step / capnp.common.BITS_PER_BYTE) >>> 0);
    return capnp.layout.readListPointer(
      segment, ref, ref.target(), null, expectedElementSize, nestingLimit);
  };

  this.getTextBlobElement = function(index) {
    var ref = checkAlignment(segment, (ptr << 3) + (index * step / capnp.common.BITS_PER_BYTE) >>> 0);
    return capnp.layout.readTextPointer(segment, ref, ref.target(), '', 0);
  };

  this.getDataBlobElement = function(index) {
    var ref = checkAlignment(segment, (ptr << 3) + (index * step / capnp.common.BITS_PER_BYTE) >>> 0);
    return capnp.layout.readDataPointer(segment, ref, ref.target(), null, 0);
  };

  this.toString = function() { return 'ListReader{...}'; };
};

capnp.layout.ListReader.readRoot = function(location, segment, elementSize) {

  goog.asserts.assert(segment instanceof capnp.arena.SegmentReader, 'ListReader.readRoot got invalid segment');
  goog.asserts.assert(kj.util.isRegularNumber(elementSize), 'ListReader.readRoot got invalid elementSize');

  var ref = segment.createWirePointerAt(location);
  return capnp.layout.readListPointer(segment, ref, ref.target(), null, elementSize, Number.MAX_VALUE);
};

capnp.layout.setTextPointer = function(ref, segment, value, orphanArena) {
  var allocation = capnp.layout.initTextPointer(ref, segment, value.size(), orphanArena);

  var target = allocation.value.asUint8Array();
  target.set(value.asUint8Array());

  return allocation;
};


capnp.layout.initTextPointer = function(ref, segment, size, orphanArena) {

  // The byte list must include a NUL terminator.
  var byteSize = size + 1;

  // Allocate the space.
  var allocateResult = capnp.layout.allocate(ref, segment, capnp.common.roundBytesUpToWords(byteSize), capnp.layout.Kind.LIST, orphanArena);
  var ptr = allocateResult[0];
  segment = allocateResult[1];
  ref = allocateResult[2];

  // Initialize the pointer.
  ref.setListRef(capnp.layout.FieldSize.BYTE, byteSize);

  // Build the Text::Builder.  This will initialize the NUL terminator.
  return { segment: segment, value: capnp.blob.Text.Builder(segment, ptr, size) };
};


var BITS_PER_ELEMENT_TABLE = [0, 1, 8, 16, 32, 64, 0, 0];

capnp.layout.dataBitsPerElement = function(fieldSize) {
  return BITS_PER_ELEMENT_TABLE[fieldSize];
};

capnp.layout.pointersPerElement = function(fieldSize) {
  return fieldSize === capnp.layout.FieldSize.POINTER ? 1 : 0;
};


capnp.layout.allocate = function(ref, segment, amount, kind, orphanArena) {

  // Allocate space in the message for a new object, creating far pointers if necessary.
  //
  // * `ref` starts out being a reference to the pointer which shall be assigned to point at the
  //   new object.  On return, `ref` points to a pointer which needs to be initialized with
  //   the object's type information.  Normally this is the same pointer, but it can change if
  //   a far pointer was allocated -- in this case, `ref` will end up pointing to the far
  //   pointer's tag.  Either way, `allocate()` takes care of making sure that the original
  //   pointer ends up leading to the new object.  On return, only the upper 32 bit of `*ref`
  //   need to be filled in by the caller.
  //
  // * `segment` starts out pointing to the segment containing `ref`.  On return, it points to
  //   the segment containing the allocated object, which is usually the same segment but could
  //   be a different one if the original segment was out of space.
  //
  // * `amount` is the number of words to allocate.
  //
  // * `kind` is the kind of object to allocate.  It is used to initialize the pointer.  It
  //   cannot be `FAR` -- far pointers are allocated automatically as needed.
  //
  // * `orphanArena` is usually null.  If it is non-null, then we're allocating an orphan object.
  //   In this case, `segment` starts out null; the allocation takes place in an arbitrary
  //   segment belonging to the arena.  `ref` will be initialized as a non-far pointer, but its
  //   target offset will be set to zero.

  goog.asserts.assert(amount % 1 === 0, 'allocate asked to allocate fractional amount: ' + amount);

  if (!orphanArena) {
    if (!ref.isNull()) zeroObject(segment, ref);

    if (amount === 0 && kind === capnp.layout.Kind.STRUCT) {
      // Note that the check for kind == WirePointer::STRUCT will hopefully cause this whole
      // branch to be optimized away from all the call sites that are allocating non-structs.
      ref.setKindAndTargetForEmptyStruct();
      return [ref.asPointer(), segment, ref];
    }

    var ptr = segment.allocate(amount);

    if (!ptr) {
      // Need to allocate in a new segment.  We'll need to allocate an extra pointer worth of
      // space to act as the landing pad for a far pointer.

      var amountPlusRef = amount + capnp.common.POINTER_SIZE_IN_WORDS;
      var allocation = segment.getArena().allocate(amountPlusRef);
      segment = allocation.segment;
      ptr = allocation.words;

      goog.asserts.assert(kj.util.isRegularNumber(ptr));

      // Set up the original pointer to be a far pointer to the new segment.
      ref.setFar(false, ptr);
      ref.setFarRef(segment.getSegmentId());

      // Initialize the landing pad to indicate that the data immediately follows the pad.
      ref = segment.createWirePointerAt(ptr << 3); //reinterpret_cast<WirePointer*>(ptr);
      ref.setKindAndTarget(kind, ptr + capnp.common.POINTER_SIZE_IN_WORDS, segment);

      // Allocated space follows new pointer.
      return [ptr + capnp.common.POINTER_SIZE_IN_WORDS, segment, ref];
    }
    else {
      goog.asserts.assert(kj.util.isRegularNumber(ptr));
      ref.setKindAndTarget(kind, ptr, segment);
      return [ptr, segment, ref];
    }
  }
  else {
    // orphanArena is non-null.  Allocate an orphan.
    kj.debug.DASSERT(ref.isNull());
    var allocation = orphanArena.allocate(amount);
    segment = allocation.segment;
    ref.setKindForOrphan(kind);
    return [allocation.words, segment, ref];
  }
};

capnp.layout.setDataPointer = function(ref, segment, value, orphanArena) {

  var allocation = capnp.layout.initDataPointer(ref, segment, value.size(), orphanArena);
  var target = allocation.value.asUint8Array();
  target.set(value.asUint8Array());
  return allocation;
};


capnp.layout.initDataPointer = function(ref, segment, size, orphanArena) {

  // Allocate the space.
  var allocateResult = capnp.layout.allocate(ref, segment, capnp.common.roundBytesUpToWords(size), capnp.layout.Kind.LIST, orphanArena);
  var ptr = allocateResult[0];
  segment = allocateResult[1];
  ref = allocateResult[2];

  // Initialize the pointer.
  ref.setListRef(capnp.layout.FieldSize.BYTE, size);

  // Build the Data::Builder.
  return { segment: segment, value: new capnp.blob.Data.Builder(segment, ptr, size) };
};

capnp.layout.initStructPointer = function(ref, segment, size, orphanArena) {

  // Allocate space for the new struct.  Newly-allocated space is automatically zeroed.
  var allocateResult = capnp.layout.allocate(ref, segment, size.getTotal(), capnp.layout.Kind.STRUCT, orphanArena);
  var ptr = allocateResult[0];
  segment = allocateResult[1];
  ref = allocateResult[2];

  // Initialize the pointer.
  ref.setStructRef(size);

  // Build the StructBuilder.

  goog.asserts.assert(kj.util.isRegularNumber(ptr));
  goog.asserts.assert(kj.util.isRegularNumber(size.getDataWordCount()));

  return new capnp.layout.StructBuilder(segment, (ptr << 3), ptr + size.getDataWordCount(),
                                        size.getDataWordCount() * capnp.common.BITS_PER_WORD, size.getPointerCount(), 0);
};

var converter = new DataView(new ArrayBuffer(8));

/**
 * @constructor
 */
capnp.layout.StructBase = function(segment, data, dataSize, bit0Offset) {

  this.segment = segment;
  this.data = data;
  this.dataSize = dataSize;
  this.seg_dataView = segment ? segment.getDataView() : null;
  this.dataSizeBytes = ((dataSize + 7) / capnp.common.BITS_PER_BYTE) >>> 0;
  this.bit0Offset = bit0Offset;
};

/**
 *  @param {number} offset
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.hasDataField_bool = function(offset) {
  return capnp.prim.bool.getValue(this.seg_dataView, this.data * capnp.common.BITS_PER_BYTE + offset) != 0;
};

/**
 *  @param {number} offset
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.hasDataField_int8 = function(offset) {
  return capnp.prim.int8_t.getValue(this.seg_dataView, (this.data + offset * 1) * capnp.common.BITS_PER_BYTE) != 0;
};

/**
 *  @param {number} offset
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.hasDataField_uint8 = function(offset) {
  return capnp.prim.uint8_t.getValue(this.seg_dataView, (this.data + offset * 1) * capnp.common.BITS_PER_BYTE) != 0;
};

/**
 *  @param {number} offset
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.hasDataField_int16 = function(offset) {
  return capnp.prim.int16_t.getValue(this.seg_dataView, (this.data + offset * 2) * capnp.common.BITS_PER_BYTE) != 0;
};

/**
 *  @param {number} offset
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.hasDataField_uint16 = function(offset) {
  return capnp.prim.uint16_t.getValue(this.seg_dataView, (this.data + offset * 2) * capnp.common.BITS_PER_BYTE) != 0;
};

/**
 *  @param {number} offset
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.hasDataField_int32 = function(offset) {
  return capnp.prim.int32_t.getValue(this.seg_dataView, (this.data + offset * 4) * capnp.common.BITS_PER_BYTE) != 0;
};

/**
 *  @param {number} offset
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.hasDataField_uint32 = function(offset) {
  return capnp.prim.uint32_t.getValue(this.seg_dataView, (this.data + offset * 4) * capnp.common.BITS_PER_BYTE) != 0;
};

/**
 *  @param {number} offset
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.hasDataField_int64 = function(offset) {
  return this.seg_dataView.getUint32(this.data + offset * 8) !== 0 || this.seg_dataView.getUint32(this.data + offset * 8 + 4) !== 0;
};

/**
 *  @param {number} offset
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.hasDataField_float32 = function(offset) {
  return capnp.prim.float32_t.getValue(this.seg_dataView, (this.data + offset * 4) * capnp.common.BITS_PER_BYTE) != 0;
};

/**
 *  @param {number} offset
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.hasDataField_float64 = function(offset) {
  return capnp.prim.float64_t.getValue(this.seg_dataView, (this.data + offset * 8) * capnp.common.BITS_PER_BYTE) != 0;
};

/**
 *  @param {number} offset
 *  @return {Array.<number>}
 */
capnp.layout.StructBase.prototype.getDataField_int64 = function(offset) {
  if (offset * 64 < this.dataSize) {
    var lo = this.seg_dataView.getInt32(this.data + offset * 8, true);
    var hi = this.seg_dataView.getInt32(this.data + offset * 8 + 4, true);
    return [hi, lo];
  }
  else {
    return [0, 0];
  }
};

/**
 *  @param {number} offset
 *  @param {Array.<number>} mask
 *  @return {Array.<number>}
 */
capnp.layout.StructBase.prototype.getDataField_int64_masked = function(offset, mask) {
  if (offset * 64 < this.dataSize) {
    var lo = this.seg_dataView.getInt32(this.data + offset * 8, true);
    var hi = this.seg_dataView.getInt32(this.data + offset * 8 + 4, true);
    return [hi ^ mask[0], lo ^ mask[1]];
  }
  else {
    return [mask[0], mask[1]];
  }
};

/**
 *  @param {number} offset
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.hasDataField_uint64 = function(offset) {
  return this.seg_dataView.getUint32(this.data + offset * 8) !== 0 || this.seg_dataView.getUint32(this.data + offset * 8 + 4) !== 0;
};

/**
 *  @param {number} offset
 *  @return {Array.<number>}
 */
capnp.layout.StructBase.prototype.getDataField_uint64 = function(offset) {
  if (offset * 64 < this.dataSize) {
    var lo = this.seg_dataView.getUint32(this.data + offset * 8, true);
    var hi = this.seg_dataView.getUint32(this.data + offset * 8 + 4, true);
    return [hi, lo];
  }
  else {
    return [0, 0];
  }
};

/**
 *  @param {number} offset
 *  @param {Array.<number>} mask
 *  @return {Array.<number>}
 */
capnp.layout.StructBase.prototype.getDataField_uint64_masked = function(offset, mask) {
  var value = this.getDataField_uint64(offset);
  return [(value[0] ^ mask[0]) >>> 0, (value[1] ^ mask[1]) >>> 0];
};

/**
 *  @param {number} offset
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.getDataField_bool = function(offset) {
  if (offset < this.dataSize) {
    return capnp.prim.bool.getValue(this.seg_dataView, this.data * capnp.common.BITS_PER_BYTE + offset + this.bit0Offset);
  }
  else {
    return false;
  }
};

/**
 *  @param {number} offset
 *  @param {boolean} mask
 *  @return {boolean}
 */
capnp.layout.StructBase.prototype.getDataField_bool_masked = function(offset, mask) {
  return !!(this.getDataField_bool(offset) ^ mask);
};

/**
 *  @param {number} offset
 *  @return {number}
 */
capnp.layout.StructBase.prototype.getDataField_float32 = function(offset) {
  if (offset * 32 < this.dataSize) {
    return this.seg_dataView.getFloat32(this.data + offset * 4, true);
  }
  else {
    return 0;
  }
};

/**
 *  @param {number} offset
 *  @param {number} mask
 *  @return {number}
 */
capnp.layout.StructBase.prototype.getDataField_float32_masked = function(offset, mask) {
  if (offset * 32 < this.dataSize) {
    converter.setUint32(0, this.seg_dataView.getUint32(this.data + offset * 4, true) ^ mask, true);
    return converter.getFloat32(0, true);
  }
  else {
    converter.setUint32(0, mask, true);
    return converter.getFloat32(0, true);
  }
};

/**
 *  @param {number} offset
 *  @return {number}
 */
capnp.layout.StructBase.prototype.getDataField_float64 = function(offset) {
  if (offset * 64 < this.dataSize) {
    return this.seg_dataView.getFloat64(this.data + offset * 8, true);
  }
  else {
    return 0;
  }
};

/**
 *  @param {number} offset
 *  @param {number} mask
 *  @return {number}
 */
capnp.layout.StructBase.prototype.getDataField_float64_masked = function(offset, mask) {
  if (offset * 64 < this.dataSize) {
    converter.setUint32(0, this.seg_dataView.getUint32(this.data + offset * 8, true) ^ mask[1], true);
    converter.setUint32(4, this.seg_dataView.getUint32(this.data + offset * 8 + 4, true) ^ mask[0], true);
    return converter.getFloat64(0, true);
  }
  else {
    converter.setUint32(0, mask[1], true);
    converter.setUint32(4, mask[0], true);
    return converter.getFloat64(0, true);
  }
};

/**
 *  @param {number} offset
 *  @return {number}
 */
capnp.layout.StructBase.prototype.getDataField_uint8 = function(offset) {
  if (offset * 8 < this.dataSize) {
    return this.seg_dataView.getUint8(this.data + offset);
  }
  else {
    return 0;
  }
};

/**
 *  @param {number} offset
 *  @param {number} mask
 *  @return {number}
 */
capnp.layout.StructBase.prototype.getDataField_uint8_masked = function(offset, mask) {
  return this.getDataField_uint8(offset) ^ mask;
};

/**
 *  @param {number} offset
 *  @param {number} value
 */
capnp.layout.StructBase.prototype.setDataField_uint8 = function(offset, value) {
  this.seg_dataView.setUint8(this.data + offset, value);
};

/**
 *  @param {number} offset
 *  @param {number} mask
 *  @return {number}
 */
capnp.layout.StructBase.prototype.setDataField_uint8_masked = function(offset, value, mask) {
  this.seg_dataView.setUint8(this.data + offset, value ^ mask);
};

/**
 *  @param {number} offset
 *  @return {number}
 */
capnp.layout.StructBase.prototype.getDataField_int8 = function(offset) {
  if (offset * 8 < this.dataSize) {
    return this.seg_dataView.getInt8(this.data + offset);
  }
  else {
    return 0;
  }
};

capnp.layout.StructBase.prototype.getDataField_int8_masked = function(offset, mask) {
  return this.getDataField_int8(offset) ^ mask;
};

capnp.layout.StructBase.prototype.setDataField_int8 = function(offset, value) {
  this.seg_dataView.setInt8(this.data + offset, value);
};

capnp.layout.StructBase.prototype.setDataField_int8_masked = function(offset, value, mask) {
  this.seg_dataView.setInt8(this.data + offset, value ^ mask);
};

/**
 *  @param {number} offset
 *  @return {number}
 */
capnp.layout.StructBase.prototype.getDataField_int16 = function(offset) {
  if (offset * 16 < this.dataSize) {
    return this.seg_dataView.getInt16(this.data + (offset << 1), true);
  }
  else {
    return 0;
  }
};

capnp.layout.StructBase.prototype.getDataField_int16_masked = function(offset, mask) {
  return this.getDataField_int16(offset) ^ mask;
};

capnp.layout.StructBase.prototype.setDataField_int16 = function(offset, value) {
  this.seg_dataView.setInt16(this.data + (offset << 1), value, true);
};

capnp.layout.StructBase.prototype.setDataField_int16_masked = function(offset, value, mask) {
  this.seg_dataView.setInt16(this.data + (offset << 1), value ^ mask, true);
};


capnp.layout.StructBase.prototype.getDataField_uint16 = function(offset) {
  if (offset * 16 < this.dataSize) {
    return this.seg_dataView.getUint16(this.data + (offset << 1), true);
  }
  else {
    return 0;
  }
};

capnp.layout.StructBase.prototype.getDataField_uint16_masked = function(offset, mask) {
  return this.getDataField_uint16(offset) ^ mask;
};

capnp.layout.StructBase.prototype.setDataField_uint16 = function(offset, value) {
  this.seg_dataView.setUint16(this.data + (offset << 1), value, true);
};

capnp.layout.StructBase.prototype.setDataField_uint16_masked = function(offset, value, mask) {
  this.seg_dataView.setUint16(this.data + (offset << 1), value ^ mask, true);
};

/**
 *  @param {number} offset
 *  @return {number}
 */
capnp.layout.StructBase.prototype.getDataField_int32 = function(offset) {
  if (offset * 32 < this.dataSize) {
    return this.seg_dataView.getInt32(this.data + (offset << 2), true);
  }
  else {
    return 0;
  }
};

capnp.layout.StructBase.prototype.getDataField_int32_masked = function(offset, mask) {
  return this.getDataField_int32(offset) ^ mask;
};

capnp.layout.StructBase.prototype.setDataField_int32 = function(offset, value) {
  this.seg_dataView.setInt32(this.data + (offset << 2), value, true);
};

capnp.layout.StructBase.prototype.setDataField_int32_masked = function(offset, value, mask) {
  this.seg_dataView.setInt32(this.data + (offset << 2), value ^ mask, true);
};

/**
 *  @param {number} offset
 *  @return {number}
 */
capnp.layout.StructBase.prototype.getDataField_uint32 = function(offset) {
  if ((offset << 2) + 4 <= this.dataSizeBytes) { // ((dataSize + 7) / BITS_PER_BYTE)) { // && (offset << 2) + 4 <= dataView.byteLength) { // FIXME -- use byteLength comparison for other getters as well, or see if dataSize can be expressed in bits?
    return this.seg_dataView.getUint32(this.data + (offset << 2), true);
  }
  else {
    return 0;
  }
};

capnp.layout.StructBase.prototype.getDataField_uint32_masked = function(offset, mask) {
  return (this.getDataField_uint32(offset) ^ mask) >>> 0;
};

capnp.layout.StructBase.prototype.setDataField_uint32 = function(offset, value) {
  this.seg_dataView.setUint32(this.data + (offset << 2), value, true);
};

capnp.layout.StructBase.prototype.setDataField_uint32_masked = function(offset, value, mask) {
  this.seg_dataView.setUint32(this.data + (offset << 2), value ^ mask, true);
};



capnp.layout.StructBase.prototype.setDataField_int64 = function(offset, value) {
  capnp.prim.int64_t.setValue(this.seg_dataView, (this.data + (offset >>> 0) * 8) * capnp.common.BITS_PER_BYTE, value);
};

capnp.layout.StructBase.prototype.setDataField_int64_masked = function(offset, value, mask) {
  capnp.prim.int64_t.setValue(this.seg_dataView, (this.data + (offset >>> 0) * 8) * capnp.common.BITS_PER_BYTE, [value[0] ^ mask[0], value[1] ^ mask[1]]);
};

capnp.layout.StructBase.prototype.setDataField_uint64 = function(offset, value) {
  capnp.prim.uint64_t.setValue(this.seg_dataView, (this.data + (offset >>> 0) * 8) * capnp.common.BITS_PER_BYTE, value);
};

capnp.layout.StructBase.prototype.setDataField_uint64_masked = function(offset, value, mask) {
  capnp.prim.uint64_t.setValue(this.seg_dataView, (this.data + (offset >>> 0) * 8) * capnp.common.BITS_PER_BYTE, [value[0] ^ mask[0], value[1] ^ mask[1]]);
};


capnp.layout.StructBase.prototype.setDataField_float32 = function(offset, value) {
  capnp.prim.float32_t.setValue(this.seg_dataView, (this.data + offset * 4) * capnp.common.BITS_PER_BYTE, value);
};

capnp.layout.StructBase.prototype.setDataField_float64 = function(offset, value) {
  capnp.prim.float64_t.setValue(this.seg_dataView, (this.data + offset * 8) * capnp.common.BITS_PER_BYTE, value);
};


capnp.layout.StructBase.prototype.setDataField_bool = function(offset, value) {
  offset += this.bit0Offset;
  var byteOffset = offset / capnp.common.BITS_PER_BYTE;
  var bitOffset = offset % capnp.common.BITS_PER_BYTE;
  this.seg_dataView.setUint8(this.data + byteOffset, this.seg_dataView.getUint8(this.data + byteOffset) & ~(1 << bitOffset) | (value << bitOffset));
};

capnp.layout.StructBase.prototype.setDataField_bool_masked = function(offset, value, mask) {
  offset += this.bit0Offset;
  var byteOffset = offset / capnp.common.BITS_PER_BYTE;
  var bitOffset = offset % capnp.common.BITS_PER_BYTE;
  value = (!!value) ^ (!!mask);
  this.seg_dataView.setUint8(this.data + byteOffset, this.seg_dataView.getUint8(this.data + byteOffset) & ~(1 << bitOffset) | (value << bitOffset));
};


/**
 * @constructor
 */
capnp.layout.StructBuilder = function(segment, data, pointerOffset, dataSize, pointerCount, bit0Offset) {

  goog.asserts.assert(kj.util.isRegularNumber(pointerOffset));

  capnp.layout.StructBase.call(this, segment, data, dataSize, bit0Offset);

  goog.asserts.assert(typeof(pointerOffset) === 'number', 'invalid pointerOffset');

  this.getLocation = function() { return data >> 3; }

  this.getBit0Offset = function() { return bit0Offset; };

  this.getSegmentBuilder = function() { return segment; };
  this.getPointerOffset = function() { return pointerOffset; };
  this.toString = function() { return 'StructBuilder(...)'; };

  this.setTextBlobField = function(ptrIndex, value) {
    capnp.layout.setTextPointer(segment.createWirePointerAt((pointerOffset + ptrIndex) * capnp.common.BYTES_PER_WORD), segment, value);
  };

  this.setDataBlobField = function(ptrIndex, value) {
    capnp.layout.setDataPointer(segment.createWirePointerAt((pointerOffset + ptrIndex) * capnp.common.BYTES_PER_WORD), segment, value);
  };

  this.getTextBlobField = function(ptrIndex, defaultValue, defaultSize) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.getWritableTextPointer(ref, ref.target(), segment, defaultValue, defaultSize);
  };

  this.disownTextBlobField = function(ptrIndex) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.disown(segment, ref);
  };

  this.disownDataBlobField = function(ptrIndex) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.disown(segment, ref);
  };

  this.getDataBlobField = function(ptrIndex, defaultValue, defaultSize) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.getWritableDataPointer(ref, ref.target(), segment, defaultValue, defaultSize);
  };

  this.getStructField = function(ptrIndex, size, defaultValue) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.getWritableStructPointer(ref, ref.target(), segment, size, defaultValue);
  };

  this.initStructField = function(ptrIndex, size) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.initStructPointer(ref, segment, size);
  };

  this.isPointerFieldNull = function(ptrIndex) {
    var dataView = segment.getDataView();
    return dataView.getUint32((pointerOffset + ptrIndex) * capnp.common.BYTES_PER_WORD) === 0
      && dataView.getUint32((pointerOffset + ptrIndex) * capnp.common.BYTES_PER_WORD + 4) === 0;
  };

  this.getListField = function(ptrIndex, elementSize, defaultValue) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.getWritableListPointer(ref, ref.target(), segment, elementSize, defaultValue);
  };

  this.getStructListField = function(ptrIndex, elementSize, defaultValue) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.getWritableStructListPointer(ref, ref.target(), segment, elementSize, defaultValue);
  };

  this.initStructListField = function(ptrIndex, elementCount, elementSize) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.initStructListPointer(ref, segment, elementCount, elementSize);
  };

  this.setListField = function(ptrIndex, value) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    capnp.layout.setListPointer(segment, ref, value);
  };

  this.initListField = function(ptrIndex, elementSize, elementCount) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.initListPointer(ref, segment, elementCount, elementSize);
  };

  this.disownListField = function(ptrIndex) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.disown(segment, ref);
  };

  this.clearPointerField = function(ptrIndex) {
    var dataView = segment.getDataView();
    dataView.setUint32((pointerOffset + ptrIndex) * capnp.common.BYTES_PER_WORD, 0);
    dataView.setUint32((pointerOffset + ptrIndex) * capnp.common.BYTES_PER_WORD + 4, 0);
  };

  this.setStructField = function(ptrIndex, value) {
    goog.asserts.assert(value instanceof capnp.layout.StructReader, 'not a StructReader: ' + value);
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    capnp.layout.setStructPointer(segment, ref, value);
  };

  this.disownStructField = function(ptrIndex) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.disown(segment, ref);
  };

  this.adoptStructField = function(ptrIndex, value) {
    var ref = segment.createWirePointerAt((pointerOffset + ptrIndex) << 3);
    return capnp.layout.adopt(segment, ref, value);
  };

  this.asReader = function() {
    return new capnp.layout.StructReader(segment, data, pointerOffset, dataSize, pointerCount, bit0Offset, Number.MAX_VALUE);
  };

  this.toString = function() { return 'StructBuilder{segment=' + segment.toString() + ',data=' + data + ', pointerOffset=' + pointerOffset + '}'; };

  return this;
};
capnp.layout.StructBuilder.prototype = Object.create(capnp.layout.StructBase.prototype);
capnp.layout.StructBuilder.prototype.constructor = capnp.layout.StructBuilder;


capnp.layout.StructBuilder.initRoot = function(segment, location, size) {
  return capnp.layout.initStructPointer(segment.createWirePointerAt(location), segment, size);
};

capnp.layout.StructBuilder.setRoot = function(segment, location, value) {
  capnp.layout.setStructPointer(segment, segment.createWirePointerAt(location), value);
};

capnp.layout.StructBuilder.getRoot = function(segment, location, size) {
  var ref = segment.createWirePointerAt(location);
  return capnp.layout.getWritableStructPointer(ref, ref.target(), segment, size, null);
};

/**
 * @constructor
 */
capnp.layout.StructReader = function(segment, data, pointers,
                                     dataSize, pointerCount, bit0Offset,
                                     nestingLimit) {

  goog.asserts.assert(kj.util.isRegularNumber(pointers));

  capnp.layout.StructBase.call(this, segment, data, dataSize, bit0Offset);

  this.segment = segment;
  this.data = data;
  this.pointers = pointers;
  this.dataSize = dataSize;
  this.pointerCount = pointerCount;
  this.bit0Offset = bit0Offset;
  this.nestingLimit = nestingLimit;

  this.getBit0Offset = function() { return bit0Offset; };

  this.isPointerFieldNull = function(ptrIndex) {
    var dataView = segment.getDataView();
    var offsetBytes = (pointers + ptrIndex) * capnp.common.BYTES_PER_WORD;
    return dataView.getUint32(offsetBytes) === 0 && dataView.getUint32(offsetBytes + 4) === 0;
  };

  this.getListField = function(ptrIndex, expectedElementSize, defaultValue) {
    var ref = ptrIndex >= pointerCount ? capnp.layout.WirePointer.zero() : segment.createWirePointerAt((pointers + ptrIndex) << 3);
    return capnp.layout.readListPointer(segment, ref, ref.target(), defaultValue, expectedElementSize, nestingLimit);
  };

  this.getStructField = function(ptrIndex, defaultValue) {
    var ref = ptrIndex >= pointerCount ? capnp.layout.WirePointer.zero() : segment.createWirePointerAt((pointers + ptrIndex) << 3);
    return capnp.layout.readStructPointer(segment, ref, ref.target(), defaultValue, nestingLimit);
  };

  this.getTextBlobField = function(ptrIndex, defaultValue, defaultSize) {
    var ref = ptrIndex >= pointerCount ? capnp.layout.WirePointer.zero() : segment.createWirePointerAt((pointers + ptrIndex) << 3);
    return capnp.layout.readTextPointer(segment, ref, ref.target(), defaultValue, defaultSize);
  };

  this.getDataBlobField = function(ptrIndex, defaultValue, defaultSize) {
    goog.asserts.assert(kj.util.isRegularNumber(defaultSize), 'defaultSize not a regular number: ' + defaultSize);
    var ref = ptrIndex >= pointerCount ? capnp.layout.WirePointer.zero() : segment.createWirePointerAt((pointers + ptrIndex) << 3);
    return capnp.layout.readDataPointer(segment, ref, ref.target(), defaultValue, defaultSize);
  };

  this.totalSize = function() {
    var result = capnp.common.roundBitsUpToWords(dataSize) + pointerCount * capnp.common.WORDS_PER_POINTER;

    for (var i = 0; i < pointerCount; i++) {
      result += capnp.layout.totalSize(segment, segment.createWirePointerAt((pointers + i) << 3), nestingLimit);
    }

    if (segment) {
      // This traversal should not count against the read limit, because it's highly likely that
      // the caller is going to traverse the object again, e.g. to copy it.
      segment.unread(result);
    }

    return result;
  };

  this.toString = function() { return 'StructReader{...}'; };
};
capnp.layout.StructReader.prototype = Object.create(capnp.layout.StructBase.prototype);
capnp.layout.StructReader.prototype.constructor = capnp.layout.StructReader;

capnp.layout.StructReader.readRoot = function(location, segment, nestingLimit) {

  kj.debug.REQUIRE(boundsCheck(segment, location, location + capnp.common.POINTER_SIZE_IN_WORDS),
                   'Root location out-of-bounds.');

  goog.asserts.assert(segment instanceof capnp.arena.SegmentReader, 'StructReader.readRoot got invalid segment');

  var ref = segment.createWirePointerAt(location);

  return capnp.layout.readStructPointer(segment, ref, ref.target(), null, nestingLimit);
};

capnp.layout.StructReader.readRootUnchecked = function(data) {
  var newBuffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(newBuffer).set(new Uint8Array(data.buffer).subarray(data.byteOffset, data.byteOffset + data.byteLength));
  return capnp.layout.StructReader.readRoot(0, new capnp.arena.SegmentReader(null, 0, new DataView(newBuffer), new capnp.arena.ReadLimiter()), Number.MAX_VALUE);
};


capnp.layout.initListPointer = function(wirePointer, segmentBuilder, elementCount, elementSize, orphanArena) {

  goog.asserts.assert(elementSize !== undefined);

  var dataSize = capnp.layout.dataBitsPerElement(elementSize);
  var pointerCount = capnp.layout.pointersPerElement(elementSize);
  var step = (dataSize + pointerCount * capnp.common.BITS_PER_POINTER);

  // Calculate size of the list.
  var wordCount = capnp.common.roundBitsUpToWords(elementCount * step);

  // Allocate the list.
  var allocateResult = capnp.layout.allocate(wirePointer, segmentBuilder, wordCount, capnp.layout.Kind.LIST, orphanArena);
  var ptr = allocateResult[0];
  segmentBuilder = allocateResult[1];
  wirePointer = allocateResult[2];

  // Initialize the pointer.
  wirePointer.setListRef(elementSize, elementCount);

  // Build the ListBuilder.
  goog.asserts.assert(!isNaN(step));
  var result = new capnp.layout.ListBuilder(segmentBuilder, ptr, step, elementCount, dataSize, pointerCount);

  return result;
};

capnp.layout.getWritableTextPointer = function(ref, refTarget, segment, defaultValue, defaultSize) {
  goog.asserts.assert(kj.util.isRegularNumber(defaultSize));
  if (ref.isNull()) {
    if (defaultSize === 0) {
      return new capnp.blob.Text.Builder(segment, null, 0);
    } else {
      var initTextPointerResult = capnp.layout.initTextPointer(ref, segment, defaultSize);
      var builder = initTextPointerResult.value;
      memcpy(initTextPointerResult.segment, builder.begin(), new capnp.arena.SegmentReader(null, null, new DataView(defaultValue), null), 0, defaultSize);
      return builder;
    }
  } else {
    var followFarsResult = capnp.layout.followFars(ref, refTarget, segment);
    ref = followFarsResult[0];
    segment = followFarsResult[1];
    var ptr = followFarsResult[2];

    kj.debug.REQUIRE(ref.kind() === capnp.layout.Kind.LIST,
                     'Called getText{Field,Element}() but existing pointer is not a list (1).');

    kj.debug.REQUIRE(ref.getListRef().elementSize() === capnp.layout.FieldSize.BYTE,
                     'Called getText{Field,Element}() but existing list pointer is not byte-sized.');

    // Subtract 1 from the size for the NUL terminator.
    return new capnp.blob.Text.Builder(segment, ptr, ref.getListRef().elementCount() - 1);
  }
};

capnp.layout.followFars = function(ref, refTarget, segment) {

  //assert(segment instanceof SegmentReader, "this is the followFars for a SegmentReader, but got " + segment.toString());

  if (segment != null && !(segment instanceof capnp.arena.SegmentReader)) {
    throw new Error('this is the followFars for a SegmentReader, but got ' + segment.toString());
  }

  // Like the other followFars() but operates on readers.

  // If the segment is null, this is an unchecked message, so there are no FAR pointers.
  if (segment != null && ref.kind() === capnp.layout.Kind.FAR) {

    // Look up the segment containing the landing pad.
    segment = segment.getArena().tryGetSegment(ref.farRef().segmentId);
    kj.debug.REQUIRE(segment !== null, 'Message contains far pointer to unknown segment: ' + ref.farRef().segmentId);

    // Find the landing pad and check that it is within bounds.
    var ptr = ref.farPositionInSegment();
    var padWords = (1 + (ref.isDoubleFar() ? 1 : 0)) * capnp.common.POINTER_SIZE_IN_WORDS;
    kj.debug.REQUIRE(boundsCheck(segment, ptr, ptr + padWords),
                     'Message contains out-of-bounds far pointer.');

    var pad = segment.createWirePointerAt(ptr << 3);

    // If this is not a double-far then the landing pad is our final pointer.
    if (!ref.isDoubleFar()) {
      ref = pad;
      return [ref, segment, pad.target()];
    }

    // Landing pad is another far pointer.  It is followed by a tag describing the pointed-to
    // object.
    ref = segment.createWirePointerAt((ptr + 1) << 3);

    segment = segment.getArena().tryGetSegment(pad.farRef().segmentId);
    kj.debug.REQUIRE(segment !== null, 'Message contains double-far pointer to unknown segment.');

    return [ref, segment, pad.farPositionInSegment()];
  } else {
    return [ref, segment, refTarget];
  }

};

capnp.layout.getWritableDataPointer = function(ref, refTarget, segment, defaultValue, defaultSize) {
  if (ref.isNull()) {
    if (defaultSize === 0) {
      return new capnp.blob.Data.Builder(segment, null, 0);
    } else {
      var builder = capnp.layout.initDataPointer(ref, segment, defaultSize).value;
      builder.asUint8Array().set(defaultValue);
      return builder;
    }
  } else {
    var followFarsResult = capnp.layout.followFars(ref, refTarget, segment);
    ref = followFarsResult[0];
    segment = followFarsResult[1];
    var ptr = followFarsResult[2];

    kj.debug.REQUIRE(ref.kind() === capnp.layout.Kind.LIST,
                     'Called getData{Field,Element}() but existing pointer is not a list (2).');
    kj.debug.REQUIRE(ref.getListRef().elementSize() === capnp.layout.FieldSize.BYTE,
                     'Called getData{Field,Element}() but existing list pointer is not byte-sized.');

    return new capnp.blob.Data.Builder(segment, ptr, ref.getListRef().elementCount());
  }
};

capnp.layout.getWritableStructPointer = function(ref, refTarget, segment, size, defaultValue, orphanArena) {

  if (ref.isNull()) {
    if (defaultValue == null) {
      return capnp.layout.initStructPointer(ref, segment, size, orphanArena);
    }

    var defaultPointer = new capnp.layout.WirePointer(0, new DataView(defaultValue, 0, 8));
    if (defaultPointer.isNull()) {
      return capnp.layout.initStructPointer(ref, segment, size, orphanArena);
    }
    var defaultSegment = new capnp.arena.SegmentReader(null, null, new DataView(defaultValue), null);

    var copyMessageResult = copyMessage(segment, ref, defaultSegment, defaultPointer);
    segment = copyMessageResult[0];
    ref = copyMessageResult[1];
    refTarget = copyMessageResult[2];
    defaultValue = null;  // If the default value is itself invalid, don't use it again.
  }

  var oldRef = ref;
  var oldSegment = segment;
  var followFarsResult = capnp.layout.followFars(oldRef, refTarget, oldSegment);
  oldRef = followFarsResult[0];
  oldSegment = followFarsResult[1];
  var oldPtr = followFarsResult[2];

  kj.debug.REQUIRE(oldRef.kind() === capnp.layout.Kind.STRUCT,
                   'Message contains non-struct pointer where struct pointer was expected.');

  var oldDataSize = oldRef.getStructRef().dataSize();
  var oldPointerCount = oldRef.getStructRef().ptrCount();
  var oldPointerSection = oldPtr + oldDataSize;

  if (oldDataSize < size.getDataWordCount() || oldPointerCount < size.getPointerCount()) {
    // The space allocated for this struct is too small.  Unlike with readers, we can't just
    // run with it and do bounds checks at access time, because how would we handle writes?
    // Instead, we have to copy the struct to a new space now.

    var newDataSize = Math.max(oldDataSize, size.getDataWordCount());
    var newPointerCount =
      Math.max(oldPointerCount, size.getPointerCount());
    var totalSize = newDataSize + newPointerCount * capnp.common.WORDS_PER_POINTER;

    // Don't let allocate() zero out the object just yet.
    zeroPointerAndFars(segment, ref);

    var allocateResult = capnp.layout.allocate(ref, segment, totalSize, capnp.layout.Kind.STRUCT, orphanArena);
    var ptr = allocateResult[0];
    segment = allocateResult[1];
    ref = allocateResult[2];
    ref.setStructRef(new capnp.layout.StructSize(newDataSize, newPointerCount));

    // Copy data section.
    memcpy(segment, ptr << 3, oldSegment, oldPtr << 3, oldDataSize * capnp.common.BYTES_PER_WORD);

    // Copy pointer section.
    var newPointerSection = ptr + newDataSize;
    for (var i = 0; i < oldPointerCount; i++) {
      transferPointer(segment, segment.createWirePointerAt((newPointerSection + i) << 3),
                      oldSegment, oldSegment.createWirePointerAt((oldPointerSection + i) << 3));
    }

    // Zero out old location.  This has two purposes:
    // 1) We don't want to leak the original contents of the struct when the message is written
    //    out as it may contain secrets that the caller intends to remove from the new copy.
    // 2) Zeros will be deflated by packing, making this dead memory almost-free if it ever
    //    hits the wire.
    memclear(oldSegment, oldPtr << 3,
             (oldDataSize + oldPointerCount * capnp.common.WORDS_PER_POINTER) * capnp.common.BYTES_PER_WORD);

    return new capnp.layout.StructBuilder(segment, (ptr << 3), newPointerSection, newDataSize * capnp.common.BITS_PER_WORD,
                                          newPointerCount, 0);
  } else {
    return new capnp.layout.StructBuilder(oldSegment, (oldPtr << 3), oldPointerSection, oldDataSize * capnp.common.BITS_PER_WORD,
                                          oldPointerCount, 0);
  }
};


capnp.layout.getWritableListPointer = function(origRef, origRefTarget, origSegment, elementSize, defaultValue, orphanArena) {

  if (elementSize === capnp.layout.FieldSize.INLINE_COMPOSITE) {
    throw new Error('Use getStructList{Element,Field}() for structs.');
  }

  if (origRef.isNull()) {
    if (defaultValue == null) {
      return new capnp.layout.ListBuilder(null, null, 0, 0, 0, 0);
    }

    var defaultSegment = new capnp.arena.SegmentReader(null, null, new DataView(defaultValue), null);
    var defaultPointer = defaultSegment.createWirePointerAt(0);
    if (defaultPointer.isNull()) {
      return new capnp.layout.ListBuilder(null, null, 0, 0, 0, 0);
    }

    var copyMessageResult = copyMessage(origSegment, origRef, defaultSegment, defaultPointer);
    origSegment = copyMessageResult[0];
    origRef = copyMessageResult[1];
    origRefTarget = copyMessageResult[2];
    defaultValue = null;  // If the default value is itself invalid, don't use it again.
  }

  // We must verify that the pointer has the right size.  Unlike in
  // getWritableStructListReference(), we never need to "upgrade" the data, because this
  // method is called only for non-struct lists, and there is no allowed upgrade path *to*
  // a non-struct list, only *from* them.

  var ref = origRef;
  var segment = origSegment;
  var followFarsResult = capnp.layout.followFars(ref, origRefTarget, segment);
  ref = followFarsResult[0];
  segment = followFarsResult[1];
  var ptr = followFarsResult[2];

  kj.debug.REQUIRE(ref.kind() === capnp.layout.Kind.LIST,
                   'Called getList{Field,Element}() but existing pointer is not a list (4).');

  var oldSize = ref.getListRef().elementSize();

  if (oldSize === capnp.layout.FieldSize.INLINE_COMPOSITE) {
    // The existing element size is INLINE_COMPOSITE, which means that it is at least two
    // words, which makes it bigger than the expected element size.  Since fields can only
    // grow when upgraded, the existing data must have been written with a newer version of
    // the protocol.  We therefore never need to upgrade the data in this case, but we do
    // need to validate that it is a valid upgrade from what we expected.

    // Read the tag to get the actual element count.
    var tag = segment.createWirePointerAt(ptr << 3);
    kj.debug.REQUIRE(tag.kind() === capnp.layout.Kind.STRUCT,
                     'INLINE_COMPOSITE list with non-STRUCT elements not supported.');
    ptr += capnp.common.POINTER_SIZE_IN_WORDS;

    var dataSize = tag.getStructRef().dataSize();
    var pointerCount = tag.getStructRef().ptrCount();

    switch (elementSize) {
    case capnp.layout.FieldSize.VOID:
      // Anything is a valid upgrade from Void.
      break;

    case capnp.layout.FieldSize.BIT:
    case capnp.layout.FieldSize.BYTE:
    case capnp.layout.FieldSize.TWO_BYTES:
    case capnp.layout.FieldSize.FOUR_BYTES:
    case capnp.layout.FieldSize.EIGHT_BYTES:
      kj.debug.REQUIRE(dataSize >= 1,
                       'Existing list value is incompatible with expected type.');
      break;

    case capnp.layout.FieldSize.POINTER:
      kj.debug.REQUIRE(pointerCount >= 1,
                       'Existing list value is incompatible with expected type.');
      // Adjust the pointer to point at the reference segment.
      ptr += dataSize;
      break;

    case capnp.layout.FieldSize.INLINE_COMPOSITE:
      kj.debug.FAIL_ASSERT("Can't get here.");
      break;
    }

    // OK, looks valid.

    return new capnp.layout.ListBuilder(segment, ptr,
                                        tag.getStructRef().wordSize() * capnp.common.BITS_PER_WORD,
                                        tag.inlineCompositeListElementCount(),
                                        dataSize * capnp.common.BITS_PER_WORD, pointerCount);

  } else {
    var dataSize = capnp.layout.dataBitsPerElement(oldSize);
    var pointerCount = capnp.layout.pointersPerElement(oldSize);

    kj.debug.REQUIRE(dataSize >= capnp.layout.dataBitsPerElement(elementSize),
                     'Existing list value is incompatible with expected type.');

    kj.debug.REQUIRE(pointerCount >= capnp.layout.pointersPerElement(elementSize),
                     'Existing list value is incompatible with expected type.');

    var step = dataSize + pointerCount * capnp.common.BITS_PER_POINTER;
    return new capnp.layout.ListBuilder(segment, ptr, step, ref.getListRef().elementCount(),
                                        dataSize, pointerCount);
  }
};

capnp.layout.getWritableStructListPointer = function(origRef, origRefTarget, origSegment, elementSize, defaultValue, orphanArena) {

  var preferredListEncoding = elementSize.getPreferredListEncoding();
  goog.asserts.assert(typeof(preferredListEncoding) === 'number');

  if (origRef.isNull()) {
    if (defaultValue == null) {
      return new capnp.layout.ListBuilder(null, null, 0, 0, 0, 0);
    }

    var defaultSegment = new capnp.arena.SegmentReader(null, null, new DataView(defaultValue), null);
    var defaultPointer = defaultSegment.createWirePointerAt(0);
    if (defaultPointer.isNull()) {
      return new capnp.layout.ListBuilder(null, null, 0, 0, 0, 0);
    }

    var copyMessageResult = copyMessage(origSegment, origRef, defaultSegment, defaultPointer);
    origSegment = copyMessageResult[0];
    origRef = copyMessageResult[1];
    origRefTarget = copyMessageResult[2];
    defaultValue = null;  // If the default value is itself invalid, don't use it again.
  }

  // We must verify that the pointer has the right size and potentially upgrade it if not.

  var oldRef = origRef;
  var oldSegment = origSegment;
  var followFarsResult = capnp.layout.followFars(oldRef, origRefTarget, oldSegment);
  oldRef = followFarsResult[0];
  oldSegment = followFarsResult[1];
  var oldPtr = followFarsResult[2];

  kj.debug.REQUIRE(oldRef.kind() === capnp.layout.Kind.LIST,
                   'Called getList{Field,Element}() ' +
                   'but existing pointer is not a list.');

  var oldSize = oldRef.getListRef().elementSize();

  if (oldSize === capnp.layout.FieldSize.INLINE_COMPOSITE) {

    // CHECKME -- xxx

    // Existing list is INLINE_COMPOSITE, but we need to verify that the sizes match.

    var oldTag = oldSegment.createWirePointerAt(oldPtr << 3);
    oldPtr += capnp.common.POINTER_SIZE_IN_WORDS;
    kj.debug.REQUIRE(oldTag.kind() === capnp.layout.Kind.STRUCT,
                     'INLINE_COMPOSITE list with non-STRUCT ' +
                     'elements not supported.');

    var oldDataSize = oldTag.getStructRef().dataSize();
    var oldPointerCount = oldTag.getStructRef().ptrCount();
    var oldStep = oldDataSize + oldPointerCount * capnp.common.WORDS_PER_POINTER;
    var elementCount = oldTag.inlineCompositeListElementCount();

    if (oldDataSize >= elementSize.getDataWordCount() && oldPointerCount >= elementSize.getPointerCount()) {
      // Old size is at least as large as we need.  Ship it.
      return new capnp.layout.ListBuilder(oldSegment, oldPtr, oldStep * capnp.common.BITS_PER_WORD, elementCount,
                                          oldDataSize * capnp.common.BITS_PER_WORD, oldPointerCount);
    }

    // The structs in this list are smaller than expected, probably written using an older
    // version of the protocol.  We need to make a copy and expand them.

    var newDataSize = Math.max(oldDataSize, elementSize.getDataWordCount());
    var newPointerCount = Math.max(oldPointerCount, elementSize.getPointerCount());
    var newStep = newDataSize + newPointerCount * capnp.common.WORDS_PER_POINTER;
    var totalSize = newStep * elementCount;

    // Don't let allocate() zero out the object just yet.
    zeroPointerAndFars(origSegment, origRef);

    var allocateResult = capnp.layout.allocate(origRef, origSegment, totalSize + capnp.common.POINTER_SIZE_IN_WORDS,
                                               capnp.layout.Kind.LIST, orphanArena);
    var newPtr = allocateResult[0];
    origSegment = allocateResult[1];
    origRef = allocateResult[2];
    origRef.setListRefInlineComposite(totalSize);

    var newTag = origSegment.createWirePointerAt(newPtr << 3);
    newTag.setKindAndInlineCompositeListElementCount(capnp.layout.Kind.STRUCT, elementCount);
    newTag.setStructRef(new capnp.layout.StructSize(newDataSize, newPointerCount));
    newPtr += capnp.common.POINTER_SIZE_IN_WORDS;

    goog.asserts.assert(kj.util.isRegularNumber(oldPtr));
    goog.asserts.assert(kj.util.isRegularNumber(newPtr));
    goog.asserts.assert(kj.util.isRegularNumber(oldStep));
    goog.asserts.assert(kj.util.isRegularNumber(newStep));
    goog.asserts.assert(kj.util.isRegularNumber(oldDataSize));
    goog.asserts.assert(kj.util.isRegularNumber(newDataSize));
    goog.asserts.assert(kj.util.isRegularNumber(oldPointerCount));
    goog.asserts.assert(kj.util.isRegularNumber(newPointerCount));

    var src = oldPtr;
    var dst = newPtr;
    for (var i = 0; i < elementCount; i++) {
      // Copy data section.
      memcpy(origSegment, dst << 3, oldSegment, src << 3, oldDataSize * capnp.common.BYTES_PER_WORD);

      // Copy pointer section.
      for (var j = 0; j < oldPointerCount; j++) {
        var newPointer = origSegment.createWirePointerAt((dst + newDataSize + j) << 3);
        var oldPointer = oldSegment.createWirePointerAt((src + oldDataSize + j) << 3);
        transferPointer(origSegment, newPointer, oldSegment, oldPointer);
      }

      dst += newStep;
      src += oldStep;
    }

    // Zero out old location.  See explanation in getWritableStructPointer().
    memclear(oldSegment, oldPtr << 3, oldStep * elementCount * capnp.common.BYTES_PER_WORD);

    return new capnp.layout.ListBuilder(origSegment, newPtr, newStep * capnp.common.BITS_PER_WORD, elementCount,
                                        newDataSize * capnp.common.BITS_PER_WORD, newPointerCount);

  } else if (oldSize === preferredListEncoding) {
    // Old size matches exactly.

    var dataSize = capnp.layout.dataBitsPerElement(oldSize);
    var pointerCount = capnp.layout.pointersPerElement(oldSize);
    var step = dataSize + pointerCount * capnp.common.BITS_PER_POINTER;

    return new capnp.layout.ListBuilder(oldSegment, oldPtr, step, oldRef.getListRef().elementCount(),
                                        dataSize, pointerCount);
  } else {

    switch (preferredListEncoding) {
    case capnp.layout.FieldSize.VOID:
      // No expectations.
      break;
    case capnp.layout.FieldSize.POINTER:
      kj.debug.REQUIRE(oldSize === capnp.layout.FieldSize.POINTER || oldSize === capnp.layout.FieldSize.VOID,
                       'Struct list has incompatible element size.');
      break;
    case capnp.layout.FieldSize.INLINE_COMPOSITE:
      // Old size can be anything.
      break;
    case capnp.layout.FieldSize.BIT:
    case capnp.layout.FieldSize.BYTE:
    case capnp.layout.FieldSize.TWO_BYTES:
    case capnp.layout.FieldSize.FOUR_BYTES:
    case capnp.layout.FieldSize.EIGHT_BYTES:
      // Preferred size is data-only.
      kj.debug.REQUIRE(oldSize !== capnp.layout.FieldSize.POINTER,
                       'Struct list has incompatible element size.');
      break;
    }

    // OK, the old size is compatible with the preferred, but is not exactly the same.  We may
    // need to upgrade it.

    var oldDataSize = capnp.layout.dataBitsPerElement(oldSize);
    var oldPointerCount = capnp.layout.pointersPerElement(oldSize);
    var oldStep = (oldDataSize + oldPointerCount * capnp.common.BITS_PER_POINTER);
    var elementCount = oldRef.getListRef().elementCount();

    if (oldSize >= preferredListEncoding) {
      // The old size is at least as large as the preferred, so we don't need to upgrade.
      return new capnp.layout.ListBuilder(oldSegment, oldPtr, oldStep, elementCount,
                                          oldDataSize, oldPointerCount);
    }

    // Upgrade is necessary.

    if (oldSize === capnp.layout.FieldSize.VOID) {
      // Nothing to copy, just allocate a new list.
      return capnp.layout.initStructListPointer(origRef, origSegment, elementCount, elementSize);
    } else if (preferredListEncoding === capnp.layout.FieldSize.INLINE_COMPOSITE) {
      // Upgrading to an inline composite list.

      var newDataSize = elementSize.getDataWordCount();
      var newPointerCount = elementSize.getPointerCount();

      if (oldSize === capnp.layout.FieldSize.POINTER) {
        newPointerCount = Math.max(newPointerCount, 1);
      } else {
        // Old list contains data elements, so we need at least 1 word of data.
        newDataSize = Math.max(newDataSize, 1);
      }

      var newStep = newDataSize + newPointerCount * capnp.common.WORDS_PER_POINTER;
      var totalWords = elementCount * newStep;

      // Don't let allocate() zero out the object just yet.
      zeroPointerAndFars(origSegment, origRef);

      var allocateResult = capnp.layout.allocate(origRef, origSegment, totalWords + capnp.common.POINTER_SIZE_IN_WORDS,
                                                 capnp.layout.Kind.LIST, orphanArena);
      var newPtr = allocateResult[0];
      origSegment = allocateResult[1];
      origRef = allocateResult[2];
      origRef.setListRefInlineComposite(totalWords);

      var tag = origSegment.createWirePointerAt(newPtr << 3);
      tag.setKindAndInlineCompositeListElementCount(capnp.layout.Kind.STRUCT, elementCount);
      tag.setStructRef(new capnp.layout.StructSize(newDataSize, newPointerCount));
      newPtr += capnp.common.POINTER_SIZE_IN_WORDS;

      if (oldSize === capnp.layout.FieldSize.POINTER) {
        var dst = newPtr + newDataSize;
        var src = oldPtr;
        for (var i = 0; i < elementCount; i++) {
          transferPointer(origSegment, origSegment.createWirePointerAt(dst << 3), oldSegment, oldSegment.createWirePointerAt(src << 3));
          dst += (newStep / capnp.common.WORDS_PER_POINTER) >>> 0;
          ++src;
        }
      } else if (oldSize === capnp.layout.FieldSize.BIT) {
        var dst = newPtr << 3;
        var src = oldPtr << 3;
        var dstArray = origSegment.getUint8Array();
        var srcArray = oldSegment.getUint8Array();
        for (var i = 0; i < elementCount; i++) {
          dstArray[dst] = (srcArray[src + (i >> 3)] >> (i % 8)) & 1;
          dst += newStep * capnp.common.BYTES_PER_WORD;
        }
      } else {
        var dst = newPtr << 3;
        var src = oldPtr << 3;
        var oldByteStep = (oldDataSize / capnp.common.BITS_PER_BYTE) >>> 0;
        for (var i = 0; i < elementCount; i++) {
          memcpy(origSegment, dst, oldSegment, src, oldByteStep);
          src += oldByteStep;
          dst += newStep * capnp.common.BYTES_PER_WORD;
        }
      }

      // Zero out old location.  See explanation in getWritableStructPointer().
      memclear(oldSegment, oldPtr << 3, capnp.common.roundBitsUpToBytes(oldStep * elementCount));

      return new capnp.layout.ListBuilder(origSegment, newPtr, newStep * capnp.common.BITS_PER_WORD, elementCount,
                                          newDataSize * capnp.common.BITS_PER_WORD, newPointerCount);

    } else {

      // If oldSize were POINTER or EIGHT_BYTES then the preferred size must be
      // INLINE_COMPOSITE because any other compatible size would not require an upgrade.
      goog.asserts.assert(oldSize < capnp.layout.FieldSize.EIGHT_BYTES);

      // If the preferred size were BIT then oldSize must be VOID, but we handled that case
      // above.
      goog.asserts.assert(preferredListEncoding >= capnp.layout.FieldSize.BIT);

      // OK, so the expected list elements are all data and between 1 byte and 1 word each,
      // and the old element are data between 1 bit and 4 bytes.  We're upgrading from one
      // primitive data type to another, larger one.

      var newDataSize =
        capnp.layout.dataBitsPerElement(preferredListEncoding);

      var totalWords =
        capnp.common.roundBitsUpToWords(newDataSize * elementCount);

      // Don't let allocate() zero out the object just yet.
      zeroPointerAndFars(origSegment, origRef);

      var allocateResult = capnp.layout.allocate(origRef, origSegment, totalWords, capnp.layout.Kind.LIST, orphanArena);
      var newPtr = allocateResult[0];
      origSegment = allocateResult[1];
      origRef = allocateResult[2];
      origRef.setListRef(preferredListEncoding, elementCount);

      var newBytePtr = newPtr << 3;
      var oldBytePtr = oldPtr << 3;
      var newDataByteSize = (newDataSize / capnp.common.BITS_PER_BYTE) >>> 0;
      if (oldSize === capnp.layout.FieldSize.BIT) {
        for (var i = 0; i < elementCount; i++) {
          origSegment.getUint8Array()[newBytePtr] = (oldSegment.getUint8Array()[oldBytePtr + (i >> 3)] >> (i % 8)) & 1;
          newBytePtr += newDataByteSize;
        }
      } else {
        var oldDataByteSize = (oldDataSize / capnp.common.BITS_PER_BYTE) >>> 0;
        for (var i = 0; i < elementCount; i++) {
          memcpy(origSegment, newBytePtr, oldSegment, oldBytePtr, oldDataByteSize);
          oldBytePtr += oldDataByteSize;
          newBytePtr += newDataByteSize;
        }
      }

      // Zero out old location.  See explanation in getWritableStructPointer().
      memclear(oldSegment, oldPtr << 3, capnp.common.roundBitsUpToBytes(oldStep * elementCount));

      return new capnp.layout.ListBuilder(origSegment, newPtr, newDataSize, elementCount,
                                          newDataSize, 0);
    }
  }
};


capnp.layout.readTextPointer = function(segment, ref, refTarget, defaultValue, defaultSize) {

  if (ref === null || ref.isNull()) {

    if (!defaultValue || !defaultSize) {
      return new capnp.blob.Text.Reader(null, 0, 0);
    }

    var defaultSegment = new capnp.arena.SegmentReader(null, null, new DataView(defaultValue), null);
    return new capnp.blob.Text.Reader(defaultSegment, 0, defaultSize);
  }
  else {
    var followFarsResult = capnp.layout.followFars(ref, refTarget, segment);
    ref = followFarsResult[0];
    segment = followFarsResult[1];
    var ptr = followFarsResult[2];

    var size = ref.getListRef().elementCount();

    kj.debug.REQUIRE(ref.kind() === capnp.layout.Kind.LIST,
                     'Message contains non-list pointer where text was expected.');

    kj.debug.REQUIRE(ref.getListRef().elementSize() === capnp.layout.FieldSize.BYTE,
                     'Message contains list pointer of non-bytes where text was expected.');

    kj.debug.REQUIRE(boundsCheck(segment, ptr, ptr + capnp.common.roundBytesUpToWords(ref.getListRef().elementCount())),
                     'Message contained out-of-bounds text pointer.');
  }

  kj.debug.REQUIRE(size > 0,
                   'Message contains text that is not NUL-terminated.');

  size -= 1;  // NUL terminator

  kj.debug.REQUIRE(segment.getUint8Array()[ptr * 8 + size] === 0,
                   'Message contains text that is not NUL-terminated.');

  return new capnp.blob.Text.Reader(segment, ptr, size);
};

capnp.layout.readDataPointer = function(segment, ref, refTarget, defaultValue, defaultSize) {

  goog.asserts.assert(kj.util.isRegularNumber(defaultSize), 'defaultSize not a regular number: ' + defaultSize);

  if (ref === null || ref.isNull()) {
    return new capnp.blob.Data.Reader(defaultValue, defaultSize);
  } else {
    var followFarsResult = capnp.layout.followFars(ref, refTarget, segment);
    ref = followFarsResult[0];
    segment = followFarsResult[1];
    var ptr = followFarsResult[2];

    var size = ref.getListRef().elementCount();

    kj.debug.REQUIRE(ref.kind() === capnp.layout.Kind.LIST,
                     'Message contains non-list pointer where data was expected.');

    kj.debug.REQUIRE(ref.getListRef().elementSize() === capnp.layout.FieldSize.BYTE,
                     'Message contains list pointer of non-bytes where data was expected.');

    kj.debug.REQUIRE(boundsCheck(segment, ptr, ptr +
                                 capnp.common.roundBytesUpToWords(ref.getListRef().elementCount())),
                     'Message contained out-of-bounds data pointer.');

    return new capnp.blob.Data.Reader(segment.getUint8Array().subarray(ptr * 8, ptr * 8 + size), size);
  }
};

capnp.layout.readStructPointer = function(segment, ref, refTarget, defaultValue, nestingLimit) {

  if (ref == null || ref.isNull()) {
    if (defaultValue == null) {
      return new capnp.layout.StructReader(null, 0, 0, 0, 0, 0, Number.MAX_VALUE);
    }

    var defaultPointer = new capnp.layout.WirePointer(0, new DataView(defaultValue, 0, 8));
    if (defaultPointer.isNull()) {
      return new capnp.layout.StructReader(null, 0, 0, 0, 0, 0, Number.MAX_VALUE);
    }

    segment = new capnp.arena.SegmentReader(null, null, new DataView(defaultValue), null);
    ref = defaultPointer;
    refTarget = ref.target();
    defaultValue = null;  // If the default value is itself invalid, don't use it again.
  }

  kj.debug.REQUIRE(nestingLimit > 0,
                   'Message is too deeply-nested or contains cycles.  See capnp.ReadOptions.');

  var followFarsResult = capnp.layout.followFars(ref, refTarget, segment);
  ref = followFarsResult[0];
  segment = followFarsResult[1];
  var ptr = followFarsResult[2];

  kj.debug.REQUIRE(ref.kind() === capnp.layout.Kind.STRUCT,
                   'Message contains non-struct pointer where struct pointer was expected. ');

  kj.debug.REQUIRE(boundsCheck(segment, ptr, ptr + ref.getStructRef().wordSize()),
                   'Message contained out-of-bounds struct pointer.');

  return new capnp.layout.StructReader(
    segment, (ptr << 3), ptr + ref.getStructRef().dataSize(),
    ref.getStructRef().dataSize() * capnp.common.BITS_PER_WORD,
    ref.getStructRef().ptrCount(),
    0,
    nestingLimit - 1);
};

capnp.layout.readListPointer = function(segment, ref, refTarget, defaultValue, expectedElementSize, nestingLimit) {

  if (ref === null || ref.isNull()) {

    if (defaultValue == null) {
      return new capnp.layout.ListReader(null, null, 0, 0, 0, 0, Number.MAX_VALUE);
    }

    var defaultPointer = new capnp.layout.WirePointer(0, new DataView(defaultValue, 0, 8));
    if (defaultPointer.isNull()) {
      return new capnp.layout.ListReader(null, null, 0, 0, 0, 0, Number.MAX_VALUE);
    }

    segment = new capnp.arena.SegmentReader(null, null, new DataView(defaultValue), null);
    ref = defaultPointer;
    refTarget = ref.target();
    defaultValue = null;  // If the default value is itself invalid, don't use it again.
  }

  kj.debug.REQUIRE(nestingLimit > 0,
                   'Message is too deeply-nested or contains cycles.  See capnp::ReadOptions.');

  var followFarsResult = capnp.layout.followFars(ref, refTarget, segment);
  ref = followFarsResult[0];
  segment = followFarsResult[1];
  var ptr = followFarsResult[2];

  kj.debug.REQUIRE(ref.kind() === capnp.layout.Kind.LIST,
                   'Message contains non-list pointer where list pointer was expected.');

  if (ref.getListRef().elementSize() === capnp.layout.FieldSize.INLINE_COMPOSITE) {

    var wordsPerElement;
    var size;

    var wordCount = ref.getListRef().inlineCompositeWordCount();

    // An INLINE_COMPOSITE list points to a tag, which is formatted like a pointer.
    var tag = segment.createWirePointerAt(ptr << 3);
    ptr += capnp.common.POINTER_SIZE_IN_WORDS;

    kj.debug.REQUIRE(boundsCheck(segment, ptr - capnp.common.POINTER_SIZE_IN_WORDS, ptr + wordCount),
                     'Message contains out-of-bounds list pointer.');

    kj.debug.REQUIRE(tag.kind() === capnp.layout.Kind.STRUCT,
                     'INLINE_COMPOSITE lists of non-STRUCT type are not supported.');

    size = tag.inlineCompositeListElementCount();
    wordsPerElement = tag.getStructRef().wordSize();

    kj.debug.REQUIRE(size * wordsPerElement <= wordCount,
                     "INLINE_COMPOSITE list's elements overrun its word count.");

    // If a struct list was not expected, then presumably a non-struct list was upgraded to a
    // struct list.  We need to manipulate the pointer to point at the first field of the
    // struct.  Together with the "stepBits", this will allow the struct list to be accessed as
    // if it were a primitive list without branching.

    // Check whether the size is compatible.
    switch (expectedElementSize) {
    case capnp.layout.FieldSize.VOID:
      break;

    case capnp.layout.FieldSize.BIT:
    case capnp.layout.FieldSize.BYTE:
    case capnp.layout.FieldSize.TWO_BYTES:
    case capnp.layout.FieldSize.FOUR_BYTES:
    case capnp.layout.FieldSize.EIGHT_BYTES:
      kj.debug.REQUIRE(tag.getStructRef().dataSize() > 0,
                       'Expected a primitive list, but got a list of pointer-only structs.');
      break;

    case capnp.layout.FieldSize.POINTER:
      // We expected a list of pointers but got a list of structs.  Assuming the first field
      // in the struct is the pointer we were looking for, we want to munge the pointer to
      // point at the first element's pointer section.
      ptr += (tag.getStructRef().dataSize() / capnp.common.BITS_PER_WORD) >>> 0;
      kj.debug.REQUIRE(tag.getStructRef().ptrCount() > 0,
                       'Expected a pointer list, but got a list of data-only structs.');
      break;

    case capnp.layout.FieldSize.INLINE_COMPOSITE:
      break;
    }

    return new capnp.layout.ListReader(
      segment, ptr, size, wordsPerElement * capnp.common.BITS_PER_WORD,
      tag.getStructRef().dataSize() * capnp.common.BITS_PER_WORD,
      tag.getStructRef().ptrCount(), nestingLimit - 1);

  } else {

    // This is a primitive or pointer list, but all such lists can also be interpreted as struct
    // lists.  We need to compute the data size and pointer count for such structs.
    var dataSize = capnp.layout.dataBitsPerElement(ref.getListRef().elementSize());
    var pointerCount =
      capnp.layout.pointersPerElement(ref.getListRef().elementSize());
    var step = dataSize + pointerCount * capnp.common.BITS_PER_POINTER;

    kj.debug.REQUIRE(boundsCheck(segment, ptr, ptr +
                                 capnp.common.roundBitsUpToWords(ref.getListRef().elementCount() * step)),
                     'Message contains out-of-bounds list pointer.');

    // Verify that the elements are at least as large as the expected type.  Note that if we
    // expected INLINE_COMPOSITE, the expected sizes here will be zero, because bounds checking
    // will be performed at field access time.  So this check here is for the case where we
    // expected a list of some primitive or pointer type.

    var expectedDataBitsPerElement =
      capnp.layout.dataBitsPerElement(expectedElementSize);
    var expectedPointersPerElement =
      capnp.layout.pointersPerElement(expectedElementSize);

    kj.debug.REQUIRE(expectedDataBitsPerElement <= dataSize,
                     'Message contained list with incompatible element type.');

    kj.debug.REQUIRE(expectedPointersPerElement <= pointerCount,
                     'Message contained list with incompatible element type.');

    return new capnp.layout.ListReader(segment, ptr, ref.getListRef().elementCount(), step,
                                       dataSize, pointerCount, nestingLimit - 1);
  }
};


capnp.layout.totalSize = function(segment, ref, nestingLimit) {
  // Compute the total size of the object pointed to, not counting far pointer overhead.

  if (ref.isNull()) {
    return 0;
  }

  kj.debug.REQUIRE(nestingLimit > 0, 'Message is too deeply-nested.');
  --nestingLimit;

  var followFarsResult = capnp.layout.followFars(ref, ref.target(), segment);
  ref = followFarsResult[0];
  segment = followFarsResult[1];
  var ptr = followFarsResult[2];

  var result = 0;

  switch (ref.kind()) {
  case capnp.layout.Kind.STRUCT: {
    kj.debug.REQUIRE(boundsCheck(segment, ptr, ptr + ref.getStructRef().wordSize()),
                     'Message contained out-of-bounds struct pointer.');
    result += ref.getStructRef().wordSize();

    var pointerSection = ptr + ref.getStructRef().dataSize();
    var count = ref.getStructRef().ptrCount();
    for (var i = 0; i < count; i++) {
      result += capnp.layout.totalSize(segment, segment.createWirePointerAt((pointerSection + i) << 3), nestingLimit);
    }
    break;
  }
  case capnp.layout.Kind.LIST: {
    switch (ref.getListRef().elementSize()) {
    case capnp.layout.FieldSize.VOID:
      // Nothing.
      break;
    case capnp.layout.FieldSize.BIT:
    case capnp.layout.FieldSize.BYTE:
    case capnp.layout.FieldSize.TWO_BYTES:
    case capnp.layout.FieldSize.FOUR_BYTES:
    case capnp.layout.FieldSize.EIGHT_BYTES: {
      var totalWords = capnp.common.roundBitsUpToWords(
        ref.getListRef().elementCount() *
          capnp.layout.dataBitsPerElement(ref.getListRef().elementSize()));
      kj.debug.REQUIRE(boundsCheck(segment, ptr, ptr + totalWords),
                       'Message contained out-of-bounds list pointer.');
      result += totalWords;
      break;
    }
    case capnp.layout.FieldSize.POINTER: {
      var count = ref.getListRef().elementCount();

      kj.debug.REQUIRE(boundsCheck(segment, ptr, ptr + count * capnp.common.WORDS_PER_POINTER),
                       'Message contained out-of-bounds list pointer.');

      result += count * capnp.common.WORDS_PER_POINTER;

      for (var i = 0; i < count; i++) {
        result += capnp.layout.totalSize(segment, segment.createWirePointerAt((ptr + i) << 3),
                                         nestingLimit);
      }
      break;
    }
    case capnp.layout.FieldSize.INLINE_COMPOSITE: {
      var wordCount = ref.getListRef().inlineCompositeWordCount();
      kj.debug.REQUIRE(boundsCheck(segment, ptr, ptr + wordCount + capnp.common.POINTER_SIZE_IN_WORDS),
                       'Message contained out-of-bounds list pointer.');

      result += wordCount + capnp.common.POINTER_SIZE_IN_WORDS;

      var elementTag = segment.createWirePointerAt(ptr << 3);
      var count = elementTag.inlineCompositeListElementCount();

      kj.debug.REQUIRE(elementTag.kind() === capnp.layout.Kind.STRUCT,
                       "Don't know how to handle non-STRUCT inline composite.");

      kj.debug.REQUIRE(elementTag.getStructRef().wordSize() * count <= wordCount,
                       "Struct list pointer's elements overran size.");

      var dataSize = elementTag.getStructRef().dataSize();
      var pointerCount = elementTag.getStructRef().ptrCount();

      var pos = ptr + capnp.common.POINTER_SIZE_IN_WORDS;
      for (var i = 0; i < count; i++) {
        pos += dataSize;

        for (var j = 0; j < pointerCount; j++) {
          result += capnp.layout.totalSize(segment, segment.createWirePointerAt(pos << 3),
                                           nestingLimit);
          pos += capnp.common.POINTER_SIZE_IN_WORDS;
        }
      }
      break;
    }
    }
    break;
  }
  case capnp.layout.Kind.FAR:
    kj.debug.FAIL_ASSERT('Unexpected FAR pointer.');
    break;
  case capnp.layout.Kind.RESERVED_3:
    kj.debug.FAIL_REQUIRE("Don't know how to handle RESERVED_3.");
    break;
  }

  return result;
};

capnp.layout.setListPointer = function(segment, ref, value, orphanArena) {
  var totalSize = capnp.common.roundBitsUpToWords(value.elementCount * value.step);

  if (value.step <= capnp.common.BITS_PER_WORD) {

    // List of non-structs.
    var allocateResult = capnp.layout.allocate(ref, segment, totalSize, capnp.layout.Kind.LIST, orphanArena);
    var ptr = allocateResult[0];
    segment = allocateResult[1];
    ref = allocateResult[2];

    if (value.structPointerCount === 1) {

      // List of pointers.
      ref.setListRef(capnp.layout.FieldSize.POINTER, value.elementCount);
      for (var i = 0; i < value.elementCount; i++) {
        var valueRef = value.segment.createWirePointerAt((value.ptr + i) << 3);
        capnp.layout.setObjectPointer(segment, segment.createWirePointerAt((ptr + i) << 3), capnp.layout.readObjectPointer(
          value.segment, valueRef, valueRef.target(), null, value.nestingLimit));
      }

    } else {

      // List of data.
      var elementSize = capnp.layout.FieldSize.VOID;
      switch (value.step) {
      case 0: elementSize = capnp.layout.FieldSize.VOID; break;
      case 1: elementSize = capnp.layout.FieldSize.BIT; break;
      case 8: elementSize = capnp.layout.FieldSize.BYTE; break;
      case 16: elementSize = capnp.layout.FieldSize.TWO_BYTES; break;
      case 32: elementSize = capnp.layout.FieldSize.FOUR_BYTES; break;
      case 64: elementSize = capnp.layout.FieldSize.EIGHT_BYTES; break;
      default:
        kj.debug.FAIL_ASSERT('invalid list step size', value.step);
        break;
      }

      ref.setListRef(elementSize, value.elementCount);

      var destUint8Array = segment.getUint8Array();
      var srcUint8Array = value.segment.getUint8Array();

      destUint8Array.set(srcUint8Array.subarray(value.ptr << 3, (value.ptr << 3) + totalSize * capnp.common.BYTES_PER_WORD), ptr << 3);
    }

    return [segment, ptr];
  } else {

    // List of structs.
    var allocateResult = capnp.layout.allocate(ref, segment, totalSize + capnp.common.POINTER_SIZE_IN_WORDS, capnp.layout.Kind.LIST,
                                               orphanArena);
    var ptr = allocateResult[0];
    segment = allocateResult[1];
    ref = allocateResult[2];
    ref.setListRefInlineComposite(totalSize);

    var dataSize = capnp.common.roundBitsUpToWords(value.structDataSize);
    var pointerCount = value.structPointerCount;

    var tag = segment.createWirePointerAt(ptr << 3);
    tag.setKindAndInlineCompositeListElementCount(capnp.layout.Kind.STRUCT, value.elementCount);
    tag.setStructRef(new capnp.layout.StructSize(dataSize, pointerCount));
    var dst = ptr + capnp.common.POINTER_SIZE_IN_WORDS;

    var src = value.ptr;
    for (var i = 0; i < value.elementCount; i++) {
      memcpy(segment, dst << 3, value.segment, src << 3, value.structDataSize / capnp.common.BITS_PER_BYTE);
      dst += dataSize;
      src += dataSize;

      for (var j = 0; j < pointerCount; j++) {
        var valueRef = value.segment.createWirePointerAt(src << 3);
        capnp.layout.setObjectPointer(segment, segment.createWirePointerAt(dst << 3),
                                      capnp.layout.readObjectPointer(value.segment, valueRef, valueRef.target(), null,
                                                                     value.nestingLimit));
        dst += capnp.common.POINTER_SIZE_IN_WORDS;
        src += capnp.common.POINTER_SIZE_IN_WORDS;
      }
    }

    return [segment, ptr];
  }
};

capnp.layout.readObjectPointer = function(segment, ref, refTarget, defaultValue, nestingLimit) {
  // We can't really reuse readStructPointer() and readListPointer() because they are designed
  // for the case where we are expecting a specific type, and they do validation around that,
  // whereas this method is for the case where we accept any pointer.
  //
  // Not always-inline because it is called from several places in the copying code, and anyway
  // is relatively rarely used.

  goog.asserts.assert(kj.util.isRegularNumber(nestingLimit));

  if (ref === null || ref.isNull()) {
    if (defaultValue == null || segment.createWirePointerAt(defaultValue << 3).isNull()) {
      return new capnp.layout.ObjectReader();
    }
    segment = null;
    ref = segment.createWirePointerAt(defaultValue << 3);
    refTarget = ref.target();
    defaultValue = null;  // If the default value is itself invalid, don't use it again.
  }

  var followFarsResult = capnp.layout.followFars(ref, refTarget, segment);
  ref = followFarsResult[0];
  segment = followFarsResult[1];
  var ptr = followFarsResult[2];

  switch (ref.kind()) {
  case capnp.layout.Kind.STRUCT:
    kj.debug.REQUIRE(nestingLimit > 0,
                     'Message is too deeply-nested or contains cycles.  See capnp::ReadOptions.');

    kj.debug.REQUIRE(boundsCheck(segment, ptr, ptr + ref.getStructRef().wordSize()),
                     'Message contained out-of-bounds struct pointer.');

    return new capnp.layout.ObjectReader(
      new capnp.layout.StructReader(segment, ptr << 3,
                                    ptr + ref.getStructRef().dataSize(),
                                    ref.getStructRef().dataSize() * capnp.common.BITS_PER_WORD,
                                    ref.getStructRef().ptrCount(),
                                    0, nestingLimit - 1));
  case capnp.layout.Kind.LIST: {
    var elementSize = ref.getListRef().elementSize();

    kj.debug.REQUIRE(nestingLimit > 0,
                     'Message is too deeply-nested or contains cycles.  See capnp::ReadOptions.');

    if (elementSize === capnp.layout.FieldSize.INLINE_COMPOSITE) {
      var wordCount = ref.getListRef().inlineCompositeWordCount();
      var tag = segment.createWirePointerAt(ptr << 3);
      ptr += capnp.common.POINTER_SIZE_IN_WORDS;

      kj.debug.REQUIRE(boundsCheck(segment, ptr - capnp.common.POINTER_SIZE_IN_WORDS, ptr + wordCount),
                       'Message contains out-of-bounds list pointer.');

      kj.debug.REQUIRE(tag.kind() === capnp.layout.Kind.STRUCT,
                       'INLINE_COMPOSITE lists of non-STRUCT type are not supported.');

      var elementCount = tag.inlineCompositeListElementCount();
      var wordsPerElement = tag.getStructRef().wordSize();

      kj.debug.REQUIRE(wordsPerElement * elementCount <= wordCount,
                       "INLINE_COMPOSITE list's elements overrun its word count.");

      return new capnp.layout.ObjectReader(
        new capnp.layout.ListReader(segment, ptr, elementCount, wordsPerElement * capnp.common.BITS_PER_WORD,
                                    tag.getStructRef().dataSize() * capnp.common.BITS_PER_WORD,
                                    tag.getStructRef().ptrCount(), nestingLimit - 1));
    } else {
      var dataSize = capnp.layout.dataBitsPerElement(elementSize);
      var pointerCount = capnp.layout.pointersPerElement(elementSize);
      var step = dataSize + pointerCount * capnp.common.BITS_PER_POINTER;
      var elementCount = ref.getListRef().elementCount();
      var wordCount = capnp.common.roundBitsUpToWords(elementCount * step);

      kj.debug.REQUIRE(boundsCheck(segment, ptr, ptr + wordCount),
                       'Message contains out-of-bounds list pointer.');

      return new capnp.layout.ObjectReader(
        new capnp.layout.ListReader(segment, ptr, elementCount, step, dataSize, pointerCount,
                                    nestingLimit - 1));
    }
  }
  default:
    kj.debug.FAIL_REQUIRE('Message contained invalid pointer.');
  }
};


/**
 * @constructor
 */
capnp.layout.ObjectReader = function(reader) {

  this.getReader = function() { return reader; };
};

capnp.layout.setObjectPointer = function(segment, ref, value) {
  var reader = value.getReader();
  if (!reader) {
    ref.clear();
  }
  else if (reader instanceof capnp.layout.StructReader) {
    capnp.layout.setStructPointer(segment, ref, reader);
  }
  else if (reader instanceof capnp.layout.ListReader) {
    capnp.layout.setListPointer(segment, ref, reader);
  }
};


capnp.layout.setStructPointer = function(segment, ref, value, orphanArena) {

  var dataSize = capnp.common.roundBitsUpToWords(value.dataSize);
  var totalSize = dataSize + value.pointerCount;

  var allocateResult = capnp.layout.allocate(ref, segment, totalSize, capnp.layout.Kind.STRUCT, orphanArena);
  var ptr = allocateResult[0];
  segment = allocateResult[1];
  ref = allocateResult[2];
  ref.setStructRef(new capnp.layout.StructSize(dataSize, value.pointerCount));

  if (value.dataSize === 1) {
    throw new Error('NYI');
    // *reinterpret_cast<char*>(ptr) = value.getDataField<bool>(0 * ELEMENTS);
  } else {
    memcpy(segment, ptr << 3, value.segment, value.data, value.dataSize / capnp.common.BITS_PER_BYTE);
  }

  for (var i = 0; i < value.pointerCount; i++) {
    var valueRef = value.segment.createWirePointerAt((value.pointers + i) << 3);
    capnp.layout.setObjectPointer(segment, segment.createWirePointerAt((ptr + dataSize + i) << 3),
                                  capnp.layout.readObjectPointer(value.segment, valueRef, valueRef.target(),
                                                                 null, value.nestingLimit));
  }

  // FIXME: return map instead
  return [segment, ptr];
};

/**
 * @constructor
 */
capnp.layout.StructSize = function(dataWordCount, pointerCount, preferredListEncoding) {
  this.getDataWordCount = function() { return dataWordCount; };
  this.getPointerCount = function() { return pointerCount; };
  this.getPreferredListEncoding = function() { return preferredListEncoding; };
  this.getTotal = function() { return dataWordCount + pointerCount * capnp.common.WORDS_PER_POINTER; };
  this.toString = function() { return 'StructSize(dataWordCount=' + dataWordCount + ',pointerCount=' + pointerCount + ',preferredListEncoding=' + preferredListEncoding + ')'; };
  return this;
};

capnp.layout.disown = function(segment, ref) {

  var location;

  if (ref.isNull()) {
    location = null;
  } else {
    var followFarsResult = capnp.layout.followFars(ref, ref.target(), segment);
    segment = followFarsResult[1];
    location = followFarsResult[2];
  }

  var result = new capnp.layout.OrphanBuilder(ref, segment, location);

  if (!ref.isNull() && ref.kind() !== capnp.layout.Kind.FAR) {
    result.tagAsPtr().setKindForOrphan(ref.kind());
  }

  // Zero out the pointer that was disowned.
  ref.clear();

  return result;
}

capnp.layout.adopt = function(segment, ref, value) {

  kj.debug.REQUIRE(value.segment === null || value.segment.getArena() === segment.getArena(),
                   "Adopted object must live in the same message.");

  if (!ref.isNull()) {
    capnp.layout.zeroObject(segment, ref);
  }

  if (value === null) {
    // Set null.
    memclear(segment, ref.getByteOffset(), 0, capnp.layout.WirePointer.SIZE_IN_BYTES);
  } else if (value.tagAsPtr().kind() === capnp.layout.Kind.FAR) {
    // FAR pointers are position-independent, so we can just copy.
    ref.setOffsetAndKind(value.tagAsPtr().getOffsetAndKind());
    ref.setUpper32Bits(value.tagAsPtr().getUpper32Bits());
  } else {
    transferPointerWithSrcPtr(segment, ref, value.segment, value.tagAsPtr(), value.location);
  }

  // Take ownership away from the OrphanBuilder.
  value.tagAsPtr().clear();
  value.location = null;
  value.segment = null;
}


/**
 * @constructor
 */
capnp.layout.OrphanBuilder = function(ref, segment, location) {
  orphanBuffer = new ArrayBuffer(capnp.layout.WirePointer.SIZE_IN_BYTES);
  this.tag = new capnp.layout.WirePointer(0, new DataView(orphanBuffer));
  if (ref) {
    this.segment = segment;
    this.location = location;
    this.tag.setOffsetAndKind(ref.getOffsetAndKind());
    this.tag.setUpper32Bits(ref.getUpper32Bits());
  }
  else {
    this.segment = null;
    this.location = null;
    this.tag.clear();
  }
};

capnp.layout.OrphanBuilder.prototype.tagAsPtr = function() {
  return this.tag;
};

capnp.layout.OrphanBuilder.prototype.asStructReader = function(size) {
  kj.debug.DASSERT(this.tagAsPtr().isNull() === (this.location === null));
  return capnp.layout.readStructPointer(this.segment, this.tagAsPtr(), this.location, null, Number.MAX_VALUE);
}

capnp.layout.OrphanBuilder.prototype.asStruct = function(size) {
  kj.debug.DASSERT(this.tagAsPtr().isNull() === (this.location === null));

  var result = capnp.layout.getWritableStructPointer(
    this.tagAsPtr(), this.location, this.segment, size, null, this.segment.getArena());

  // Watch out, the pointer could have been updated if the object had to be relocated.
  this.location = result.data >>> 3;

  return result;
}

capnp.layout.OrphanBuilder.prototype.asList = function(elementSize) {

  kj.debug.DASSERT(this.tagAsPtr().isNull() === (this.location == null));

  var result = capnp.layout.getWritableListPointer(
    this.tagAsPtr(), this.location, this.segment, elementSize, null, this.segment.getArena());

  // Watch out, the pointer could have been updated if the object had to be relocated.
  // (Actually, currently this is not true for primitive lists, but let's not turn into a bug if
  // it changes!)
  this.location = result.getLocation();

  return result;
};

capnp.layout.OrphanBuilder.prototype.asListReader = function(elementSize) {
  kj.debug.DASSERT(this.tagAsPtr().isNull() === (this.location == null));
  return capnp.layout.readListPointer(
    this.segment, this.tagAsPtr(), this.location, null, elementSize, Number.MAX_VALUE);
};

capnp.layout.OrphanBuilder.prototype.asStructList = function(elementSize) {
  kj.debug.DASSERT(this.tagAsPtr().isNull() === (this.location == null));

  var result = capnp.layout.getWritableStructListPointer(
    this.tagAsPtr(), this.location, this.segment, elementSize, null, this.segment.getArena());

  // Watch out, the pointer could have been updated if the object had to be relocated.
  this.location = result.getLocation();

  return result;
};

capnp.layout.OrphanBuilder.prototype.asText = function(elementSize) {
  kj.debug.DASSERT(this.tagAsPtr().isNull() === (this.location == null));

  // Never relocates.
  return capnp.layout.getWritableTextPointer(this.tagAsPtr(), this.location, this.segment, null, 0);
};

capnp.layout.OrphanBuilder.prototype.asData = function(elementSize) {
  kj.debug.DASSERT(this.tagAsPtr().isNull() === (this.location == null));

  // Never relocates.
  return capnp.layout.getWritableDataPointer(this.tagAsPtr(), this.location, this.segment, null, 0);
};


capnp.layout.OrphanBuilder.prototype.asTextReader = function(elementSize) {
  kj.debug.DASSERT(this.tagAsPtr().isNull() === (this.location == null));
  return capnp.layout.readTextPointer(this.segment, this.tagAsPtr(), this.location, '', 0);
}

capnp.layout.OrphanBuilder.prototype.asDataReader = function(elementSize) {
  kj.debug.DASSERT(this.tagAsPtr().isNull() === (this.location == null));
  return capnp.layout.readDataPointer(this.segment, this.tagAsPtr(), this.location, null, 0);
}

capnp.layout.OrphanBuilder.prototype.destroy = function() {
  if (this.segment != null) this.euthanize();
};

capnp.layout.OrphanBuilder.prototype.euthanize = function() {
  if (this.tagAsPtr().kind() === capnp.layout.Kind.FAR) {
    zeroObject(this.segment, this.tagAsPtr());
  } else {
    zeroObjectTag(this.segment, this.tagAsPtr(), this.location);
  }

  this.tag.clear();
  this.segment = null;
  this.location = null;
};

capnp.layout.OrphanBuilder.prototype.isNull = function() {
  return this.location == null;
};

capnp.layout.OrphanBuilder.initStruct = function(arena, size) {
  var result = new capnp.layout.OrphanBuilder();
  var builder = capnp.layout.initStructPointer(result.tagAsPtr(), null, size, arena);
  result.segment = builder.segment;
  result.location = builder.getLocation();
  return result;
}

capnp.layout.OrphanBuilder.initList = function(arena, elementCount, elementSize) {
  var result = new capnp.layout.OrphanBuilder();
  var builder = capnp.layout.initListPointer(
    result.tagAsPtr(), null, elementCount, elementSize, arena);
  result.segment = builder.segment;
  result.location = builder.getLocation();
  return result;
};

capnp.layout.OrphanBuilder.initStructList = function(arena, elementCount, elementSize) {
  var result = new capnp.layout.OrphanBuilder();
  var builder = capnp.layout.initStructListPointer(
    result.tagAsPtr(), null, elementCount, elementSize, arena);
  result.segment = builder.segment;
  result.location = builder.getLocation();
  return result;
};

capnp.layout.OrphanBuilder.initText = function(arena, size) {
  var result = new capnp.layout.OrphanBuilder();
  var allocation = capnp.layout.initTextPointer(result.tagAsPtr(), null, size, arena);
  result.segment = allocation.segment;
  result.location = allocation.value.begin() >>> 3;
  return result;
};

capnp.layout.OrphanBuilder.initData = function(arena, size) {
  var result = new capnp.layout.OrphanBuilder();
  var allocation = capnp.layout.initDataPointer(result.tagAsPtr(), null, size, arena);
  result.segment = allocation.segment;
  result.location = allocation.value.begin() >>> 3;
  return result;
};

capnp.layout.OrphanBuilder.copyStruct = function(arena, copyFrom) {
  var result = new capnp.layout.OrphanBuilder();
  var allocation = capnp.layout.setStructPointer(null, result.tagAsPtr(), copyFrom, arena);
  result.segment = allocation[0];
  result.location = allocation[1];
  return result;
};

capnp.layout.OrphanBuilder.copyList = function(arena, copyFrom) {
  var result = new capnp.layout.OrphanBuilder();
  var allocation = capnp.layout.setListPointer(null, result.tagAsPtr(), copyFrom, arena);
  result.segment = allocation[0];
  result.location = allocation[1];
  return result;
};

capnp.layout.OrphanBuilder.copyText = function(arena, copyFrom) {
  var result = new capnp.layout.OrphanBuilder();
  var allocation = capnp.layout.setTextPointer(
    result.tagAsPtr(), null, copyFrom, arena);
  result.segment = allocation.segment;
  result.location = allocation.value.begin() >>> 3;
  return result;
};

capnp.layout.OrphanBuilder.copyData = function(arena, copyFrom) {
  var result = new capnp.layout.OrphanBuilder();
  var allocation = capnp.layout.setDataPointer(
    result.tagAsPtr(), null, copyFrom, arena);
  result.segment = allocation.segment;
  result.location = allocation.value.begin() >>> 3;
  return result;
};
