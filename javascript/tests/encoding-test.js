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

goog.provide('capnp.tests.encoding');

goog.require('capnp.serialize');
goog.require('capnp.message');

goog.require('capnp.test.util');

goog.require('capnproto_test.capnp.test');
goog.require('capnproto_test.capnp.test_import');
goog.require('capnproto_test.capnp.test_import2');


function checkListDataPtr(reader, expectedData, expectedPointers) {
  assertEquals(expectedData.length, reader.size());
  for (var i = 0; i < expectedData.length; i++) {
    assertArrayEquals(expectedData[i], reader.get(i).getOld1());
    assertEquals(expectedPointers[i], reader.get(i).getOld2().toString());
  }
}

function checkUpgradedList(root, expectedData, expectedPointers) {

  {
    var builder = root.getObjectField(capnp.list.List(test.TestNewVersion));

    assertEquals(expectedData.length, builder.size());
    for (var i = 0; i < expectedData.length; i++) {
      assertArrayEquals(expectedData[i], builder.get(i).getOld1());
      assertEquals(expectedPointers[i], builder.get(i).getOld2().toString());

      // Other fields shouldn't be set.
      assertArrayEquals([0, 0], builder.get(i).asReader().getOld3().getOld1());
      assertEquals("", builder.get(i).asReader().getOld3().getOld2().toString());
      assertArrayEquals([0, 987], builder.get(i).getNew1());
      assertEquals("baz", builder.get(i).getNew2().toString());

      // Write some new data.
      builder.get(i).setOld1([0, i * 123]);
      builder.get(i).setOld2(("qux" + i + '\0'));
      builder.get(i).setNew1([0, i * 456]);
      builder.get(i).setNew2(("corge" + i + '\0'));
    }
  }

  // Read the newly-written data as TestOldVersion to ensure it was updated.
  {
    var builder = root.getObjectField(capnp.list.List(test.TestOldVersion));

    assertEquals(expectedData.length, builder.size());
    for (var i = 0; i < expectedData.length; i++) {
      assertArrayEquals([0, i * 123], builder.get(i).getOld1());
      assertEquals("qux" + i + "\0", builder.get(i).getOld2().toString()); // FIXME
    }
  }

  // Also read back as TestNewVersion again.
  {
    var builder = root.getObjectField(capnp.list.List(test.TestNewVersion));

    assertEquals(expectedData.length, builder.size());
    for (var i = 0; i < expectedData.length; i++) {
      assertArrayEquals([0, i * 123], builder.get(i).getOld1());
      assertEquals("qux" + i + '\0', builder.get(i).getOld2().toString()); // FIXME
      assertArrayEquals([0, i * 456], builder.get(i).getNew1());
      assertEquals("corge" + i + '\0', builder.get(i).getNew2().toString()); // FIXME
    }
  }
}

window['test_AllTypes'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();

  var test = capnproto_test.capnp.test;

  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));
  capnp.test.util.checkTestMessage(builder.getRoot(test.TestAllTypes));
  capnp.test.util.checkTestMessage(builder.getRoot(test.TestAllTypes).asReader());

  var reader = new capnp.message.SegmentArrayMessageReader(builder.getSegmentsForOutput());

  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));

  assertEquals(1, builder.getSegmentsForOutput().length);

  capnp.test.util.checkTestMessage(capnp.message.readMessageUnchecked(test.TestAllTypes, builder.getSegmentsForOutput()[0]));

  assertEquals((builder.getSegmentsForOutput()[0].byteLength >> 3) - 1,  // -1 for root pointer
               reader.getRoot(test.TestAllTypes).totalSizeInWords());
};

window['test_AllTypesMultiSegment'] = function() {

  var builder = new capnp.message.MallocMessageBuilder(0, capnp.message.AllocationStrategy.FIXED_SIZE);

  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));
  capnp.test.util.checkTestMessage(builder.getRoot(test.TestAllTypes));
  capnp.test.util.checkTestMessage(builder.getRoot(test.TestAllTypes).asReader());

  var reader = new capnp.message.SegmentArrayMessageReader(builder.getSegmentsForOutput());

  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_Defaults'] = function() {
  var nullRoot = new ArrayBuffer(8);
  var reader = new capnp.message.SegmentArrayMessageReader([ new DataView(nullRoot) ]);

  capnp.test.util.checkTestMessage(reader.getRoot(test.TestDefaults));
  capnp.test.util.checkTestMessage(capnp.message.readMessageUnchecked(test.TestDefaults, new DataView(nullRoot)));

  capnp.test.util.checkTestMessage(new test.TestDefaults.Reader());
};

window['test_DefaultInitialization'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();

  capnp.test.util.checkTestMessage(builder.getRoot(test.TestDefaults));  // first pass initializes to defaults
  capnp.test.util.checkTestMessage(builder.getRoot(test.TestDefaults).asReader());

  capnp.test.util.checkTestMessage(builder.getRoot(test.TestDefaults));  // second pass just reads the initialized structure
  capnp.test.util.checkTestMessage(builder.getRoot(test.TestDefaults).asReader());

  var reader = new capnp.message.SegmentArrayMessageReader(builder.getSegmentsForOutput());

  capnp.test.util.checkTestMessage(reader.getRoot(test.TestDefaults));
};

window['test_DefaultInitializationMultiSegment'] = function() {

  var builder = new capnp.message.MallocMessageBuilder(0, capnp.message.AllocationStrategy.FIXED_SIZE);

  // first pass initializes to defaults
  var root = builder.getRoot(test.TestDefaults);

  capnp.test.util.checkTestMessage(root);
  capnp.test.util.checkTestMessage(builder.getRoot(test.TestDefaults).asReader());

  // second pass just reads the initialized structure
  capnp.test.util.checkTestMessage(builder.getRoot(test.TestDefaults));
  capnp.test.util.checkTestMessage(builder.getRoot(test.TestDefaults).asReader());

  var reader = new capnp.message.SegmentArrayMessageReader(builder.getSegmentsForOutput());

  capnp.test.util.checkTestMessage(reader.getRoot(test.TestDefaults));
};

window['test_DefaultsFromEmptyMessage'] = function() {

  var emptyMessage = new ArrayBuffer(8);

  var reader = new capnp.message.SegmentArrayMessageReader([ new DataView(emptyMessage) ]);

  capnp.test.util.checkTestMessage(reader.getRoot(test.TestDefaults));
  capnp.test.util.checkTestMessage(capnp.message.readMessageUnchecked(test.TestDefaults, new DataView(emptyMessage)));
};

window['test_GenericObjects'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.getRoot(test.TestObject);

  capnp.test.util.initTestMessage(root.initObjectField(test.TestAllTypes));
  capnp.test.util.checkTestMessage(root.getObjectField(test.TestAllTypes));
  capnp.test.util.checkTestMessage(root.asReader().getObjectField(test.TestAllTypes));

  root.setObjectField(capnp.blob.Text, "foo");
  assertEquals("foo", root.getObjectField(capnp.blob.Text).toString());
  assertEquals("foo", root.asReader().getObjectField(capnp.blob.Text).toString());

  root.setObjectField(capnp.blob.Data, capnp.test.util.data("foo"));
  assertTrue(capnp.test.util.data("foo").equals(root.getObjectField(capnp.blob.Data)));
  assertTrue(capnp.test.util.data("foo").equals(root.asReader().getObjectField(capnp.blob.Data)));

  {
    root.setObjectField(capnp.list.List(capnp.prim.uint32_t), [123, 456, 789]);

    {
      var list = root.getObjectField(capnp.list.List(capnp.prim.uint32_t));
      assertEquals(3, list.size());
      assertEquals(123, list.get(0));
      assertEquals(456, list.get(1));
      assertEquals(789, list.get(2));
    }

    {
      var list = root.asReader().getObjectField(capnp.list.List(capnp.prim.uint32_t));
      assertEquals(3, list.size());
      assertEquals(123, list.get(0));
      assertEquals(456, list.get(1));
      assertEquals(789, list.get(2));
    }
  }

  {
    root.setObjectField(capnp.list.List(capnp.blob.Text), ["foo", "bar"]);

    {
      var list = root.getObjectField(capnp.list.List(capnp.blob.Text));
      assertEquals(2, list.size());
      assertEquals("foo", list.get(0).toString());
      assertEquals("bar", list.get(1).toString());
    }

    {
      var list = root.asReader().getObjectField(capnp.list.List(capnp.blob.Text));
      assertEquals(2, list.size());
      assertEquals("foo", list.get(0).toString());
      assertEquals("bar", list.get(1).toString());
    }
  }

  {
    {
      var list = root.initObjectField(capnp.list.List(test.TestAllTypes), 2);
      assertEquals(2, list.size());
      capnp.test.util.initTestMessage(list.get(0));
    }

    {
      var list = root.getObjectField(capnp.list.List(test.TestAllTypes));
      assertEquals(2, list.size());
      capnp.test.util.checkTestMessage(list.get(0));
      capnp.test.util.checkTestMessageAllZero(list.get(1));
    }

    {
      var list = root.asReader().getObjectField(capnp.list.List(test.TestAllTypes));
      assertEquals(2, list.size());
      capnp.test.util.checkTestMessage(list.get(0));
      capnp.test.util.checkTestMessageAllZero(list.get(1));
    }
  }
};

