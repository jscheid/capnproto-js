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

goog.provide('capnp.test.util');

goog.require('capnproto_test.capnp.test');
goog.require('capnp.message');

var test = capnproto_test.capnp.test;

var checkList = function(reader, expected) {
  assertEquals(expected.length, reader.size());
  for (var i = 0; i < expected.length; i++) {
    if (goog.isArray(expected[i])) {
      assertArrayEquals(expected[i], reader.get(i));
    }
    else {
      assertEquals(expected[i], reader.get(i));
    }
  }
}
capnp.test.util.checkList = checkList;

var checkStrList = function(reader, expected) {
  assertEquals(expected.length, reader.size());
  for (var i = 0; i < expected.length; i++) {
    assertEquals(expected[i], reader.get(i).toString());
  }
}
capnp.test.util.checkStrList = checkStrList;

var checkDataList = function(reader, expected) {
  assertEquals(expected.length, reader.size());
  for (var i = 0; i < expected.length; i++) {
    assertTrue(expected[i].equals(reader.get(i)));
  }
}
capnp.test.util.checkDataList = checkDataList;

var checkFloatList = function(reader, expected, maxDelta) {
  assertEquals(expected.length, reader.size());
  for (var i = 0; i < expected.length; i++) {
    assertRoughlyEquals(expected[i], reader.get(i), maxDelta);
  }
}
capnp.test.util.checkFloatList = checkFloatList;

var data = function(str) {
  var strUtf8 = unescape(encodeURIComponent(str));
  var ab = new Uint8Array(strUtf8.length);
  for (var i = 0; i < strUtf8.length; i++) {
    ab[i] = strUtf8.charCodeAt(i);
  }

  return capnp.blob.Data.Reader(ab, strUtf8.length);
}
capnp.test.util.data = data;

capnp.test.util.initTestMessage = function(builder) {
  builder.setVoidField(undefined);
  builder.setVoidField();  // Means the same as above.
  builder.setBoolField(true);
  builder.setInt8Field(-123);
  builder.setInt16Field(-12345);
  builder.setInt32Field(-12345678);
  builder.setInt64Field([-28745, -2249056121]); // -123456789012345
  builder.setUInt8Field(234);
  builder.setUInt16Field(45678);
  builder.setUInt32Field(3456789012);
  builder.setUInt64Field([2874452364, 3944680146]); // 12345678901234567890
  builder.setFloat32Field(1234.5);
  builder.setFloat64Field(-123e45);
  builder.setTextField("foo");
  builder.setDataField(data("bar"));
  {
    var subBuilder = builder.initStructField();
    subBuilder.setVoidField(undefined);
    subBuilder.setBoolField(true);
    subBuilder.setInt8Field(-12);
    subBuilder.setInt16Field(3456);
    subBuilder.setInt32Field(-78901234);
    subBuilder.setInt64Field([13222, 954757966]); // 56789012345678
    subBuilder.setUInt8Field(90);
    subBuilder.setUInt16Field(1234);
    subBuilder.setUInt32Field(56789012);
    subBuilder.setUInt64Field([80484641, 309267154]); // 345678901234567890
    subBuilder.setFloat32Field(-1.25e-10);
    subBuilder.setFloat64Field(345);
    subBuilder.setTextField("baz");
    subBuilder.setDataField(data("qux"));
    {
      var subSubBuilder = subBuilder.initStructField();
      subSubBuilder.setTextField("nested");
      subSubBuilder.initStructField().setTextField("really nested");
    }
    subBuilder.setEnumField(test.TestEnum.BAZ);

    subBuilder.setVoidList([undefined, undefined, undefined]);
    subBuilder.setBoolList([false, true, false, true, true]);
    subBuilder.setInt8List([12, -34, -0x80, 0x7f]);
    subBuilder.setInt16List([1234, -5678, -0x8000, 0x7fff]);
    // gcc warns on -0x800... and the only work-around I could find was to do -0x7ff...-1.
    subBuilder.setInt32List([12345678, -90123456, -0x7fffffff - 1, 0x7fffffff]);
    subBuilder.setInt64List([ [ 28744, 2249056121 ], [ -158070, -49056466 ], [ -2147483648, 0 ], [ 0x7fffffff, 0xffffffff ] ]);
    subBuilder.setUInt8List([12, 34, 0, 0xff]);
    subBuilder.setUInt16List([1234, 5678, 0, 0xffff]);
    subBuilder.setUInt32List([12345678, 90123456, 0, 0xffffffff]);
    subBuilder.setUInt64List([ [ 28744, 2249056121 ], [ 158069, 49056466 ], [0, 0], [ 4294967295, 4294967295 ] ]); // [123456789012345, 678901234567890, 0, 0xffffffffffffffff]
    subBuilder.setFloat32List([0, 1234567, 1e37, -1e37, 1e-37, -1e-37]);
    subBuilder.setFloat64List([0, 123456789012345, 1e306, -1e306, 1e-306, -1e-306]);
    subBuilder.setTextList(["quux", "corge", "grault"]);
    subBuilder.setDataList([data("garply"), data("waldo"), data("fred")]);
    {
      var listBuilder = subBuilder.initStructList(3);
      listBuilder.get(0).setTextField("x structlist 1");
      listBuilder.get(1).setTextField("x structlist 2");
      listBuilder.get(2).setTextField("x structlist 3");
    }
    subBuilder.setEnumList([test.TestEnum.QUX, test.TestEnum.BAR, test.TestEnum.GRAULT]);
  }
  builder.setEnumField(test.TestEnum.CORGE);

  builder.initVoidList(6);
  builder.setBoolList([true, false, false, true]);
  builder.setInt8List([111, -111]);
  builder.setInt16List([11111, -11111]);
  builder.setInt32List([111111111, -111111111]);
  builder.setInt64List([ [ 258700715, 734294471 ], [ -258700716, -734294471 ] ]); // [1111111111111111111, -1111111111111111111]
  builder.setUInt8List([111, 222]);
  builder.setUInt16List([33333, 44444]);
  builder.setUInt32List([3333333333]);
  builder.setUInt64List([ [ 2587007151, 3047977415 ] ]); // [11111111111111111111]
  builder.setFloat32List([5555.5, Infinity, -Infinity, NaN]);
  builder.setFloat64List([7777.75, Infinity, -Infinity, NaN]);
  builder.setTextList(["plugh", "xyzzy", "thud"]);
  builder.setDataList([data("oops"), data("exhausted"), data("rfc3092")]);
  {
    var listBuilder = builder.initStructList(3);
    listBuilder.get(0).setTextField("structlist 1");
    listBuilder.get(1).setTextField("structlist 2");
    listBuilder.get(2).setTextField("structlist 3");
  }
  builder.setEnumList([test.TestEnum.FOO, test.TestEnum.GARPLY]);
};

