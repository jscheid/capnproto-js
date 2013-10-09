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

goog.provide('capnp.tests.layout');

goog.require('capnp.serialize');
goog.require('capnp.message');
goog.require('capnp.packed');
goog.require('capnp.test.util');
goog.require('kj.io');

goog.require('capnproto_test.capnp.test');

var STRUCTLIST_ELEMENT_SIZE = new capnp.layout.StructSize(1, 1, capnp.layout.FieldSize.INLINE_COMPOSITE);
var SUBSTRUCT_DEFAULT = new Uint8Array([ 0,0,0,0,1,0,0,0,  0,0,0,0,0,0,0,0 ]).buffer;
var STRUCTLIST_ELEMENT_SUBSTRUCT_DEFAULT = new Uint8Array([ 0,0,0,0,1,0,0,0,  0,0,0,0,0,0,0,0 ]).buffer;

var setupStruct = function(builder) {
  builder.setDataField_uint64(0, [ 269554195, 336926231 ]);
  builder.setDataField_uint32(2, 0x20212223);
  builder.setDataField_uint16(6, 0x3031);
  builder.setDataField_uint8(14, 0x40);
  builder.setDataField_bool(120, false);
  builder.setDataField_bool(121, false);
  builder.setDataField_bool(122, true);
  builder.setDataField_bool(123, false);
  builder.setDataField_bool(124, true);
  builder.setDataField_bool(125, true);
  builder.setDataField_bool(126, true);
  builder.setDataField_bool(127, false);

  {
    var subStruct = builder.initStructField(
      0, new capnp.layout.StructSize(1, 0, capnp.layout.FieldSize.EIGHT_BYTES));
    subStruct.setDataField_uint32(0, 123);
  }

  {
    var list = builder.initListField(1, capnp.layout.FieldSize.FOUR_BYTES, 3);
    assertEquals(3, list.size());
    list.setDataElement(capnp.prim.int32_t, 0, 200);
    list.setDataElement(capnp.prim.int32_t, 1, 201);
    list.setDataElement(capnp.prim.int32_t, 2, 202);
  }

  {
    var list = builder.initStructListField(
      2, 4, STRUCTLIST_ELEMENT_SIZE);
    assertEquals(4, list.size());
    for (var i = 0; i < 4; i++) {
      var element = list.getStructElement(i);
      element.setDataField_int32(0, 300 + i);
      element.initStructField(0,
                              new capnp.layout.StructSize(1, 0, capnp.layout.FieldSize.EIGHT_BYTES))
        .setDataField_int32(0, 400 + i);
    }
  }

  {
    var list = builder.initListField(3, capnp.layout.FieldSize.POINTER, 5);
    assertEquals(5, list.size());
    for (var i = 0; i < 5; i++) {
      var element = list.initListElement(
        i, 3 /*FieldSize::TWO_BYTES*/, (i + 1));
      assertEquals((i + 1), element.size());
      for (var j = 0; j <= i; j++) {
        element.setDataElement(capnp.prim.uint16_t, j, 500 + j);
      }
    }
  }
};