window['test_UnionLayout'] = function() {

  var INIT_UNION = function(initializer) {
    // Use the given setter to initialize the given union field and then return a struct indicating
    // the location of the data that was written as well as the values of the four union
    // discriminants.

    var builder = new capnp.message.MallocMessageBuilder();
    initializer(builder.getRoot(test.TestUnion));
    var segment = builder.getSegmentsForOutput()[0];

    assertTrue((segment.byteLength >> 3) > 2);

    // Find the offset of the first set bit after the union discriminants.
    var offset = 0;
    var found = false;
    var uint8Array = new Uint8Array(segment.buffer, segment.byteOffset, segment.byteOffset + segment.byteLength);
    for (var p = 16; p < uint8Array.byteLength; p++) {
      var dp = uint8Array[p];
      if (dp != 0) {
        var bits = dp;
        while ((bits & 1) === 0) {
          ++offset;
          bits >>>= 1;
        }
        found = true;
        break;
      }
      offset += 8;
    }
    if (!found) {
      offset = -1;
    }

    return [ [ uint8Array[8+0], uint8Array[8+2], uint8Array[8+4], uint8Array[8+6] ], offset ];
  };

  assertArrayEquals([ [ 0,0,0,0 ],  -1], INIT_UNION(function(b) { b.getUnion0().setU0f0s0(undefined); }));
  assertArrayEquals([ [ 1,0,0,0 ],   0], INIT_UNION(function(b) { b.getUnion0().setU0f0s1(1); }));
  assertArrayEquals([ [ 2,0,0,0 ],   0], INIT_UNION(function(b) { b.getUnion0().setU0f0s8(1); }));
  assertArrayEquals([ [ 3,0,0,0 ],   0], INIT_UNION(function(b) { b.getUnion0().setU0f0s16(1); }));
  assertArrayEquals([ [ 4,0,0,0 ],   0], INIT_UNION(function(b) { b.getUnion0().setU0f0s32(1); }));
  assertArrayEquals([ [ 5,0,0,0 ],   0], INIT_UNION(function(b) { b.getUnion0().setU0f0s64(1); }));
  assertArrayEquals([ [ 6,0,0,0 ], 448], INIT_UNION(function(b) { b.getUnion0().setU0f0sp("1"); }));

  assertArrayEquals([ [ 7,0,0,0 ],  -1], INIT_UNION(function(b) { b.getUnion0().setU0f1s0(undefined); }));
  assertArrayEquals([ [ 8,0,0,0 ],   0], INIT_UNION(function(b) { b.getUnion0().setU0f1s1(1); }));
  assertArrayEquals([ [ 9,0,0,0 ],   0], INIT_UNION(function(b) { b.getUnion0().setU0f1s8(1); }));
  assertArrayEquals([ [10,0,0,0 ],   0], INIT_UNION(function(b) { b.getUnion0().setU0f1s16(1); }));
  assertArrayEquals([ [11,0,0,0 ],   0], INIT_UNION(function(b) { b.getUnion0().setU0f1s32(1); }));
  assertArrayEquals([ [12,0,0,0 ],   0], INIT_UNION(function(b) { b.getUnion0().setU0f1s64(1); }));
  assertArrayEquals([ [13,0,0,0 ], 448], INIT_UNION(function(b) { b.getUnion0().setU0f1sp("1"); }));

  assertArrayEquals([ [0, 0,0,0 ],  -1], INIT_UNION(function(b) { b.getUnion1().setU1f0s0(undefined); }));
  assertArrayEquals([ [0, 1,0,0 ],  65], INIT_UNION(function(b) { b.getUnion1().setU1f0s1(1); }));
  assertArrayEquals([ [0, 2,0,0 ],  65], INIT_UNION(function(b) { b.getUnion1().setU1f1s1(1); }));
  assertArrayEquals([ [0, 3,0,0 ],  72], INIT_UNION(function(b) { b.getUnion1().setU1f0s8(1); }));
  assertArrayEquals([ [0, 4,0,0 ],  72], INIT_UNION(function(b) { b.getUnion1().setU1f1s8(1); }));
  assertArrayEquals([ [0, 5,0,0 ],  80], INIT_UNION(function(b) { b.getUnion1().setU1f0s16(1); }));
  assertArrayEquals([ [0, 6,0,0 ],  80], INIT_UNION(function(b) { b.getUnion1().setU1f1s16(1); }));
  assertArrayEquals([ [0, 7,0,0 ],  96], INIT_UNION(function(b) { b.getUnion1().setU1f0s32(1); }));
  assertArrayEquals([ [0, 8,0,0 ],  96], INIT_UNION(function(b) { b.getUnion1().setU1f1s32(1); }));
  assertArrayEquals([ [0, 9,0,0 ], 128], INIT_UNION(function(b) { b.getUnion1().setU1f0s64(1); }));
  assertArrayEquals([ [0,10,0,0 ], 128], INIT_UNION(function(b) { b.getUnion1().setU1f1s64(1); }));
  assertArrayEquals([ [0,11,0,0 ], 512], INIT_UNION(function(b) { b.getUnion1().setU1f0sp("1"); }));
  assertArrayEquals([ [0,12,0,0 ], 512], INIT_UNION(function(b) { b.getUnion1().setU1f1sp("1"); }));

  assertArrayEquals([ [0,13,0,0 ],  -1], INIT_UNION(function(b) { b.getUnion1().setU1f2s0(undefined); }));
  assertArrayEquals([ [0,14,0,0 ], 65], INIT_UNION(function(b) { b.getUnion1().setU1f2s1(1); }));
  assertArrayEquals([ [0,15,0,0 ], 72], INIT_UNION(function(b) { b.getUnion1().setU1f2s8(1); }));
  assertArrayEquals([ [0,16,0,0 ], 80], INIT_UNION(function(b) { b.getUnion1().setU1f2s16(1); }));
  assertArrayEquals([ [0,17,0,0 ], 96], INIT_UNION(function(b) { b.getUnion1().setU1f2s32(1); }));
  assertArrayEquals([ [0,18,0,0 ], 128], INIT_UNION(function(b) { b.getUnion1().setU1f2s64(1); }));
  assertArrayEquals([ [0,19,0,0 ], 512], INIT_UNION(function(b) { b.getUnion1().setU1f2sp("1"); }));

  assertArrayEquals([ [0,0,0,0 ], 192], INIT_UNION(function(b) { b.getUnion2().setU2f0s1(1); }));
  assertArrayEquals([ [0,0,0,0 ], 193], INIT_UNION(function(b) { b.getUnion3().setU3f0s1(1); }));
  assertArrayEquals([ [0,0,1,0 ], 200], INIT_UNION(function(b) { b.getUnion2().setU2f0s8(1); }));
  assertArrayEquals([ [0,0,0,1 ], 208], INIT_UNION(function(b) { b.getUnion3().setU3f0s8(1); }));
  assertArrayEquals([ [0,0,2,0 ], 224], INIT_UNION(function(b) { b.getUnion2().setU2f0s16(1); }));
  assertArrayEquals([ [0,0,0,2 ], 240], INIT_UNION(function(b) { b.getUnion3().setU3f0s16(1); }));
  assertArrayEquals([ [0,0,3,0 ], 256], INIT_UNION(function(b) { b.getUnion2().setU2f0s32(1); }));
  assertArrayEquals([ [0,0,0,3 ], 288], INIT_UNION(function(b) { b.getUnion3().setU3f0s32(1); }));
  assertArrayEquals([ [0,0,4,0 ], 320], INIT_UNION(function(b) { b.getUnion2().setU2f0s64(1); }));
  assertArrayEquals([ [0,0,0,4 ], 384], INIT_UNION(function(b) { b.getUnion3().setU3f0s64(1); }));

};