capnp.test.util.checkTestMessage = function(reader) {

  assertEquals(undefined, reader.getVoidField());
  assertEquals(true, reader.getBoolField());
  assertEquals(-123, reader.getInt8Field());
  assertEquals(-12345, reader.getInt16Field());
  assertEquals(-12345678, reader.getInt32Field());
  assertArrayEquals([ -28745, 2045911175 ], reader.getInt64Field()); // -123456789012345
  assertEquals(234, reader.getUInt8Field());
  assertEquals(45678, reader.getUInt16Field());
  assertEquals(3456789012, reader.getUInt32Field());
  assertArrayEquals([ 2874452364, 3944680146 ], reader.getUInt64Field()); // 12345678901234567890
  assertRoughlyEquals(1234.5, reader.getFloat32Field(), 1e-10);
  assertRoughlyEquals(-123e45, reader.getFloat64Field(), 1e-10); // FIXME
  assertEquals("foo", reader.getTextField().toString());
  assertTrue(data("bar").equals(reader.getDataField()));
  {
    var subReader = reader.getStructField();
    assertEquals(undefined, subReader.getVoidField());
    assertEquals(true, subReader.getBoolField());
    assertEquals(-12, subReader.getInt8Field());
    assertEquals(3456, subReader.getInt16Field());
    assertEquals(-78901234, subReader.getInt32Field());
    assertArrayEquals([13222, 954757966], subReader.getInt64Field()); //  56789012345678
    assertEquals(90, subReader.getUInt8Field());
    assertEquals(1234, subReader.getUInt16Field());
    assertEquals(56789012, subReader.getUInt32Field());
    assertArrayEquals([80484641, 309267154], subReader.getUInt64Field()); // 345678901234567890
    assertRoughlyEquals(-1.25e-10, subReader.getFloat32Field(), 1e-10);
    assertRoughlyEquals(345, subReader.getFloat64Field(), 1e-10); // FIXME
    assertEquals("baz", subReader.getTextField().toString());
    assertTrue(data("qux").equals(subReader.getDataField()));
    {
      var subSubReader = subReader.getStructField();
      assertEquals("nested", subSubReader.getTextField().toString());
      assertEquals("really nested", subSubReader.getStructField().getTextField().toString());
    }
    assertEquals(test.TestEnum.BAZ, subReader.getEnumField());

    checkList(subReader.getVoidList(), [undefined, undefined, undefined]);
    checkList(subReader.getBoolList(), [false, true, false, true, true]);
    checkList(subReader.getInt8List(), [12, -34, -0x80, 0x7f]);
    checkList(subReader.getInt16List(), [1234, -5678, -0x8000, 0x7fff]);
    // gcc warns on -0x800... and the only work-around I could find was to do -0x7ff...-1.
    checkList(subReader.getInt32List(), [12345678, -90123456, -0x7fffffff - 1, 0x7fffffff]);
    checkList(subReader.getInt64List(), [ [ 28744, 2249056121 - 0x100000000 ], [ -158070, -49056466 ], [ -2147483648, 0 ], [ 0x7fffffff, -1 ] ]);
    checkList(subReader.getUInt8List(), [12, 34, 0, 0xff]);
    checkList(subReader.getUInt16List(), [1234, 5678, 0, 0xffff]);
    checkList(subReader.getUInt32List(), [12345678, 90123456, 0, 0xffffffff]);
    checkList(subReader.getUInt64List(), [ [ 28744, 2249056121 ], [ 158069, 49056466 ], [0, 0], [ 4294967295, 4294967295 ] ]);
    checkFloatList(subReader.getFloat32List(), [0.0, 1234567.0, 1e37, -1e37, 1e-37, -1e-37], 1e30);
    checkList(subReader.getFloat64List(), [0.0, 123456789012345.0, 1e306, -1e306, 1e-306, -1e-306]);
    checkStrList(subReader.getTextList(), ["quux", "corge", "grault"]);
    checkDataList(subReader.getDataList(), [data("garply"), data("waldo"), data("fred")]);
    {
      var listReader = subReader.getStructList();
      assertEquals(3, listReader.size());
      assertEquals("x structlist 1", listReader.get(0).getTextField().toString());
      assertEquals("x structlist 2", listReader.get(1).getTextField().toString());
      assertEquals("x structlist 3", listReader.get(2).getTextField().toString());
    }
    checkList(subReader.getEnumList(), [test.TestEnum.QUX, test.TestEnum.BAR, test.TestEnum.GRAULT]);
  }
  assertEquals(test.TestEnum.CORGE, reader.getEnumField());

  assertEquals(6, reader.getVoidList().size());
  checkList(reader.getBoolList(), [true, false, false, true]);
  checkList(reader.getInt8List(), [111, -111]);
  checkList(reader.getInt16List(), [11111, -11111]);
  checkList(reader.getInt32List(), [111111111, -111111111]);
  checkList(reader.getInt64List(), [ [ 258700715, 734294471 ], [ -258700716, -734294471 ] ]); // [ 1111111111111111111, -1111111111111111111 ]
  checkList(reader.getUInt8List(), [111, 222]);
  checkList(reader.getUInt16List(), [33333, 44444]);
  checkList(reader.getUInt32List(), [3333333333]);
  checkList(reader.getUInt64List(), [ [ 2587007151, 3047977415 ] ]); // 11111111111111111111
  {
    var listReader = reader.getFloat32List();
    assertEquals(4, listReader.size());
    assertEquals(5555.5, listReader.get(0));
    assertEquals(Infinity, listReader.get(1));
    assertEquals(-Infinity, listReader.get(2));
    assertTrue(isNaN(listReader.get(3)));
  }
  {
    var listReader = reader.getFloat64List();
    assertEquals(4, listReader.size());
    assertEquals(7777.75, listReader.get(0));
    assertEquals(Infinity, listReader.get(1));
    assertEquals(-Infinity, listReader.get(2));
    assertTrue(isNaN(listReader.get(3)));
  }
  checkStrList(reader.getTextList(), ["plugh", "xyzzy", "thud"]);
  checkDataList(reader.getDataList(), [data("oops"), data("exhausted"), data("rfc3092")]);
  {
    var listReader = reader.getStructList();
    assertEquals(3, listReader.size());
    assertEquals("structlist 1", listReader.get(0).getTextField().toString());
    assertEquals("structlist 2", listReader.get(1).getTextField().toString());
    assertEquals("structlist 3", listReader.get(2).getTextField().toString());
  }
  checkList(reader.getEnumList(), [test.TestEnum.FOO, test.TestEnum.GARPLY]);
}


