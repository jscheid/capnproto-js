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

goog.provide('capnp.tests.orphans');

goog.require('capnp.message');
goog.require('capnp.test.util');

goog.require('capnproto_test.capnp.test');


window['test_orphans_Structs'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  capnp.test.util.initTestMessage(root.initStructField());
  assertTrue(root.hasStructField());

  var orphan = root.disownStructField();
  assertNotNull(orphan);

  capnp.test.util.checkTestMessage(orphan.getReader());
  capnp.test.util.checkTestMessage(orphan.get());
  assertFalse(root.hasStructField());

  root.adoptStructField(orphan);
  assertTrue(orphan.isNull());
  assertTrue(root.hasStructField());
  capnp.test.util.checkTestMessage(root.asReader().getStructField());
};

window['test_orphans_Lists'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  root.setUInt32List([12, 34, 56]);
  assertTrue(root.hasUInt32List());

  var orphan = root.disownUInt32List();
  assertFalse(orphan === null);

  checkList(orphan.getReader(), [12, 34, 56]);
  checkList(orphan.get(), [12, 34, 56]);
  assertFalse(root.hasUInt32List());

  root.adoptUInt32List(orphan);
  assertTrue(orphan.isNull());
  assertTrue(root.hasUInt32List());
  checkList(root.asReader().getUInt32List(), [12, 34, 56]);
};

window['test_orphans_StructLists'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  var list = root.initStructList(2);
  list.get(0).setTextField("foo");
  list.get(1).setTextField("bar");
  assertTrue(root.hasStructList());

  var orphan = root.disownStructList();
  assertFalse(orphan.isNull());

  assertEquals(2, orphan.getReader().size());
  assertEquals("foo", orphan.getReader().get(0).getTextField().toString());
  assertEquals("bar", orphan.getReader().get(1).getTextField().toString());
  assertEquals(2, orphan.get().size());
  assertEquals("foo", orphan.get().get(0).getTextField().toString());
  assertEquals("bar", orphan.get().get(1).getTextField().toString());
  assertFalse(root.hasStructList());

  root.adoptStructList(orphan);
  assertTrue(orphan.isNull());
  assertTrue(root.hasStructList());
  assertEquals(2, root.asReader().getStructList().size());
  assertEquals("foo", root.asReader().getStructList().get(0).getTextField().toString());
  assertEquals("bar", root.asReader().getStructList().get(1).getTextField().toString());
}

window['test_orphans_Text'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  root.setTextField("foo");
  assertTrue(root.hasTextField());

  var orphan = root.disownTextField();
  assertFalse(orphan.isNull());

  assertEquals("foo", orphan.getReader().toString());
  assertEquals("foo", orphan.get().toString());
  assertFalse(root.hasTextField());

  root.adoptTextField(orphan);
  assertTrue(orphan.isNull());
  assertTrue(root.hasTextField());
  assertEquals("foo", root.getTextField().toString());
}

window['test_orphans_Data'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  root.setDataField(capnp.test.util.data("foo"));
  assertTrue(root.hasDataField());

  var orphan = root.disownDataField();
  assertFalse(orphan.isNull());

  assertTrue(capnp.test.util.data("foo").equals(orphan.getReader()));
  assertTrue(capnp.test.util.data("foo").equals(orphan.get()));
  assertFalse(root.hasDataField());

  root.adoptDataField(orphan);
  assertTrue(orphan.isNull());
  assertTrue(root.hasDataField());
  assertTrue(capnp.test.util.data("foo").equals(root.getDataField()));
}

window['test_orphans_NoCrossMessageTransfers'] = function() {

  var builder1 = new capnp.message.MallocMessageBuilder();
  var builder2 = new capnp.message.MallocMessageBuilder();
  var root1 = builder1.initRoot(test.TestAllTypes);
  var root2 = builder2.initRoot(test.TestAllTypes);

  capnp.test.util.initTestMessage(root1.initStructField());

  assertThrows(function() { root2.adoptStructField(root1.disownStructField()); });
}