window['test_UnnamedUnion'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestUnnamedUnion);
  assertEquals(test.TestUnnamedUnion.FOO, root.which());

  root.setBar(321);
  assertEquals(test.TestUnnamedUnion.BAR, root.which());
  assertEquals(test.TestUnnamedUnion.BAR, root.asReader().which());
  assertFalse(root.hasFoo());
  assertTrue(root.hasBar());
  assertFalse(root.asReader().hasFoo());
  assertTrue(root.asReader().hasBar());
  assertEquals(321, root.getBar());
  assertEquals(321, root.asReader().getBar());
  assertThrows(root.getFoo);
  assertThrows(root.asReader().getFoo);

  root.setFoo(123);
  assertEquals(test.TestUnnamedUnion.FOO, root.which());
  assertEquals(test.TestUnnamedUnion.FOO, root.asReader().which());
  assertTrue(root.hasFoo());
  assertFalse(root.hasBar());
  assertTrue(root.asReader().hasFoo());
  assertFalse(root.asReader().hasBar());
  assertEquals(123, root.getFoo());
  assertEquals(123, root.asReader().getFoo());
  assertThrows(root.getBar);
  assertThrows(root.asReader().getBar);

  /*** FIXME

       StructSchema schema = Schema::from<test::TestUnnamedUnion>();

       // The discriminant is allocated just before allocating "bar".
       assertEquals(2u, schema.getProto().getStruct().getDiscriminantOffset());
       assertEquals(0u, schema.getFieldByName("foo").getProto().getSlot().getOffset());
       assertEquals(2u, schema.getFieldByName("bar").getProto().getSlot().getOffset());
  */
};

window['test_Groups'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestGroups);

  {
    var foo = root.getGroups().initFoo();
    foo.setCorge(12345678);
    foo.setGrault([28744, 2249056121]);
    foo.setGarply("foobar");

    assertEquals(12345678, foo.getCorge());
    assertArrayEquals([ 28744, -2045911175 ], foo.getGrault());
    assertEquals("foobar", foo.getGarply().toString());
  }

  {
    var bar = root.getGroups().initBar();
    bar.setCorge(23456789);
    bar.setGrault("barbaz");
    bar.setGarply([54614, 2546219712]); //234567890123456);

    assertEquals(23456789, bar.getCorge());
    assertEquals("barbaz", bar.getGrault().toString());
    assertArrayEquals([ 54614, -1748747584 ], bar.getGarply());
  }

  {
    var baz = root.getGroups().initBaz();
    baz.setCorge(34567890);
    baz.setGrault("bazqux");
    baz.setGarply("quxquux");

    assertEquals(34567890, baz.getCorge());
    assertEquals("bazqux", baz.getGrault().toString());
    assertEquals("quxquux", baz.getGarply().toString());
  }
};

window['test_Unions'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.getRoot(test.TestUnion);

  assertEquals(test.TestUnion.Union0.U0F0S0, root.getUnion0().which());
  assertEquals(undefined, root.getUnion0().getU0f0s0());
  assertThrows(root.getUnion0().getU0f0s1);

  root.getUnion0().setU0f0s1(true);
  assertEquals(test.TestUnion.Union0.U0F0S1, root.getUnion0().which());
  assertTrue(root.getUnion0().getU0f0s1());
  assertThrows(root.getUnion0().getU0f0s0);

  root.getUnion0().setU0f0s8(123);
  assertEquals(test.TestUnion.Union0.U0F0S8, root.getUnion0().which());
  assertEquals(123, root.getUnion0().getU0f0s8());
  assertThrows(root.getUnion0().getU0f0s1);
};

window['test_InterleavedGroups'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestInterleavedGroups);

  assertFalse(root.hasGroup1());
  assertFalse(root.hasGroup2());
  assertFalse(root.asReader().hasGroup1());
  assertFalse(root.asReader().hasGroup2());

  root.getGroup1().setBar(1);

  assertTrue(root.hasGroup1());
  assertFalse(root.hasGroup2());
  assertTrue(root.asReader().hasGroup1());
  assertFalse(root.asReader().hasGroup2());

  // Merely setting the union to a non-default field should also make "has" light up.
  root.getGroup2().initCorge();

  assertTrue(root.hasGroup1());
  assertTrue(root.hasGroup2());
  assertTrue(root.asReader().hasGroup1());
  assertTrue(root.asReader().hasGroup2());

  // Init both groups to different values.
  {
    var group = root.getGroup1();
    group.setFoo(12345678);
    group.setBar([28744, 2249056121]); // 123456789012345

    var corge = group.initCorge();
    corge.setGrault([229956, 821579789]); // 987654321098765
    corge.setGarply(12345);
    corge.setPlugh("plugh");

    corge.setXyzzy("xyzzy");
    group.setWaldo("waldo");
  }

  {
    var group = root.getGroup2();
    group.setFoo(23456789);
    group.setBar([54614, 2546219712]); // 234567890123456

    var corge = group.initCorge();

    corge.setGrault([204086, 515416198]); // 876543210987654

    corge.setGarply(23456);
    corge.setPlugh("hgulp");
    corge.setXyzzy("yzzyx");
    group.setWaldo("odlaw");
  }

  assertTrue(root.hasGroup1());
  assertTrue(root.hasGroup2());
  assertTrue(root.asReader().hasGroup1());
  assertTrue(root.asReader().hasGroup2());

  // Check group1 is still set correctly.
  {
    var group = root.asReader().getGroup1();
    assertEquals(12345678, group.getFoo());
    assertArrayEquals([ 28744, 2249056121 ], group.getBar());
    var corge = group.getCorge();
    assertArrayEquals([ 229956, 821579789 ], corge.getGrault());
    assertEquals(12345, corge.getGarply());
    assertEquals("plugh", corge.getPlugh().toString());
    assertEquals("xyzzy", corge.getXyzzy().toString());
    assertEquals("waldo", group.getWaldo().toString());
  }

  // Zero out group 1 and see if it is zero'd.
  {
    var group = root.initGroup1().asReader();
    assertEquals(0, group.getFoo());
    assertArrayEquals([0, 0], group.getBar());
    assertEquals(test.TestInterleavedGroups.Group1.QUX, group.which());
    assertEquals(0, group.getQux());
    assertFalse(group.hasWaldo());
  }

  assertFalse(root.hasGroup1());
  assertTrue(root.hasGroup2());
  assertFalse(root.asReader().hasGroup1());
  assertTrue(root.asReader().hasGroup2());

  // Group 2 should not have been touched.
  {
    var group = root.asReader().getGroup2();
    assertEquals(23456789, group.getFoo());
    assertArrayEquals([ 54614, 2546219712 ], group.getBar());
    var corge = group.getCorge();
    assertArrayEquals([ 204086, 515416198 ], corge.getGrault());
    assertEquals(23456, corge.getGarply());
    assertEquals("hgulp", corge.getPlugh().toString());
    assertEquals("yzzyx", corge.getXyzzy().toString());
    assertEquals("odlaw", group.getWaldo().toString());
  }
};

window['test_UnionDefault'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var reader = builder.getRoot(test.TestUnionDefaults).asReader();

  {
    var field = reader.getS16s8s64s8Set();
    assertEquals(test.TestUnion.Union0.U0F0S16, field.getUnion0().which());
    assertEquals(test.TestUnion.Union1.U1F0S8 , field.getUnion1().which());
    assertEquals(test.TestUnion.Union2.U2F0S64, field.getUnion2().which());
    assertEquals(test.TestUnion.Union3.U3F0S8 , field.getUnion3().which());
    assertEquals(321, field.getUnion0().getU0f0s16());
    assertEquals(123, field.getUnion1().getU1f0s8());
    assertArrayEquals([ 2874452, 1567312775 ], field.getUnion2().getU2f0s64()); // 12345678901234567
    assertEquals(55, field.getUnion3().getU3f0s8());
  }

  {
    var field = reader.getS0sps1s32Set();
    assertEquals(test.TestUnion.Union0.U0F1S0 , field.getUnion0().which());
    assertEquals(test.TestUnion.Union1.U1F0SP , field.getUnion1().which());
    assertEquals(test.TestUnion.Union2.U2F0S1 , field.getUnion2().which());
    assertEquals(test.TestUnion.Union3.U3F0S32, field.getUnion3().which());
    assertEquals(undefined, field.getUnion0().getU0f1s0());
    assertEquals("foo", field.getUnion1().getU1f0sp().toString());
    assertEquals(true, field.getUnion2().getU2f0s1());
    assertEquals(12345678, field.getUnion3().getU3f0s32());
  }

  {
    var field = reader.getUnnamed1();
    assertEquals(test.TestUnnamedUnion.FOO, field.which());
    assertEquals(123, field.getFoo());
    assertFalse(field.hasBefore());
    assertFalse(field.hasAfter());
  }

  {
    var field = reader.getUnnamed2();
    assertEquals(test.TestUnnamedUnion.BAR, field.which());
    assertEquals(321, field.getBar());
    assertEquals("foo", field.getBefore().toString());
    assertEquals("bar", field.getAfter().toString());
  }
};


// =======================================================================================

window['test_ListDefaults'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.getRoot(test.TestListDefaults);

  capnp.test.util.genericCheckListDefaults(root.asReader());
  capnp.test.util.genericCheckListDefaults(root);
  capnp.test.util.genericCheckListDefaults(root.asReader());
};