capnp.test.util.genericInitListDefaults = function(builder) {
  var lists = builder.initLists();

  lists.initList0(2);
  lists.initList1(4);
  lists.initList8(2);
  lists.initList16(2);
  lists.initList32(2);
  lists.initList64(2);
  lists.initListP(2);

  lists.getList0().get(0).setF(undefined);
  lists.getList0().get(1).setF(undefined);
  lists.getList1().get(0).setF(true);
  lists.getList1().get(1).setF(false);
  lists.getList1().get(2).setF(true);
  var val = lists.getList1().get(2).getF();

  lists.getList1().get(3).setF(true);
  lists.getList8().get(0).setF(123);
  lists.getList8().get(1).setF(45);
  lists.getList16().get(0).setF(12345);
  lists.getList16().get(1).setF(6789);
  lists.getList32().get(0).setF(123456789);
  lists.getList32().get(1).setF(234567890);
  lists.getList64().get(0).setF([287445, 1015724736]); // 1234567890123456;
  lists.getList64().get(1).setF([546145, 3987360647]); // 2345678901234567;
  lists.getListP().get(0).setF("foo");
  lists.getListP().get(1).setF("bar");

  {
    var l = lists.initInt32ListList(3);
    l.set(0, [1, 2, 3]);
    checkList(lists.asReader().getInt32ListList().get(0), [1, 2, 3]);


    l.set(1, [4, 5]);
    l.set(2, [12341234]);
  }

  {
    var l = lists.initTextListList(3);
    l.set(0, ["foo", "bar"]);
    l.set(1, ["baz"]);
    l.set(2, ["qux", "corge"]);
  }

  {
    var l = lists.initStructListList(2);
    var e = l.init(0, 2);
    e.get(0).setInt32Field(123);
    e.get(1).setInt32Field(456);
    e = l.init(1, 1);
    e.get(0).setInt32Field(789);
  }
}