window['test_orphans_OrphanageStruct'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();

  var orphan = builder.getOrphanage().newOrphan(test.TestAllTypes);
  capnp.test.util.initTestMessage(orphan.get());
  capnp.test.util.checkTestMessage(orphan.getReader());

  var root = builder.initRoot(test.TestAllTypes);
  root.adoptStructField(orphan);
}

window['test_orphans_OrphanageList'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();

  var orphan = builder.getOrphanage().newOrphan(capnp.list.ListOfPrimitives(capnp.prim.int32_t), 2);
  orphan.get().set(0, 123);
  orphan.get().set(1, 456);

  var reader = orphan.getReader();
  assertEquals(2, reader.size());
  assertEquals(123, reader.get(0));
  assertEquals(456, reader.get(1));

  var root = builder.initRoot(test.TestAllTypes);
  root.adoptUInt32List(orphan);
}

window['test_orphans_OrphanageText'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();

  var orphan = builder.getOrphanage().newOrphan(capnp.blob.Text, 8);
  assertEquals(8, orphan.get().size());
  orphan.get().asUint8Array().set(new capnp.blob.StringTextReader("12345678").asUint8Array());

  var root = builder.initRoot(test.TestAllTypes);
  root.adoptTextField(orphan);
  assertEquals("12345678", root.getTextField().toString());
}


window['test_orphans_OrphanageData'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();

  var orphan = builder.getOrphanage().newOrphan(capnp.blob.Data, 2);
  assertEquals(2, orphan.get().size());
  orphan.get().asUint8Array()[0] = 123;
  orphan.get().asUint8Array()[1] = 45;

  var root = builder.initRoot(test.TestAllTypes);
  root.adoptDataField(orphan);
  assertEquals(2, root.getDataField().size());
  assertEquals(123, root.getDataField().asUint8Array()[0]);
  assertEquals(45, root.getDataField().asUint8Array()[1]);
}

window['test_orphans_OrphanageStructCopy'] = function() {
  var builder1 = new capnp.message.MallocMessageBuilder();
  var builder2 = new capnp.message.MallocMessageBuilder();

  var root1 = builder1.initRoot(test.TestAllTypes);
  capnp.test.util.initTestMessage(root1);

  var orphan = builder2.getOrphanage().newOrphanCopy(root1.asReader());
  capnp.test.util.checkTestMessage(orphan.getReader());

  var root2 = builder2.initRoot(test.TestAllTypes);
  root2.adoptStructField(orphan);
}


window['test_orphans_OrphanageListCopy'] = function() {
  var builder1 = new capnp.message.MallocMessageBuilder();
  var builder2 = new capnp.message.MallocMessageBuilder();

  var root1 = builder1.initRoot(test.TestAllTypes);
  root1.setUInt32List([12, 34, 56]);

  var orphan = builder2.getOrphanage().newOrphanCopy(
      root1.asReader().getUInt32List());
  capnp.test.util.checkList(orphan.getReader(), [12, 34, 56]);

  var root2 = builder2.initRoot(test.TestAllTypes);
  root2.adoptUInt32List(orphan);
}

window['test_orphans_OrphanageTextCopy'] = function() {
  var builder = new capnp.message.MallocMessageBuilder();

  var orphan = builder.getOrphanage().newOrphanCopy(new capnp.blob.StringTextReader("foobarba"));
  assertEquals("foobarba", orphan.getReader().toString());

  var root = builder.initRoot(test.TestAllTypes);
  root.adoptTextField(orphan);
}

window['test_orphans_OrphanageDataCopy'] = function() {
  var builder = new capnp.message.MallocMessageBuilder();

  var orphan = builder.getOrphanage().newOrphanCopy(capnp.test.util.data("foo"));
  assertTrue(capnp.test.util.data("foo").equals(orphan.getReader()));

  var root = builder.initRoot(test.TestAllTypes);
  root.adoptDataField(orphan);
}