window['test_BuildListDefaults'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.getRoot(test.TestListDefaults);

  capnp.test.util.genericInitListDefaults(root);
  capnp.test.util.genericCheckListDefaults(root.asReader());
  capnp.test.util.genericCheckListDefaults(root);
  capnp.test.util.genericCheckListDefaults(root.asReader());
};

window['test_ListSetters'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.getRoot(test.TestListDefaults);
  capnp.test.util.genericInitListDefaults(root);

  {
    var builder2 = new capnp.message.MallocMessageBuilder();
    var root2 = builder2.getRoot(test.TestListDefaults);

    root2.getLists().setList0(root.getLists().getList0());
    var _list1 = root.getLists().getList1();
    builder2.getArena().getSegment0().validateIntegrity();
    root2.getLists().setList1(_list1);
    root2.getLists().setList8(root.getLists().getList8());
    root2.getLists().setList16(root.getLists().getList16());
    root2.getLists().setList32(root.getLists().getList32());
    root2.getLists().setList64(root.getLists().getList64());
    root2.getLists().setListP(root.getLists().getListP());

    {
      var dst = root2.getLists().initInt32ListList(3);
      var src = root.getLists().getInt32ListList();
      dst.set(0, src.get(0));
      dst.set(1, src.get(1));
      dst.set(2, src.get(2));
    }
    
    {
      var dst = root2.getLists().initTextListList(3);
      var src = root.getLists().getTextListList();
      dst.set(0, src.get(0));
      dst.set(1, src.get(1));
      dst.set(2, src.get(2));
    }

    {
      var dst = root2.getLists().initStructListList(2);
      var src = root.getLists().getStructListList();
      dst.set(0, src.get(0));
      dst.set(1, src.get(1));
    }
  }
};

window['test_ZeroOldObject'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();

  var root = builder.initRoot(test.TestAllTypes);
  capnp.test.util.initTestMessage(root);

  var oldRoot = root.asReader();
  capnp.test.util.checkTestMessage(oldRoot);

  var oldSub = oldRoot.getStructField();
  var oldSub2 = oldRoot.getStructList().get(0);

  root = builder.initRoot(test.TestAllTypes);
  capnp.test.util.checkTestMessageAllZero(oldRoot);
  capnp.test.util.checkTestMessageAllZero(oldSub);
  capnp.test.util.checkTestMessageAllZero(oldSub2);
};

window['test_Has'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();

  var root = builder.initRoot(test.TestAllTypes);

  assertFalse(root.hasTextField());
  assertFalse(root.hasDataField());
  assertFalse(root.hasStructField());
  assertFalse(root.hasInt32List());

  assertFalse(root.asReader().hasTextField());
  assertFalse(root.asReader().hasDataField());
  assertFalse(root.asReader().hasStructField());
  assertFalse(root.asReader().hasInt32List());

  capnp.test.util.initTestMessage(root);

  assertTrue(root.hasTextField());
  assertTrue(root.hasDataField());
  assertTrue(root.hasStructField());
  assertTrue(root.hasInt32List());

  assertTrue(root.asReader().hasTextField());
  assertTrue(root.asReader().hasDataField());
  assertTrue(root.asReader().hasStructField());
  assertTrue(root.asReader().hasInt32List());

};

window['test_Constants'] = function() {

  assertEquals(undefined, test.TestConstants.VOID_CONST);
  assertEquals(true, test.TestConstants.BOOL_CONST);
  assertEquals(-123, test.TestConstants.INT8_CONST);
  assertEquals(-12345, test.TestConstants.INT16_CONST);
  assertEquals(-12345678, test.TestConstants.INT32_CONST);
  assertArrayEquals([ -28745, 2045911175 ], test.TestConstants.INT64_CONST);
  assertEquals(234, test.TestConstants.UINT8_CONST);
  assertEquals(45678, test.TestConstants.UINT16_CONST);
  assertEquals(3456789012, test.TestConstants.UINT32_CONST);
  assertArrayEquals([ 2874452364, 3944680146 ], test.TestConstants.UINT64_CONST);
  assertRoughlyEquals(1234.5, test.TestConstants.FLOAT32_CONST, 1e-10);
  assertRoughlyEquals(-123e45, test.TestConstants.FLOAT64_CONST, 1e35);
  assertEquals("foo", test.TestConstants.TEXT_CONST.get().toString());
  assertTrue(capnp.test.util.data("bar").equals(test.TestConstants.DATA_CONST.get()));
  {
    var subReader = test.TestConstants.STRUCT_CONST.get();
    assertEquals(undefined, subReader.getVoidField());
    assertEquals(true, subReader.getBoolField());
    assertEquals(-12, subReader.getInt8Field());
    assertEquals(3456, subReader.getInt16Field());
    assertEquals(-78901234, subReader.getInt32Field());
    assertArrayEquals([ 13222, 954757966 ], subReader.getInt64Field()); // 56789012345678
    assertEquals(90, subReader.getUInt8Field());
    assertEquals(1234, subReader.getUInt16Field());
    assertEquals(56789012, subReader.getUInt32Field());
    assertArrayEquals([ 80484641, 309267154 ], subReader.getUInt64Field());
    assertRoughlyEquals(-1.25e-10, subReader.getFloat32Field(), 1e-17);
    assertEquals(345, subReader.getFloat64Field());
    assertEquals("baz", subReader.getTextField().toString());
    assertTrue(capnp.test.util.data("qux").equals(subReader.getDataField()));
    {
      var subSubReader = subReader.getStructField();
      assertEquals("nested", subSubReader.getTextField().toString());
      assertEquals("really nested", subSubReader.getStructField().getTextField().toString());
    }
    assertEquals(test.TestEnum.BAZ, subReader.getEnumField());

    capnp.test.util.checkList(subReader.getVoidList(), [undefined, undefined, undefined]);
    capnp.test.util.checkList(subReader.getBoolList(), [false, true, false, true, true]);
    capnp.test.util.checkList(subReader.getInt8List(), [12, -34, -0x80, 0x7f]);
    capnp.test.util.checkList(subReader.getInt16List(), [1234, -5678, -0x8000, 0x7fff]);
    // gcc warns on -0x800... and the only work-around I could find was to do -0x7ff...-1.
    capnp.test.util.checkList(subReader.getInt32List(), [12345678, -90123456, -0x7fffffff - 1, 0x7fffffff]);
    capnp.test.util.checkList(subReader.getInt64List(), [ [ 28744, 2249056121 - 0x100000000 ], [ -158070, -49056466 ], [ -2147483648, 0 ], [ 2147483647, 4294967295 - 0x100000000 ] ]);
    capnp.test.util.checkList(subReader.getUInt8List(), [12, 34, 0, 0xff]);
    capnp.test.util.checkList(subReader.getUInt16List(), [1234, 5678, 0, 0xffff]);
    capnp.test.util.checkList(subReader.getUInt32List(), [12345678, 90123456, 0, 0xffffffff]);
    capnp.test.util.checkList(subReader.getUInt64List(), [[ 28744, 2249056121 ], [ 158069, 49056466 ], [0, 0], [0xffffffff, 0xffffffff ] ]);
    capnp.test.util.checkFloatList(subReader.getFloat32List(), [0.0, 1234567.0, 1e37, -1e37, 1e-37, -1e-37], 1e30);
    capnp.test.util.checkList(subReader.getFloat64List(), [0.0, 123456789012345.0, 1e306, -1e306, 1e-306, -1e-306]);
    capnp.test.util.checkStrList(subReader.getTextList(), ["quux", "corge", "grault"]);
    capnp.test.util.checkDataList(subReader.getDataList(), [capnp.test.util.data("garply"), capnp.test.util.data("waldo"), capnp.test.util.data("fred")]);
    {
      var listReader = subReader.getStructList();
      assertEquals(3, listReader.size());
      assertEquals("x structlist 1", listReader.get(0).getTextField().toString());
      assertEquals("x structlist 2", listReader.get(1).getTextField().toString());
      assertEquals("x structlist 3", listReader.get(2).getTextField().toString());
    }
    capnp.test.util.checkList(subReader.getEnumList(), [test.TestEnum.QUX, test.TestEnum.BAR, test.TestEnum.GRAULT]);
  }
  assertEquals(test.TestEnum.CORGE, test.TestConstants.ENUM_CONST);

  assertEquals(6, test.TestConstants.VOID_LIST_CONST.get().size());
  capnp.test.util.checkList(test.TestConstants.BOOL_LIST_CONST.get(), [true, false, false, true]);
  capnp.test.util.checkList(test.TestConstants.INT8_LIST_CONST.get(), [111, -111]);
  capnp.test.util.checkList(test.TestConstants.INT16_LIST_CONST.get(), [11111, -11111]);
  capnp.test.util.checkList(test.TestConstants.INT32_LIST_CONST.get(), [111111111, -111111111]);
  capnp.test.util.checkList(test.TestConstants.INT64_LIST_CONST.get(), [ [ 258700715, 734294471 ], [ -258700716, -734294471 ] ]);
  capnp.test.util.checkList(test.TestConstants.UINT8_LIST_CONST.get(), [111, 222]);
  capnp.test.util.checkList(test.TestConstants.UINT16_LIST_CONST.get(), [33333, 44444]);
  capnp.test.util.checkList(test.TestConstants.UINT32_LIST_CONST.get(), [3333333333]);
  capnp.test.util.checkList(test.TestConstants.UINT64_LIST_CONST.get(), [ [ 2587007151, 3047977415 ] ]);
  {
    var listReader = test.TestConstants.FLOAT32_LIST_CONST.get();
    assertEquals(4, listReader.size());
    assertEquals(5555.5, listReader.get(0));
    assertEquals(Infinity, listReader.get(1));
    assertEquals(-Infinity, listReader.get(2));
    assertTrue(listReader.get(3) != listReader.get(3));
  }
  {
    var listReader = test.TestConstants.FLOAT64_LIST_CONST.get();
    assertEquals(4, listReader.size());
    assertEquals(7777.75, listReader.get(0));
    assertEquals(Infinity, listReader.get(1));
    assertEquals(-Infinity, listReader.get(2));
    assertTrue(listReader.get(3) != listReader.get(3));
  }
  capnp.test.util.checkStrList(test.TestConstants.TEXT_LIST_CONST.get(), ["plugh", "xyzzy", "thud"]);
  capnp.test.util.checkDataList(test.TestConstants.DATA_LIST_CONST.get(), [capnp.test.util.data("oops"), capnp.test.util.data("exhausted"), capnp.test.util.data("rfc3092")]);
  {
    var listReader = test.TestConstants.STRUCT_LIST_CONST.get();
    assertEquals(3, listReader.size());
    assertEquals("structlist 1", listReader.get(0).getTextField().toString());
    assertEquals("structlist 2", listReader.get(1).getTextField().toString());
    assertEquals("structlist 3", listReader.get(2).getTextField().toString());
  }
  capnp.test.util.checkList(test.TestConstants.ENUM_LIST_CONST.get(), [test.TestEnum.FOO, test.TestEnum.GARPLY]);
};