capnp.test.util.genericCheckListDefaults = function(reader) {
  var lists = reader.getLists();
  assertTrue(lists.hasList0());
  assertTrue(lists.hasList1());
  assertTrue(lists.hasList8());
  assertTrue(lists.hasList16());
  assertTrue(lists.hasList32());
  assertTrue(lists.hasList64());
  assertTrue(lists.hasListP());

  assertEquals(2, lists.getList0().size());
  assertEquals(4, lists.getList1().size());
  assertEquals(2, lists.getList8().size());
  assertEquals(2, lists.getList16().size());
  assertEquals(2, lists.getList32().size());
  assertEquals(2, lists.getList64().size());
  assertEquals(2, lists.getListP().size());

  assertEquals(undefined, lists.getList0().get(0).getF());
  assertEquals(undefined, lists.getList0().get(1).getF());
  assertTrue(lists.getList1().get(0).getF());
  assertFalse(lists.getList1().get(1).getF());
  assertTrue(lists.getList1().get(2).getF());
  assertTrue(lists.getList1().get(3).getF());
  assertEquals(123, lists.getList8().get(0).getF());
  assertEquals(45, lists.getList8().get(1).getF());
  assertEquals(12345, lists.getList16().get(0).getF());
  assertEquals(6789, lists.getList16().get(1).getF());
  assertEquals(123456789, lists.getList32().get(0).getF());
  assertEquals(234567890, lists.getList32().get(1).getF());
  assertArrayEquals([ 287445, 1015724736 ], lists.getList64().get(0).getF()); // 1234567890123456
  assertArrayEquals([ 546145, 3987360647 ], lists.getList64().get(1).getF()); // 2345678901234567
  assertEquals("foo", lists.getListP().get(0).getF().toString());
  assertEquals("bar", lists.getListP().get(1).getF().toString());

  {
    var l = lists.getInt32ListList();
    assertEquals(3, l.size());

    checkList(l.get(0), [1, 2, 3]);
    checkList(l.get(1), [4, 5]);
    checkList(l.get(2), [12341234]);
  }

  {
    var l = lists.getTextListList();
    assertEquals(3, l.size());
    checkStrList(l.get(0), ["foo", "bar"]);
    checkStrList(l.get(1), ["baz"]);
    checkStrList(l.get(2), ["qux", "corge"]);
  }

  {
    var l = lists.getStructListList();
    assertEquals(2, l.size());
    var e = l.get(0);
    assertEquals(2, e.size());
    assertEquals(123, e.get(0).getInt32Field());
    assertEquals(456, e.get(1).getInt32Field());
    e = l.get(1);
    assertEquals(1, e.size());
    assertEquals(789, e.get(0).getInt32Field());
  }
}