var checkStructWithBuilder = function(builder) {
  assertArrayEquals([ 269554195, 336926231 ], builder.getDataField_uint64(0));
  assertEquals(0x20212223, builder.getDataField_uint32(2));
  assertEquals(0x3031, builder.getDataField_uint16(6));
  assertEquals(0x40, builder.getDataField_uint8(14));
  assertFalse(builder.getDataField_bool(120));
  assertFalse(builder.getDataField_bool(121));
  assertTrue (builder.getDataField_bool(122));
  assertFalse(builder.getDataField_bool(123));
  assertTrue (builder.getDataField_bool(124));
  assertTrue (builder.getDataField_bool(125));
  assertTrue (builder.getDataField_bool(126));
  assertFalse(builder.getDataField_bool(127));

  {
    var subStruct = builder.getStructField(
      0, new capnp.layout.StructSize(1, 0, capnp.layout.FieldSize.EIGHT_BYTES),
      SUBSTRUCT_DEFAULT);
    assertEquals(123, subStruct.getDataField_uint32(0));
  }

  {
    var list = builder.getListField(1, capnp.layout.FieldSize.FOUR_BYTES, null);
    assertEquals(3, list.size());
    assertEquals(200, list.getDataElement(capnp.prim.int32_t, 0));
    assertEquals(201, list.getDataElement(capnp.prim.int32_t, 1));
    assertEquals(202, list.getDataElement(capnp.prim.int32_t, 2));
  }

  {
    var list = builder.getStructListField(2, STRUCTLIST_ELEMENT_SIZE, null);
    assertEquals(4, list.size());
    for (var i = 0; i < 4; i++) {
      var element = list.getStructElement(i);
      assertEquals(300 + i, element.getDataField_int32(0));
      assertEquals(400 + i,
                   element.getStructField(0,
                                          new capnp.layout.StructSize(1, 0, capnp.layout.FieldSize.EIGHT_BYTES),
                                          STRUCTLIST_ELEMENT_SUBSTRUCT_DEFAULT.words)
                   .getDataField_int32(0));
    }
  }

  {
    var list = builder.getListField(3, 6 /*FieldSize::POINTER*/, null);
    assertEquals(5, list.size());
    for (var i = 0; i < 5; i++) {
      var element = list.getListElement(i, 3 /*FieldSize::TWO_BYTES*/);
      assertEquals((i + 1), element.size());
      for (var j = 0; j <= i; j++) {
        assertEquals(500 + j, element.getDataElement(capnp.prim.uint16_t, j));
      }
    }
  }
};

var checkStructWithReader = function(reader) {

  assertArrayEquals([ 269554195, 336926231 ], reader.getDataField_uint64(0));
  assertEquals(0x20212223, reader.getDataField_uint32(2));
  assertEquals(0x3031, reader.getDataField_uint16(6));
  assertEquals(0x40, reader.getDataField_uint8(14));
  assertFalse(reader.getDataField_bool(120));
  assertFalse(reader.getDataField_bool(121));
  assertTrue (reader.getDataField_bool(122));
  assertFalse(reader.getDataField_bool(123));
  assertTrue (reader.getDataField_bool(124));
  assertTrue (reader.getDataField_bool(125));
  assertTrue (reader.getDataField_bool(126));
  assertFalse(reader.getDataField_bool(127));

  {
    var subStruct = reader.getStructField(0, SUBSTRUCT_DEFAULT);
    assertEquals(123, subStruct.getDataField_uint32(0));
  }

  {
    var list = reader.getListField(1, capnp.layout.FieldSize.FOUR_BYTES, null);
    assertEquals(3, list.size());
    assertEquals(200, list.getDataElement(capnp.prim.uint32_t, 0));
    assertEquals(201, list.getDataElement(capnp.prim.uint32_t, 1));
    assertEquals(202, list.getDataElement(capnp.prim.uint32_t, 2));
  }

  {
    var list = reader.getListField(2, capnp.layout.FieldSize.INLINE_COMPOSITE, null);
    assertEquals(4, list.size());
    for (var i = 0; i < 4; i++) {
      var element = list.getStructElement(i);
      assertEquals(300 + i, element.getDataField_int32(0));
      assertEquals(400 + i,
                   element.getStructField(0, STRUCTLIST_ELEMENT_SUBSTRUCT_DEFAULT)
                   .getDataField_int32(0));
    }
  }

  {
    var list = reader.getListField(3, capnp.layout.FieldSize.POINTER, null);
    assertEquals(5, list.size());
    for (var i = 0; i < 5; i++) {
      var element = list.getListElement(i, capnp.layout.FieldSize.TWO_BYTES);
      assertEquals((i + 1), element.size());
      for (var j = 0; j <= i; j++) {
        assertEquals(500 + j, element.getDataElement(capnp.prim.uint16_t, j));
      }
    }
  }
};