window['test_GlobalConstants'] = function() {

  assertEquals(12345, test.GLOBAL_INT);
  assertEquals("foobar", test.GLOBAL_TEXT.get().toString());
  assertEquals(54321, test.GLOBAL_STRUCT.get().getInt32Field());

  var reader = test.DERIVED_CONSTANT.get();

  assertEquals(12345, reader.getUInt32Field());
  assertEquals("foo", reader.getTextField().toString());
  capnp.test.util.checkStrList(reader.getStructField().getTextList(), ["quux", "corge", "grault"]);
  capnp.test.util.checkList(reader.getInt16List(), [11111, -11111]);

  {
    var listReader = reader.getStructList();
    assertEquals(3, listReader.size());
    assertEquals("structlist 1", listReader.get(0).getTextField().toString());
    assertEquals("structlist 2", listReader.get(1).getTextField().toString());
    assertEquals("structlist 3", listReader.get(2).getTextField().toString());
  }
};

window['test_HasEmptyStruct'] = function() {

  var message = new capnp.message.MallocMessageBuilder();
  var root = message.initRoot(test.TestObject);

  assertEquals(1, root.totalSizeInWords());

  assertFalse(root.asReader().hasObjectField());
  assertFalse(root.hasObjectField());
  root.initObjectField(test.TestEmptyStruct);
  assertTrue(root.asReader().hasObjectField());
  assertTrue(root.hasObjectField());

  assertEquals(1, root.totalSizeInWords());
};

window['test_HasEmptyList'] = function() {

  var message = new capnp.message.MallocMessageBuilder();
  var root = message.initRoot(test.TestObject);

  assertEquals(1, root.totalSizeInWords());

  assertFalse(root.asReader().hasObjectField());
  assertFalse(root.hasObjectField());
  root.initObjectField(capnp.list.ListOfPrimitives(capnp.prim.int32_t), 0);
  assertTrue(root.asReader().hasObjectField());
  assertTrue(root.hasObjectField());

  assertEquals(1, root.totalSizeInWords());
};

window['test_SmallStructLists'] = function() {

  // In this test, we will manually initialize TestListDefaults.lists to match the default
  // value and verify that we end up with the same encoding that the compiler produces.

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.getRoot(test.TestListDefaults);
  var sl = root.initLists();

  assertEquals(0, sl.getList0 ().size());
  assertEquals(0, sl.getList1 ().size());
  assertEquals(0, sl.getList8 ().size());
  assertEquals(0, sl.getList16().size());
  assertEquals(0, sl.getList32().size());
  assertEquals(0, sl.getList64().size());
  assertEquals(0, sl.getListP ().size());
  assertEquals(0, sl.getInt32ListList().size());
  assertEquals(0, sl.getTextListList().size());
  assertEquals(0, sl.getStructListList().size());

  { var l = sl.initList0 (2); l.get(0).setF(undefined);               l.get(1).setF(undefined); }
  { var l = sl.initList1 (4); l.get(0).setF(true);                    l.get(1).setF(false);
    l.get(2).setF(true);              l.get(3).setF(true); }
  { var l = sl.initList8 (2); l.get(0).setF(123);                     l.get(1).setF(45); }
  { var l = sl.initList16(2); l.get(0).setF(12345);                   l.get(1).setF(6789); }
  { var l = sl.initList32(2); l.get(0).setF(123456789);               l.get(1).setF(234567890); }
  { var l = sl.initList64(2); l.get(0).setF([ 287445, 1015724736 ]);  l.get(1).setF([ 546145, 3987360647 ]); }
  { var l = sl.initListP (2); l.get(0).setF("foo");                   l.get(1).setF("bar"); }

  {
    var l = sl.initInt32ListList(3);
    l.set(0, [1, 2, 3]);
    l.set(1, [4, 5]);
    l.set(2, [12341234]);
  }

  {
    var l = sl.initTextListList(3);
    l.set(0, ["foo", "bar"]);
    l.set(1, ["baz"]);
    l.set(2, ["qux", "corge"]);
  }

  {
    var l = sl.initStructListList(2);
    l.init(0, 2);
    l.init(1, 1);

    l.get(0).get(0).setInt32Field(123);
    l.get(0).get(1).setInt32Field(456);
    l.get(1).get(0).setInt32Field(789);
  }

  var segment = builder.getSegmentsForOutput()[0];

  // Initialize another message such that it copies the default value for that field.
  var defaultBuilder = new capnp.message.MallocMessageBuilder();
  defaultBuilder.getRoot(test.TestListDefaults).getLists();
  var defaultSegment = defaultBuilder.getSegmentsForOutput()[0];

  // Should match...
  assertEquals(defaultSegment.byteLength, segment.byteLength);

  for (var i = 0; i < Math.max(segment.byteLength, defaultSegment.byteLength); i++) {
    assertEquals(defaultSegment.getUint8(i),
                 segment.getUint8(i));
  }
};

// =======================================================================================

window['test_ListUpgrade'] = function() {
  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestObject);

  root.setObjectField(capnp.list.List(capnp.prim.uint16_t), [12, 34, 56]);

  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint8_t)), [12, 34, 56]);

  {
    var l = root.getObjectField(capnp.list.List(test.TestLists.Struct8));
    assertEquals(3, l.size());
    assertEquals(12, l.get(0).getF());
    assertEquals(34, l.get(1).getF());
    assertEquals(56, l.get(2).getF());
  }

  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint16_t)), [12, 34, 56]);

  var reader = root.asReader();

  capnp.test.util.checkList(reader.getObjectField(capnp.list.List(capnp.prim.uint8_t)), [12, 34, 56]);

  {
    var l = reader.getObjectField(capnp.list.List(test.TestLists.Struct8));
    assertEquals(3, l.size());
    assertEquals(12, l.get(0).getF());
    assertEquals(34, l.get(1).getF());
    assertEquals(56, l.get(2).getF());
  }

  assertThrows(function() { reader.getObjectField(capnp.list.List(capnp.prim.uint32_t)); });

  {
    var l = reader.getObjectField(capnp.list.List(test.TestLists.Struct32));
    assertEquals(3, l.size());
    assertEquals(0, l.get(0).getF());
    assertEquals(0, l.get(1).getF());
    assertEquals(0, l.get(2).getF());
  }

  capnp.test.util.checkList(reader.getObjectField(capnp.list.List(capnp.prim.uint16_t)), [12, 34, 56]);
};