capnp.test.util.checkTestMessageAllZero = function(reader) {
  assertEquals(undefined, reader.getVoidField());
  assertEquals(false, reader.getBoolField());
  assertEquals(0, reader.getInt8Field());
  assertEquals(0, reader.getInt16Field());
  assertEquals(0, reader.getInt32Field());
  assertArrayEquals([0, 0], reader.getInt64Field());
  assertEquals(0, reader.getUInt8Field());
  assertEquals(0, reader.getUInt16Field());
  assertEquals(0, reader.getUInt32Field());
  assertArrayEquals([0, 0], reader.getUInt64Field());
  assertEquals(0, reader.getFloat32Field());
  assertEquals(0, reader.getFloat64Field());
  assertEquals("", reader.getTextField().toString().toString());
  assertTrue(data("").equals(reader.getDataField()));
  {
    var subReader = reader.getStructField();
    assertEquals(undefined, subReader.getVoidField());
    assertEquals(false, subReader.getBoolField());
    assertEquals(0, subReader.getInt8Field());
    assertEquals(0, subReader.getInt16Field());
    assertEquals(0, subReader.getInt32Field());
    assertArrayEquals([0, 0], subReader.getInt64Field());
    assertEquals(0, subReader.getUInt8Field());
    assertEquals(0, subReader.getUInt16Field());
    assertEquals(0, subReader.getUInt32Field());
    assertArrayEquals([0, 0], subReader.getUInt64Field());
    assertEquals(0, subReader.getFloat32Field());
    assertEquals(0, subReader.getFloat64Field());
    assertEquals("", subReader.getTextField().toString());
    assertTrue(data("").equals(subReader.getDataField()));
    {
      var subSubReader = subReader.getStructField();
      assertEquals("", subSubReader.getTextField().toString());
      assertEquals("", subSubReader.getStructField().getTextField().toString());
    }

    assertEquals(0, subReader.getVoidList().size());
    assertEquals(0, subReader.getBoolList().size());
    assertEquals(0, subReader.getInt8List().size());
    assertEquals(0, subReader.getInt16List().size());
    assertEquals(0, subReader.getInt32List().size());
    assertEquals(0, subReader.getInt64List().size());
    assertEquals(0, subReader.getUInt8List().size());
    assertEquals(0, subReader.getUInt16List().size());
    assertEquals(0, subReader.getUInt32List().size());
    assertEquals(0, subReader.getUInt64List().size());
    assertEquals(0, subReader.getFloat32List().size());
    assertEquals(0, subReader.getFloat64List().size());
    assertEquals(0, subReader.getTextList().size());
    assertEquals(0, subReader.getDataList().size());
    assertEquals(0, subReader.getStructList().size());
  }

  assertEquals(0, reader.getVoidList().size());
  assertEquals(0, reader.getBoolList().size());
  assertEquals(0, reader.getInt8List().size());
  assertEquals(0, reader.getInt16List().size());
  assertEquals(0, reader.getInt32List().size());
  assertEquals(0, reader.getInt64List().size());
  assertEquals(0, reader.getUInt8List().size());
  assertEquals(0, reader.getUInt16List().size());
  assertEquals(0, reader.getUInt32List().size());
  assertEquals(0, reader.getUInt64List().size());
  assertEquals(0, reader.getFloat32List().size());
  assertEquals(0, reader.getFloat64List().size());
  assertEquals(0, reader.getTextList().size());
  assertEquals(0, reader.getDataList().size());
  assertEquals(0, reader.getStructList().size());
}


/**
 *  @constructor
 */
var TestMessageBuilder = function(desiredSegmentCount) {
  // A MessageBuilder that tries to allocate an exact number of total segments, by allocating
  // minimum-size segments until it reaches the number, then allocating one large segment to
  // finish.

  capnp.message.MallocMessageBuilder.call(this, 0, capnp.message.AllocationStrategy.FIXED_SIZE);

  this.allocateSegment = function(minimumSize) {
    if (desiredSegmentCount <= 1) {
      if (desiredSegmentCount < 1) {
        fail("Allocated more segments than desired.");
      } else {
        --desiredSegmentCount;
      }
      return capnp.message.MallocMessageBuilder.prototype.allocateSegment.call(this, capnp.message.SUGGESTED_FIRST_SEGMENT_WORDS);
    } else {
      --desiredSegmentCount;
      return capnp.message.MallocMessageBuilder.prototype.allocateSegment.call(this, minimumSize);
    }
  };
};
TestMessageBuilder.prototype = Object.create(capnp.message.MallocMessageBuilder.prototype);
TestMessageBuilder.prototype.constructor = TestMessageBuilder;

capnp.test.util.TestMessageBuilder = TestMessageBuilder;