window['test_SimpleRawDataStruct'] = function() {

  var data = new Uint8Array([
    // Struct ref, offset = 1, dataSize = 1, pointerCount = 0
    0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    // Content for the data section.
    0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef
  ]).buffer

  var reader = capnp.layout.StructReader.readRootUnchecked(new DataView(data));

  assertArrayEquals([ 4023233417, 1732584193 ], reader.getDataField_uint64(0)); // 0xefcdab8967452301
  assertArrayEquals([0, 0], reader.getDataField_uint64(1));
  assertEquals(0x67452301, reader.getDataField_uint32(0));
  assertEquals(0xefcdab89, reader.getDataField_uint32(1));
  assertEquals(0, reader.getDataField_uint32(2));
  assertEquals(0x2301, reader.getDataField_uint16(0));
  assertEquals(0x6745, reader.getDataField_uint16(1));
  assertEquals(0xab89, reader.getDataField_uint16(2));
  assertEquals(0xefcd, reader.getDataField_uint16(3));
  assertEquals(0, reader.getDataField_uint16(4));

  assertArrayEquals([ 4023233417, 321 ^ 1732584193 ], reader.getDataField_uint64_masked(0, [0, 321]));
  assertEquals(321 ^ 0x67452301, reader.getDataField_uint32_masked(0, 321));
  assertEquals(321 ^ 0x2301, reader.getDataField_uint16_masked(0, 321));
  assertArrayEquals([0, 321], reader.getDataField_uint64_masked(1, [0, 321]));
  assertEquals(321, reader.getDataField_uint32_masked(2, 321));
  assertEquals(321, reader.getDataField_uint16_masked(4, 321));

  // Bits
  assertTrue (reader.getDataField_bool(0));
  assertFalse(reader.getDataField_bool(1));
  assertFalse(reader.getDataField_bool(2));
  assertFalse(reader.getDataField_bool(3));
  assertFalse(reader.getDataField_bool(4));
  assertFalse(reader.getDataField_bool(5));
  assertFalse(reader.getDataField_bool(6));
  assertFalse(reader.getDataField_bool(7));

  assertTrue (reader.getDataField_bool(8));
  assertTrue (reader.getDataField_bool(9));
  assertFalse(reader.getDataField_bool(10));
  assertFalse(reader.getDataField_bool(11));
  assertFalse(reader.getDataField_bool(12));
  assertTrue (reader.getDataField_bool(13));
  assertFalse(reader.getDataField_bool(14));
  assertFalse(reader.getDataField_bool(15));

  assertTrue (reader.getDataField_bool(63));
  assertFalse(reader.getDataField_bool(64));

  assertTrue (reader.getDataField_bool_masked(0, false));
  assertFalse(reader.getDataField_bool_masked(1, false));
  assertTrue (reader.getDataField_bool_masked(63, false));
  assertFalse(reader.getDataField_bool_masked(64, false));
  assertFalse(reader.getDataField_bool_masked(0, true));
  assertTrue (reader.getDataField_bool_masked(1, true));
  assertFalse(reader.getDataField_bool_masked(63, true));
  assertTrue (reader.getDataField_bool_masked(64, true));

}

window['test_StructRoundTrip_OneSegment'] = function() {

  var message = new capnp.message.MallocMessageBuilder();
  var arena = new capnp.arena.BuilderArena(message);
  var allocation = arena.allocate(1);
  var segment = allocation.segment;
  var rootLocation = allocation.words;

  var builder = capnp.layout.StructBuilder.initRoot(
    segment, rootLocation, new capnp.layout.StructSize(2, 4, capnp.layout.FieldSize.INLINE_COMPOSITE));

  setupStruct(builder);

  // word count:
  //    1  root pointer
  //    6  root struct
  //    1  sub message
  //    2  3-element int32 list
  //   13  struct list
  //         1 tag
  //        12 4x struct
  //           1 data section
  //           1 pointer section
  //           1 sub-struct
  //   11  list list
  //         5 pointers to sub-lists
  //         6 sub-lists (4x 1 word, 1x 2 words)
  // -----
  //   34
  var segments = arena.getSegmentsForOutput();
  assertEquals(1, segments.length);
  assertEquals(34 << 3, segments[0].byteLength);

  checkStructWithBuilder(builder);
  checkStructWithReader(builder.asReader());
  checkStructWithReader(capnp.layout.StructReader.readRootUnchecked(segment.getDataView()));
  checkStructWithReader(capnp.layout.StructReader.readRoot(0, segment, 4));
}