window['test_BitListDowngrade'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestObject);

  root.setObjectField(capnp.list.List(capnp.prim.uint16_t), [0x1201, 0x3400, 0x5601, 0x7801]);

  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.bool)), [true, false, true, true]);

  {
    var l = root.getObjectField(capnp.list.List(test.TestLists.Struct1));
    assertEquals(4, l.size());
    assertTrue(l.get(0).getF());
    assertFalse(l.get(1).getF());
    assertTrue(l.get(2).getF());
    assertTrue(l.get(3).getF());
  }

  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint16_t)), [0x1201, 0x3400, 0x5601, 0x7801]);

  var reader = root.asReader();

  capnp.test.util.checkList(reader.getObjectField(capnp.list.List(capnp.prim.bool)), [true, false, true, true]);

  {
    var l = reader.getObjectField(capnp.list.List(test.TestLists.Struct1));
    assertEquals(4, l.size());
    assertTrue(l.get(0).getF());
    assertFalse(l.get(1).getF());
    assertTrue(l.get(2).getF());
    assertTrue(l.get(3).getF());
  }

  capnp.test.util.checkList(reader.getObjectField(capnp.list.List(capnp.prim.uint16_t)), [0x1201, 0x3400, 0x5601, 0x7801]);
};

window['test_BitListDowngradeFromStruct'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestObject);

  {
    var list = root.initObjectField(capnp.list.List(test.TestLists.Struct1c), 4);
    list.get(0).setF(true);
    list.get(1).setF(false);
    list.get(2).setF(true);
    list.get(3).setF(true);
  }

  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.bool)), [true, false, true, true]);

  {
    var l = root.getObjectField(capnp.list.List(test.TestLists.Struct1));
    assertEquals(4, l.size());
    assertTrue(l.get(0).getF());
    assertFalse(l.get(1).getF());
    assertTrue(l.get(2).getF());
    assertTrue(l.get(3).getF());
  }

  var reader = root.asReader();

  capnp.test.util.checkList(reader.getObjectField(capnp.list.List(capnp.prim.bool)), [true, false, true, true]);

  {
    var l = reader.getObjectField(capnp.list.List(test.TestLists.Struct1));
    assertEquals(4, l.size());
    assertTrue(l.get(0).getF());
    assertFalse(l.get(1).getF());
    assertTrue(l.get(2).getF());
    assertTrue(l.get(3).getF());
  }
};

window['test_HasEmptyStructList'] = function() {

  var message = new capnp.message.MallocMessageBuilder();
  var root = message.initRoot(test.TestObject);

  assertEquals(1, root.totalSizeInWords());

  assertFalse(root.asReader().hasObjectField());
  assertFalse(root.hasObjectField());
  root.initObjectField(capnp.list.ListOfStructs(test.TestAllTypes), 0); // FIXME - use capnp.list.List
  assertTrue(root.asReader().hasObjectField());
  assertTrue(root.hasObjectField());

  assertEquals(2, root.totalSizeInWords());
};


window['test_BitListUpgrade'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestObject);

  root.setObjectField(capnp.list.List(capnp.prim.bool), [true, false, true, true]);

  {
    var l = root.getObjectField(capnp.list.List(test.TestLists.Struct1));
    assertEquals(4, l.size());
    assertTrue(l.get(0).getF());
    assertFalse(l.get(1).getF());
    assertTrue(l.get(2).getF());
    assertTrue(l.get(3).getF());
  }

  var reader = root.asReader();

  assertThrows(function() { reader.getObjectField(capnp.list.List(capnp.prim.uint8_t)); });

  {
    var l = reader.getObjectField(capnp.list.List(test.TestFieldZeroIsBit));
    assertEquals(4, l.size());
    assertTrue(l.get(0).getBit());
    assertFalse(l.get(1).getBit());
    assertTrue(l.get(2).getBit());
    assertTrue(l.get(3).getBit());

    // Other fields are defaulted.
    assertTrue(l.get(0).getSecondBit());
    assertTrue(l.get(1).getSecondBit());
    assertTrue(l.get(2).getSecondBit());
    assertTrue(l.get(3).getSecondBit());
    assertEquals(123, l.get(0).getThirdField());
    assertEquals(123, l.get(1).getThirdField());
    assertEquals(123, l.get(2).getThirdField());
    assertEquals(123, l.get(3).getThirdField());
  }

  capnp.test.util.checkList(reader.getObjectField(capnp.list.List(capnp.prim.bool)), [true, false, true, true]);
};

window['test_UpgradeStructInBuilder'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestObject);

  var oldReader;

  {
    var oldVersion = root.initObjectField(test.TestOldVersion);
    oldVersion.setOld1([0, 123]);
    oldVersion.setOld2("foo");
    var sub = oldVersion.initOld3();
    sub.setOld1(456);
    sub.setOld2("bar");

    oldReader = oldVersion;
  }

  var size = builder.getSegmentsForOutput()[0].byteLength >> 3;
  var size2;

  {
    var newVersion = root.getObjectField(test.TestNewVersion);

    // The old instance should have been zero'd.
    assertArrayEquals([0, 0], oldReader.getOld1());
    assertEquals("", oldReader.getOld2().toString());
    assertArrayEquals([0, 0], oldReader.getOld3().getOld1());
    assertEquals("", oldReader.getOld3().getOld2().toString());

    // Size should have increased due to re-allocating the struct.
    var size1 = builder.getSegmentsForOutput()[0].byteLength >> 3;
    assertTrue(size1 > size);

    var sub = newVersion.getOld3();

    // Size should have increased due to re-allocating the sub-struct.
    size2 = builder.getSegmentsForOutput()[0].byteLength >> 3;
    assertTrue(size2 > size1);

    // Check contents.
    assertArrayEquals([0, 123], newVersion.getOld1());
    assertEquals("foo", newVersion.getOld2().toString());
    assertArrayEquals([0, 987], newVersion.getNew1());
    assertEquals("baz", newVersion.getNew2().toString());

    assertArrayEquals([0, 456], sub.getOld1());
    assertEquals("bar", sub.getOld2().toString());
    assertArrayEquals([0, 987], sub.getNew1());
    assertEquals("baz", sub.getNew2().toString());

    newVersion.setOld1([0, 234]);
    newVersion.setOld2("qux");
    newVersion.setNew1([0, 321]);
    newVersion.setNew2("quux");

    sub.setOld1([0, 567]);
    sub.setOld2("corge");
    sub.setNew1([0, 654]);
    sub.setNew2("grault");
  }

  // We set four small text fields and implicitly initialized two to defaults, so the size should
  // have raised by six words.
  var size3 = builder.getSegmentsForOutput()[0].byteLength >> 3;
  assertEquals(size2 + 6, size3);

  {
    // Go back to old version.  It should have the values set on the new version.
    var oldVersion = root.getObjectField(test.TestOldVersion);
    assertArrayEquals([0, 234], oldVersion.getOld1());
    assertEquals("qux", oldVersion.getOld2().toString());

    var sub = oldVersion.getOld3();
    assertArrayEquals([0, 567], sub.getOld1());
    assertEquals("corge", sub.getOld2().toString());

    // Overwrite the old fields.  The new fields should remain intact.
    oldVersion.setOld1([0, 345]);
    oldVersion.setOld2("garply");
    sub.setOld1([0, 678]);
    sub.setOld2("waldo");
  }

  // We set two small text fields, so the size should have raised by two words.
  var size4 = builder.getSegmentsForOutput()[0].byteLength >> 3;
  assertEquals(size3 + 2, size4);

  {
    // Back to the new version again.
    var newVersion = root.getObjectField(test.TestNewVersion);
    assertArrayEquals([0, 345], newVersion.getOld1());
    assertEquals("garply", newVersion.getOld2().toString());
    assertArrayEquals([0, 321], newVersion.getNew1());
    assertEquals("quux", newVersion.getNew2().toString());

    var sub = newVersion.getOld3();
    assertArrayEquals([0, 678], sub.getOld1());
    assertEquals("waldo", sub.getOld2().toString());
    assertArrayEquals([0, 654], sub.getNew1());
    assertEquals("grault", sub.getNew2().toString());
  }

  // Size should not have changed because we didn't write anything and the structs were already
  // the right size.
  assertEquals(size4, builder.getSegmentsForOutput()[0].byteLength >> 3);
};