window['test_orphans_ZeroOut'] = function() {
  var builder = new capnp.message.MallocMessageBuilder();

  var orphan = builder.getOrphanage().newOrphan(test.TestAllTypes);
  var orphanReader = orphan.getReader();
  capnp.test.util.initTestMessage(orphan.get());
  capnp.test.util.checkTestMessage(orphan.getReader());
  orphan.destroy();

  // Once the Orphan destructor is called, the message should be zero'd out.
  capnp.test.util.checkTestMessageAllZero(orphanReader);
}

/*
window['test_orphans_StructObject'] = function() {
  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestObject);

  capnp.test.util.initTestMessage(root.ObjectField(test.TestAllTypes).initAs(test.TestAllTypes));
  assertTrue(root.hasObjectField());

  var orphan = root.getObjectField().disownAs(test.TestAllTypes);
  assertFalse(orphan.isNull());

  capnp.test.util.checkTestMessage(orphan.getReader());
  assertFalse(root.hasObjectField());

  root.getObjectField().adopt(orphan);
  assertTrue(orphan.isNull());
  assertTrue(root.hasObjectField());
  capnp.test.util.checkTestMessage(root.asReader().getObjectField().getAs(test.TestAllTypes));
}

window['test_orphans_ListObject'] = function() {
  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestObject);

  root.getObjectField().setAs(capnp.list.ListOfPrimitives(capnp.prim.uint32_t), [12, 34, 56]);
  assertTrue(root.hasObjectField());

  var orphan = root.getObjectField().disownAs(capnp.list.ListOfPrimitives(capnp.prim.uint32_t));
  assertFalse(orphan.isNull());

  capnp.test.util.genericCheckList(orphan.getReader(), [12, 34, 56]);
  assertFalse(root.hasObjectField());

  root.getObjectField().adopt(orphan);
  assertTrue(orphan.isNull());
  assertNull(root.hasObjectField());
  capnp.test.util.genericCheckList(root.asReader().getObjectField().getAs(capnp.list.ListOfPrimitives(capnp.prim.uint32_t)), [12, 34, 56]);
}
*/

function allZero(dataView, begin, end) {
  for (var pos=begin; pos<end; ++pos) {
    if (dataView.getUint8(pos) != 0) return false;
  }
  return true;
};

window['test_orphans_StructsZerodAfterUse'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  var zerosStart = builder.getSegmentsForOutput()[0].byteLength;
  capnp.test.util.initTestMessage(root.initStructField());
  var zerosEnd = builder.getSegmentsForOutput()[0].byteLength;

  root.setTextField("foo");  // guard against overruns

  assertEquals(1, builder.getSegmentsForOutput().length);  // otherwise test is invalid

  root.disownStructField().destroy();

  assertTrue(allZero(builder.getSegmentsForOutput()[0], zerosStart, zerosEnd));

  assertEquals("foo", root.getTextField().toString());
};

window['test_orphans_ListsZerodAfterUse'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  var zerosStart = builder.getSegmentsForOutput()[0].byteLength;
  root.setUInt32List([12, 34, 56]);
  var zerosEnd = builder.getSegmentsForOutput()[0].byteLength;

  root.setTextField("foo");  // guard against overruns

  assertEquals(1, builder.getSegmentsForOutput().length);  // otherwise test is invalid

  root.disownUInt32List().destroy();

  assertTrue(allZero(builder.getSegmentsForOutput()[0], zerosStart, zerosEnd));

  assertEquals("foo", root.getTextField().toString());
}

window['test_orphans_EmptyListsZerodAfterUse'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  var zerosStart = builder.getSegmentsForOutput()[0].byteLength;
  root.initUInt32List(0);
  var zerosEnd = builder.getSegmentsForOutput()[0].byteLength;

  root.setTextField("foo");  // guard against overruns

  assertEquals(1, builder.getSegmentsForOutput().length);  // otherwise test is invalid

  root.disownUInt32List().destroy();

  assertTrue(allZero(builder.getSegmentsForOutput()[0], zerosStart, zerosEnd));

  assertEquals("foo", root.getTextField().toString());
}