window['test_StructRoundTrip_OneSegmentPerAllocation'] = function() {

  var message = new capnp.message.MallocMessageBuilder(0, capnp.message.AllocationStrategy.FIXED_SIZE);
  var arena = new capnp.arena.BuilderArena(message);
  var allocation = arena.allocate(1);
  var segment = allocation.segment;
  var rootLocation = allocation.words;

  var builder = capnp.layout.StructBuilder.initRoot(
    segment, rootLocation, new capnp.layout.StructSize(2, 4, capnp.layout.FieldSize.INLINE_COMPOSITE));
  setupStruct(builder);

  // Verify that we made 15 segments.
  var segments = arena.getSegmentsForOutput();
  assertEquals(15, segments.length);

  // Check that each segment has the expected size.  Recall that the first word of each segment will
  // actually be a pointer to the first thing allocated within that segment.
  assertEquals( 1, segments[ 0].byteLength >>> 3);  // root ref
  assertEquals( 7, segments[ 1].byteLength >>> 3);  // root struct
  assertEquals( 2, segments[ 2].byteLength >>> 3);  // sub-struct
  assertEquals( 3, segments[ 3].byteLength >>> 3);  // 3-element int32 list
  assertEquals(10, segments[ 4].byteLength >>> 3);  // struct list
  assertEquals( 2, segments[ 5].byteLength >>> 3);  // struct list substruct 1
  assertEquals( 2, segments[ 6].byteLength >>> 3);  // struct list substruct 2
  assertEquals( 2, segments[ 7].byteLength >>> 3);  // struct list substruct 3
  assertEquals( 2, segments[ 8].byteLength >>> 3);  // struct list substruct 4
  assertEquals( 6, segments[ 9].byteLength >>> 3);  // list list
  assertEquals( 2, segments[10].byteLength >>> 3);  // list list sublist 1
  assertEquals( 2, segments[11].byteLength >>> 3);  // list list sublist 2
  assertEquals( 2, segments[12].byteLength >>> 3);  // list list sublist 3
  assertEquals( 2, segments[13].byteLength >>> 3);  // list list sublist 4
  assertEquals( 3, segments[14].byteLength >>> 3);  // list list sublist 5

  checkStructWithBuilder(builder);
  checkStructWithReader(builder.asReader());
  checkStructWithReader(capnp.layout.StructReader.readRoot(0, segment, 4));
}

window['test_StructRoundTrip_MultipleSegmentsWithMultipleAllocations'] = function() {

  var message = new capnp.message.MallocMessageBuilder(8, capnp.message.AllocationStrategy.FIXED_SIZE);
  var arena = new capnp.arena.BuilderArena(message);
  var allocation = arena.allocate(1);
  var segment = allocation.segment;
  var rootLocation = allocation.words;

  var builder = capnp.layout.StructBuilder.initRoot(
    segment, rootLocation, new capnp.layout.StructSize(2, 4, capnp.layout.FieldSize.INLINE_COMPOSITE));
  setupStruct(builder);

  // Verify that we made 6 segments.
  var segments = arena.getSegmentsForOutput();
  assertEquals(6, segments.length);

  // Check that each segment has the expected size.  Recall that each object will be prefixed by an
  // extra word if its parent is in a different segment.
  assertEquals( 8, segments[0].byteLength >>> 3);  // root ref + struct + sub
  assertEquals( 3, segments[1].byteLength >>> 3);  // 3-element int32 list
  assertEquals(10, segments[2].byteLength >>> 3);  // struct list
  assertEquals( 8, segments[3].byteLength >>> 3);  // struct list substructs
  assertEquals( 8, segments[4].byteLength >>> 3);  // list list + sublist 1,2
  assertEquals( 7, segments[5].byteLength >>> 3);  // list list sublist 3,4,5

  checkStructWithBuilder(builder);
  checkStructWithReader(builder.asReader());
  checkStructWithReader(capnp.layout.StructReader.readRoot(0, segment, 4));
}
