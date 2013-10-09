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

goog.provide('capnp.tests.serialize');

goog.require('capnp.serialize');
goog.require('capnp.message');
goog.require('capnp.test.util');
goog.require('kj.io');

goog.require('capnproto_test.capnp.test');

/**
 *  @constructor
 */
var TestInputStream = function(data, lazy) {
  kj.io.InputStream.call(this);

  this.pos = 0;
  this.end = data.byteLength;
  this.data = data;
  this.lazy = lazy;
};

TestInputStream.prototype = Object.create(kj.io.InputStream.prototype);
TestInputStream.prototype.constructor = TestInputStream;
TestInputStream.prototype.tryRead = function(buffer, offset, minBytes, maxBytes) {
  assertTrue("Overran end of stream.", maxBytes <= (this.end - this.pos));
  var amount = this.lazy ? minBytes : maxBytes;
  new Uint8Array(buffer, offset).set(new Uint8Array(this.data, this.pos, amount));
  this.pos += amount;
  return amount;
};

/**
 *  @constructor
 */
var TestOutputStream = function(buffer, size) {

  var arrays = [];
  this.byteLength = 0;

  this.write = function(buffer, fromOfs, size) {
    assertTrue("Buffer underrun", fromOfs + size <= buffer.byteLength);
    if (size > 0) {
      arrays.push(buffer.slice(fromOfs, fromOfs + size));
    }
    this.byteLength += size;
  }

  this.getData = function() {
    var totalLength = 0;
    for (var i=0, len=arrays.length; i<len; ++i) {
      totalLength += arrays[i].byteLength;
    }
    var out = new Uint8Array(totalLength);
    var offset = 0;
    for (var i=0, len=arrays.length; i<len; ++i) {
      out.set(new Uint8Array(arrays[i]), offset);
      offset += arrays[i].byteLength;
    }
    assertEquals(offset, totalLength);
    return out.buffer;
  }

  this.dataEquals = function(other) {
    var ofs = 0;
    for (var i=0, len=arrays.length; i<len; ++i) {
      if (ofs >= other.byteLength) {
        return false;
      }
      var arr1 = arrays[i];
      var arr2 = other.slice(ofs, ofs + arr1.byteLength);
      if (arr1.byteLength != arr2.byteLength) {
        return false;
      }
      for (var j=0, jlen=arr1.byteLength; j<jlen; j++) {
        if (arr1[j] != arr2[j]) {
          return false;
        }
      }
      ofs += arr1.byteLength;
    }
    return true;
  }
};

window['test_FlatArray'] = function() {
  
  var builder = new capnp.test.util.TestMessageBuilder(1);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var reader = new capnp.message.FlatArrayMessageReader(serialized);
  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_FlatArrayOddSegmentCount'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(7);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var reader = new capnp.message.FlatArrayMessageReader(serialized);
  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_FlatArrayEvenSegmentCount'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(10);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var reader = new capnp.message.FlatArrayMessageReader(serialized);
  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_InputStream'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(1);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var stream = new TestInputStream(serialized, false);
  var reader = new capnp.serialize.InputStreamMessageReader(stream);

  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_InputStreamScratchSpace'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(1);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var scratch = new ArrayBuffer(4096 * 8);
  var stream = new TestInputStream(serialized, false);
  var reader = new capnp.serialize.InputStreamMessageReader(stream, {}, scratch);

  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_InputStreamLazy'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(1);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var stream = new TestInputStream(serialized, true);
  var reader = new capnp.serialize.InputStreamMessageReader(stream);

  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_InputStreamOddSegmentCount'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(7);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var stream = new TestInputStream(serialized, false);
  var reader = new capnp.serialize.InputStreamMessageReader(stream);

  capnp.trace = true;
  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_InputStreamOddSegmentCountLazy'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(7);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var stream = new TestInputStream(serialized, true);
  var reader = new capnp.serialize.InputStreamMessageReader(stream);

  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_InputStreamEvenSegmentCount'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(10);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var stream = new TestInputStream(serialized, false);
  var reader = new capnp.serialize.InputStreamMessageReader(stream);

  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_InputStreamEvenSegmentCountLazy'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(10);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var stream = new TestInputStream(serialized, true);
  var reader = new capnp.serialize.InputStreamMessageReader(stream);

  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_WriteMessage'] = function() {
  var builder = new capnp.test.util.TestMessageBuilder(1);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var output = new TestOutputStream();
  capnp.serialize.writeMessageSegments(output, builder.getSegmentsForOutput());

  assertTrue(output.dataEquals(serialized));
};

window['test_WriteMessageOddSegmentCount'] = function() {
  var builder = new capnp.test.util.TestMessageBuilder(7);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var output = new TestOutputStream();
  capnp.serialize.writeMessageSegments(output, builder.getSegmentsForOutput());

  assertTrue(output.dataEquals(serialized));
};

window['test_WriteMessageEvenSegmentCount'] = function() {
  var builder = new capnp.test.util.TestMessageBuilder(10);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var serialized = capnp.serialize.messageToFlatArray(builder.getSegmentsForOutput());

  var output = new TestOutputStream();
  capnp.serialize.writeMessageSegments(output, builder.getSegmentsForOutput());

  var buf1 = new DataView(serialized);
  var buf2 = new DataView(output.getData());

  assertTrue(output.dataEquals(serialized));
};

var isNode = 
  typeof global !== "undefined" && 
  {}.toString.call(global) == '[object global]';

if (isNode) {
  window['test_FileDescriptors'] = function() {
    
    var fs = require('fs');

    var filename = "/tmp/capnproto-serialize-test-XXXXXX";

    try {
      var tmpfile = fs.openSync(filename, "w");
      try {
        {
          var builder = new capnp.test.util.TestMessageBuilder(7);
          capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));
          capnp.writeMessageToFd(tmpfile, builder.getSegmentsForOutput());
        }

        {
          var builder = new capnp.test.util.TestMessageBuilder(1);
          builder.initRoot(test.TestAllTypes).setTextField("second message in file");
          capnp.writeMessageToFd(tmpfile, builder.getSegmentsForOutput());
        }
      }
      finally {
        fs.closeSync(tmpfile);
      }

      var tmpfile = fs.openSync(filename, "r");
      try {
        {
          var reader = new capnp.StreamFdMessageReader(tmpfile);
          capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
        }

        {
          var reader = new capnp.StreamFdMessageReader(tmpfile);
          assertEquals("second message in file", reader.getRoot(test.TestAllTypes).getTextField());
        }
      }
      finally {
        fs.closeSync(tmpfile);
      }
    }
    finally {
      fs.unlink(filename);
    }
  };
}

window['test_RejectTooManySegments'] = function() {

  var data = new ArrayBuffer(8192 * 8);
  var table = new Uint32Array(data);
  table[0] = 1024;
  for (var i = 0; i < 1024; i++) {
    table[i+1] = 1;
  }
  var input = new TestInputStream(data, false);

  assertThrows(function() { new kj.io.InputStreamMessageReader(input); });
};

window['test_RejectHuge'] = function() {

  // A message whose root struct contains two words of data!
  var data= new ArrayBuffer(32);
  data[4] = 3;
  data[12] = 2;

  var input = new TestInputStream(data, false);

  // We'll set the traversal limit to 2 words so our 3-word message is too big.
  var options = { traversalLimitInWords: 2 };

  assertThrows(function() { new kj.io.InputStreamMessageReader(input, options); });
};
