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

goog.provide('capnp.tests.stringify');

goog.require('capnp.message');
goog.require('capnp.test.util');

goog.require('capnproto_test.capnp.test');


window['test_stringify_KjStringification'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestAllTypes);

  assertEquals("()", root.toString());

  capnp.test.util.initTestMessage(root);        
};

window['test_stringify_Unions'] = function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestUnion);

  root.getUnion0().setU0f0s16(123);
  root.getUnion1().setU1f0sp("foo");
  root.getUnion2().setU2f0s1(true);
  root.getUnion3().setU3f0s64(123456789012345678);

  /** FIXME
      assertEquals("(" +
      "union0 = (u0f0s16 = 123), " +
      "union1 = (u1f0sp = \"foo\"), " +
      "union2 = (u2f0s1 = true), " +
      "union3 = (u3f0s64 = 123456789012345678))",
      root.toString());

      assertEquals("(u0f0s16 = 123)", root.getUnion0().toString());
      assertEquals("(u1f0sp = \"foo\")", root.getUnion1().toString());
      assertEquals("(u2f0s1 = true)", root.getUnion2().toString());
      assertEquals("(u3f0s64 = 123456789012345678)", root.getUnion3().toString());
  **/
};

window['test_stringify_UnionDefaults'] =function() {

  var builder = new capnp.message.MallocMessageBuilder();
  var root = builder.initRoot(test.TestUnion);

  root.getUnion0().setU0f0s16(0);     // Non-default field has default value.
  root.getUnion1().setU1f0sp("foo");  // Non-default field has non-default value.
  root.getUnion2().setU2f0s1(false);  // Default field has default value.
  root.getUnion3().setU3f0s1(true);   // Default field has non-default value.

  assertEquals("(" +
               "union0 = (u0f0s16 = 0), " +
               "union1 = (u1f0sp = \"foo\"), " +
               "union3 = (u3f0s1 = true))",
               root.toString());

  assertEquals("(u0f0s16 = 0)", root.getUnion0().toString());
  assertEquals("(u1f0sp = \"foo\")", root.getUnion1().toString());
  assertEquals("()", root.getUnion2().toString());
  assertEquals("(u3f0s1 = true)", root.getUnion3().toString());
};