window['test_UpgradeStructInBuilderFarPointers'] = function() {
  
  // Force allocation of a Far pointer.

  var builder = new capnp.message.MallocMessageBuilder(7, capnp.message.AllocationStrategy.FIXED_SIZE);
  var root = builder.initRoot(test.TestObject);

  root.initObjectField(test.TestOldVersion).setOld2("foo");

  // We should have allocated all but one word of the first segment.
  assertEquals(1, builder.getSegmentsForOutput().length);
  assertEquals(6, builder.getSegmentsForOutput()[0].byteLength >> 3);

  // Now if we upgrade...
  assertEquals("foo", root.getObjectField(test.TestNewVersion).getOld2().toString());

  // We should have allocated the new struct in a new segment, but allocated the far pointer
  // landing pad back in the first segment.
  assertEquals(2, builder.getSegmentsForOutput().length);
  assertEquals(7, builder.getSegmentsForOutput()[0].byteLength >> 3);
  assertEquals(6, builder.getSegmentsForOutput()[1].byteLength >> 3);
};

window['test_UpgradeStructInBuilderDoubleFarPointers'] = function() {

  // Force allocation of a double-Far pointer.

  var builder = new capnp.message.MallocMessageBuilder(6, capnp.message.AllocationStrategy.FIXED_SIZE);
  var root = builder.initRoot(test.TestObject);

  root.initObjectField(test.TestOldVersion).setOld2("foo");

  // We should have allocated all of the first segment.
  assertEquals(1, builder.getSegmentsForOutput().length);
  assertEquals(6, builder.getSegmentsForOutput()[0].byteLength >> 3);

  // Now if we upgrade...
  assertEquals("foo", root.getObjectField(test.TestNewVersion).getOld2().toString());

  // We should have allocated the new struct in a new segment, and also allocated the far pointer
  // landing pad in yet another segment.
  assertEquals(3, builder.getSegmentsForOutput().length);
  assertEquals(6, builder.getSegmentsForOutput()[0].byteLength >> 3);
  assertEquals(6, builder.getSegmentsForOutput()[1].byteLength >> 3);
  assertEquals(2, builder.getSegmentsForOutput()[2].byteLength >> 3);
};

window['test_UpgradeListInBuilder'] = function() {

  // Test every damned list upgrade.

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestObject);

  // -----------------------------------------------------------------

  root.setObjectField(capnp.list.List(capnp.prim.Void), [ undefined, undefined, undefined, undefined ]);
  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.Void)), [ undefined, undefined, undefined, undefined ]);
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.bool)); });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint8_t)); });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint16_t)) });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint32_t)); });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint64_t)); });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.blob.Text)); });
  checkUpgradedList(root, [[0,0], [0,0], [0,0], [0,0]], ["", "", "", ""]);

  // -----------------------------------------------------------------

  {
    root.setObjectField(capnp.list.List(capnp.prim.bool), [true, false, true, true]);
    var orig = root.asReader().getObjectField(capnp.list.List(capnp.prim.bool));
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.Void)), [undefined, undefined, undefined, undefined]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.bool)), [true, false, true, true]);

    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint8_t)); });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint16_t)) });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint32_t)); });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint64_t)); });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.blob.Text)); });

    capnp.test.util.checkList(orig, [true, false, true, true]);
    checkUpgradedList(root, [[0,1], [0,0], [0,1], [0,1]], ["", "", "", ""]);
    capnp.test.util.checkList(orig, [false, false, false, false]);  // old location zero'd during upgrade
  }

  // -----------------------------------------------------------------

  {
    root.setObjectField(capnp.list.List(capnp.prim.uint8_t), [0x12, 0x23, 0x33, 0x44]);
    var orig = root.asReader().getObjectField(capnp.list.List(capnp.prim.uint8_t));
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.Void)), [undefined, undefined, undefined, undefined]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.bool)), [false, true, true, false]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint8_t)), [0x12, 0x23, 0x33, 0x44]);
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint16_t)) });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint32_t)); });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint64_t)); });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.blob.Text)); });

    capnp.test.util.checkList(orig, [0x12, 0x23, 0x33, 0x44]);
    checkUpgradedList(root, [[0,0x12], [0,0x23], [0,0x33], [0,0x44]], ["", "", "", ""]);
    capnp.test.util.checkList(orig, [0, 0, 0, 0]);  // old location zero'd during upgrade
  }

  // -----------------------------------------------------------------

  {
    root.setObjectField(capnp.list.List(capnp.prim.uint16_t), [0x5612, 0x7823, 0xab33, 0xcd44]);
    var orig = root.asReader().getObjectField(capnp.list.List(capnp.prim.uint16_t));
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.Void)), [undefined, undefined, undefined, undefined]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.bool)), [false, true, true, false]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint8_t)), [0x12, 0x23, 0x33, 0x44]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint16_t)), [0x5612, 0x7823, 0xab33, 0xcd44]);
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint32_t)); });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint64_t)); });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.blob.Text)); });

    capnp.test.util.checkList(orig, [0x5612, 0x7823, 0xab33, 0xcd44]);
    checkUpgradedList(root, [[0,0x5612], [0,0x7823], [0,0xab33], [0,0xcd44]], ["", "", "", ""]);
    capnp.test.util.checkList(orig, [0, 0, 0, 0]);  // old location zero'd during upgrade
  }

  // -----------------------------------------------------------------

  {
    root.setObjectField(capnp.list.List(capnp.prim.uint32_t), [0x17595612, 0x29347823, 0x5923ab32, 0x1a39cd45]);
    var orig = root.asReader().getObjectField(capnp.list.List(capnp.prim.uint32_t));
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.Void)), [undefined, undefined, undefined, undefined]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.bool)), [false, true, false, true]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint8_t)), [0x12, 0x23, 0x32, 0x45]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint16_t)), [0x5612, 0x7823, 0xab32, 0xcd45]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint32_t)), [0x17595612, 0x29347823, 0x5923ab32, 0x1a39cd45]);
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint64_t)); });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.blob.Text)); });

    capnp.test.util.checkList(orig, [0x17595612, 0x29347823, 0x5923ab32, 0x1a39cd45]);
    checkUpgradedList(root, [[0,0x17595612], [0,0x29347823], [0,0x5923ab32], [0,0x1a39cd45]], ["", "", "", ""]);
    capnp.test.util.checkList(orig, [0, 0, 0, 0]);  // old location zero'd during upgrade
  }

  // -----------------------------------------------------------------

  {
    root.setObjectField(capnp.list.List(capnp.prim.uint64_t), [[0x1234abcd, 0x8735fe21], [0x7173bc0e, 0x1923af36]]);
    var orig = root.asReader().getObjectField(capnp.list.List(capnp.prim.uint64_t));
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.Void)), [undefined, undefined]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.bool)), [true, false]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint8_t)), [0x21, 0x36]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint16_t)), [0xfe21, 0xaf36]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint32_t)), [0x8735fe21, 0x1923af36]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint64_t)), [[0x1234abcd, 0x8735fe21], [0x7173bc0e, 0x1923af36]]);
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.blob.Text)); });

    capnp.test.util.checkList(orig, [[0x1234abcd, 0x8735fe21], [0x7173bc0e, 0x1923af36]]);
    checkUpgradedList(root, [[0x1234abcd, 0x8735fe21-0x100000000], [0x7173bc0e, 0x1923af36]], ["", ""]);
    capnp.test.util.checkList(orig, [[0,0], [0,0]]);  // old location zero'd during upgrade
  }

  // -----------------------------------------------------------------

  {
    root.setObjectField(capnp.list.List(capnp.blob.Text), ["foo", "bar", "baz"]);
    var orig = root.asReader().getObjectField(capnp.list.List(capnp.blob.Text));
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.Void)), [undefined, undefined, undefined]);
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.bool)); });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint8_t)); });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint16_t)) });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint32_t)); });
    assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint64_t)); });
    capnp.test.util.checkStrList(root.getObjectField(capnp.list.List(capnp.blob.Text)), ["foo", "bar", "baz"]);

    capnp.test.util.checkStrList(orig, ["foo", "bar", "baz"]);
    checkUpgradedList(root, [[0,0], [0,0], [0,0]], ["foo", "bar", "baz"]);
    capnp.test.util.checkStrList(orig, ["", "", ""]);  // old location zero'd during upgrade
  }

  // -----------------------------------------------------------------

  {
    {
      var l = root.initObjectField(capnp.list.List(test.TestOldVersion), 3);
      l.get(0).setOld1([0x12345678, 0x90abcdef]);
      l.get(1).setOld1([0x23456789, 0x0abcdef1]);
      l.get(2).setOld1([0x34567890, 0xabcdef12]);
      l.get(0).setOld2("foo");
      l.get(1).setOld2("bar");
      l.get(2).setOld2("baz");
    }
    var orig = root.asReader().getObjectField(capnp.list.List(test.TestOldVersion));

    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.Void)), [undefined, undefined, undefined]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.bool)), [true, true, false]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint8_t)), [0xef, 0xf1, 0x12]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint16_t)), [0xcdef, 0xdef1, 0xef12]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint32_t)), [0x90abcdef, 0x0abcdef1, 0xabcdef12]);
    capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint64_t)),
                              [[0x12345678, 0x90abcdef], [0x23456789, 0x0abcdef1], [0x34567890, 0xabcdef12]]);
    capnp.test.util.checkStrList(root.getObjectField(capnp.list.List(capnp.blob.Text)), ["foo", "bar", "baz"]);

    checkListDataPtr(orig, [[0x12345678, 0x90abcdef-0x100000000], [0x23456789, 0x0abcdef1], [0x34567890, 0xabcdef12-0x100000000]],
                     ["foo", "bar", "baz"]);
    checkUpgradedList(root, [[0x12345678, 0x90abcdef-0x100000000], [0x23456789, 0x0abcdef1], [0x34567890, 0xabcdef12-0x100000000]],
                      ["foo", "bar", "baz"]);
    checkListDataPtr(orig, [[0,0], [0,0], [0,0]], ["", "", ""]);  // old location zero'd during upgrade
  }

  // -----------------------------------------------------------------
  // OK, now we've tested upgrading every primitive list to every primitive list, every primitive
  // list to a multi-word struct, and a multi-word struct to every primitive list.  But we haven't
  // tried upgrading primitive lists to sub-word structs.

  // Upgrade from bool.
  root.setObjectField(capnp.list.List(capnp.prim.bool), [true, false, true, true]);
  {
    var orig = root.asReader().getObjectField(capnp.list.List(capnp.prim.bool));
    capnp.test.util.checkList(orig, [true, false, true, true]);
    var l = root.getObjectField(capnp.list.List(test.TestLists.Struct16));
    capnp.test.util.checkList(orig, [false, false, false, false]);  // old location zero'd during upgrade
    assertEquals(4, l.size());
    assertEquals(1, l.get(0).getF());
    assertEquals(0, l.get(1).getF());
    assertEquals(1, l.get(2).getF());
    assertEquals(1, l.get(3).getF());
    l.get(0).setF(12573);
    l.get(1).setF(3251);
    l.get(2).setF(9238);
    l.get(3).setF(5832);
  }
  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.bool)), [true, true, false, false]);
  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint16_t)), [12573, 3251, 9238, 5832]);
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint32_t)); });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint64_t)); });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.blob.Text)); });

  // Upgrade from multi-byte, sub-word data.
  root.setObjectField(capnp.list.List(capnp.prim.uint16_t), [12, 34, 56, 78]);
  {
    var orig = root.asReader().getObjectField(capnp.list.List(capnp.prim.uint16_t));
    capnp.test.util.checkList(orig, [12, 34, 56, 78]);
    var l = root.getObjectField(capnp.list.List(test.TestLists.Struct32));
    capnp.test.util.checkList(orig, [0, 0, 0, 0]);  // old location zero'd during upgrade
    assertEquals(4, l.size());
    assertEquals(12, l.get(0).getF());
    assertEquals(34, l.get(1).getF());
    assertEquals(56, l.get(2).getF());
    assertEquals(78, l.get(3).getF());
    l.get(0).setF(0x65ac1235);
    l.get(1).setF(0x13f12879);
    l.get(2).setF(0x33423082);
    l.get(3).setF(0x12988948);
  }
  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.bool)), [true, true, false, false]);
  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint8_t)), [0x35, 0x79, 0x82, 0x48]);
  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint16_t)), [0x1235, 0x2879, 0x3082, 0x8948]);
  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint32_t)),
                            [0x65ac1235, 0x13f12879, 0x33423082, 0x12988948]);
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint64_t)); });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.blob.Text)); });

  // Upgrade from void -> data struct
  root.setObjectField(capnp.list.List(capnp.prim.Void), [undefined, undefined, undefined, undefined]);
  {
    var l = root.getObjectField(capnp.list.List(test.TestLists.Struct16));
    assertEquals(4, l.size());
    assertEquals(0, l.get(0).getF());
    assertEquals(0, l.get(1).getF());
    assertEquals(0, l.get(2).getF());
    assertEquals(0, l.get(3).getF());
    l.get(0).setF(12573);
    l.get(1).setF(3251);
    l.get(2).setF(9238);
    l.get(3).setF(5832);
  }
  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.bool)), [true, true, false, false]);
  capnp.test.util.checkList(root.getObjectField(capnp.list.List(capnp.prim.uint16_t)), [12573, 3251, 9238, 5832]);
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint32_t)); });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint64_t)); });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.blob.Text)); });

  // Upgrade from void -> pointer struct
  root.setObjectField(capnp.list.List(capnp.prim.Void), [undefined, undefined, undefined, undefined]);
  {
    var l = root.getObjectField(capnp.list.List(test.TestLists.StructP));
    assertEquals(4, l.size());
    assertEquals("", l.get(0).getF().toString());
    assertEquals("", l.get(1).getF().toString());
    assertEquals("", l.get(2).getF().toString());
    assertEquals("", l.get(3).getF().toString());
    l.get(0).setF("foo");
    l.get(1).setF("bar");
    l.get(2).setF("baz");
    l.get(3).setF("qux");
  }
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.bool)); });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint16_t)); });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint32_t)); });
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.prim.uint64_t)); });
  capnp.test.util.checkStrList(root.getObjectField(capnp.list.List(capnp.blob.Text)), ["foo", "bar", "baz", "qux"]);

  // Verify that we cannot "side-grade" a pointer list to a data struct list, or a data list to
  // a pointer struct list.
  root.setObjectField(capnp.list.List(capnp.blob.Text), ["foo", "bar", "baz", "qux"]);
  assertThrows(function() { root.getObjectField(capnp.list.List(test.TestLists.Struct32)); });
  root.setObjectField(capnp.list.List(capnp.prim.uint32_t), [12, 34, 56, 78]);
  assertThrows(function() { root.getObjectField(capnp.list.List(capnp.blob.Text)); });
};