window['test_orphans_StructListsZerodAfterUse'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  var zerosStart = builder.getSegmentsForOutput()[0].byteLength;
  {
    var list = root.initStructList(2);
    capnp.test.util.initTestMessage(list.get(0));
    capnp.test.util.initTestMessage(list.get(1));
  }
  var zerosEnd = builder.getSegmentsForOutput()[0].byteLength;

  root.setTextField("foo");  // guard against overruns

  assertEquals(1, builder.getSegmentsForOutput().length);  // otherwise test is invalid

  root.disownStructList().destroy();

  assertTrue(allZero(builder.getSegmentsForOutput()[0], zerosStart, zerosEnd));

  assertEquals("foo", root.getTextField().toString());
};

window['test_orphans_EmptyStructListsZerodAfterUse'] = function() {
  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  var zerosStart = builder.getSegmentsForOutput()[0].byteLength;
  root.initStructList(0);
  var zerosEnd = builder.getSegmentsForOutput()[0].byteLength;

  root.setTextField("foo");  // guard against overruns

  assertEquals(1, builder.getSegmentsForOutput().length);  // otherwise test is invalid

  root.disownStructList().destroy();

  assertTrue(allZero(builder.getSegmentsForOutput()[0], zerosStart, zerosEnd));

  assertEquals("foo", root.getTextField().toString());
}

window['test_orphans_TextZerodAfterUse'] = function() {
  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  var zerosStart = builder.getSegmentsForOutput()[0].byteLength;
  root.setTextField("abcd123");
  var zerosEnd = builder.getSegmentsForOutput()[0].byteLength;

  root.setDataField(capnp.test.util.data("foo"));  // guard against overruns

  assertEquals(1, builder.getSegmentsForOutput().length);  // otherwise test is invalid

  root.disownTextField().destroy();

  assertTrue(allZero(builder.getSegmentsForOutput()[0], zerosStart, zerosEnd));

  assertTrue(capnp.test.util.data("foo").equals(root.getDataField()));
}

window['test_orphans_DataZerodAfterUse'] = function() {
  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  var zerosStart = builder.getSegmentsForOutput()[0].byteLength;
  root.setDataField(capnp.test.util.data("abcd123"));
  var zerosEnd = builder.getSegmentsForOutput()[0].byteLength;

  root.setTextField("foo");  // guard against overruns

  assertEquals(1, builder.getSegmentsForOutput().length);  // otherwise test is invalid

  root.disownDataField().destroy();

  assertTrue(allZero(builder.getSegmentsForOutput()[0], zerosStart, zerosEnd));

  assertEquals("foo", root.getTextField().toString());
}

window['test_orphans_FarPointer'] = function() {
  var builder = new capnp.message.MallocMessageBuilder(0, capnp.message.AllocationStrategy.FIXED_SIZE);
  var root = builder.initRoot(test.TestAllTypes);
  var child = root.initStructField();
  capnp.test.util.initTestMessage(child);

  var orphan = root.disownStructField();
  assertFalse(root.hasStructField());
  assertFalse(orphan.isNull());

  capnp.test.util.checkTestMessage(orphan.getReader());
  capnp.test.util.checkTestMessage(orphan.get());
}

window['test_orphans_DisownNull'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  {
    var orphan = root.disownStructField();
    assertTrue(orphan.isNull());

    capnp.test.util.checkTestMessageAllZero(orphan.getReader());
    assertTrue(orphan.isNull());

    // get()ing the orphan allocates an object, for security reasons.
    capnp.test.util.checkTestMessageAllZero(orphan.get());
    assertFalse(orphan.isNull());
  }

  {
    var orphan = root.disownInt32List();
    assertTrue(orphan.isNull());

    assertEquals(0, orphan.getReader().size());
    assertTrue(orphan.isNull());

    assertEquals(0, orphan.get().size());
    assertTrue(orphan.isNull());
  }

  {
    var orphan = root.disownStructList();
    assertTrue(orphan.isNull());

    assertEquals(0, orphan.getReader().size());
    assertTrue(orphan.isNull());

    assertEquals(0, orphan.get().size());
    assertTrue(orphan.isNull());
  }
}