// =======================================================================================
// Tests of generated code, not really of the encoding.
// TODO(cleanup):  Move to a different test?

window['test_NestedTypes'] = function() {

  // This is more of a test of the generated code than the encoding.

  var builder = new capnp.message.MallocMessageBuilder();
  var reader = builder.getRoot(test.TestNestedTypes).asReader();

  assertEquals(test.TestNestedTypes.NestedEnum.BAR, reader.getOuterNestedEnum());
  assertEquals(test.TestNestedTypes.NestedStruct.NestedEnum.QUUX, reader.getInnerNestedEnum());

  var nested = reader.getNestedStruct();
  assertEquals(test.TestNestedTypes.NestedEnum.BAR, nested.getOuterNestedEnum());
  assertEquals(test.TestNestedTypes.NestedStruct.NestedEnum.QUUX, nested.getInnerNestedEnum());
};

window['test_Imports'] = function() {
  // Also just testing the generated code.
  {
    var builder = new capnp.message.MallocMessageBuilder();
    var root = builder.getRoot(capnproto_test.capnp.test_import.TestImport);
    capnp.test.util.initTestMessage(root.initField());
    capnp.test.util.checkTestMessage(root.asReader().getField());
  }

  {
    var builder = new capnp.message.MallocMessageBuilder();
    var root = builder.getRoot(capnproto_test.capnp.test_import2.TestImport2);
    capnp.test.util.initTestMessage(root.initFoo());
    capnp.test.util.checkTestMessage(root.asReader().getFoo());
    /* FIXME
       root.setBar(Schema.from(TestAllTypes).getProto());
       capnp.test.util.initTestMessage(root.initBaz().initField());
       capnp.test.util.checkTestMessage(root.asReader().getBaz().getField());
    */
  }
};

window['test_Using'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var reader = builder.getRoot(test.TestUsing).asReader();
  assertEquals(test.TestNestedTypes.NestedEnum.BAR, reader.getOuterNestedEnum());
  assertEquals(test.TestNestedTypes.NestedStruct.NestedEnum.QUUX, reader.getInnerNestedEnum());
};

window['test_StructSetters'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.getRoot(test.TestAllTypes);
  capnp.test.util.initTestMessage(root);

  {
    var builder2 = new capnp.message.MallocMessageBuilder();
    builder2.setRoot(root.asReader());
    capnp.test.util.checkTestMessage(builder2.getRoot(test.TestAllTypes));
  }

  {
    var builder2 = new capnp.message.MallocMessageBuilder();
    var root2 = builder2.getRoot(test.TestAllTypes);
    root2.setStructField(root.asReader());
    capnp.test.util.checkTestMessage(root2.getStructField());
  }

  {
    var builder2 = new capnp.message.MallocMessageBuilder();
    var root2 = builder2.getRoot(test.TestObject);
    root2.setObjectField(test.TestAllTypes, root.asReader());
    capnp.test.util.checkTestMessage(root2.getObjectField(test.TestAllTypes));
  }
};
