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

goog.provide('capnp.tests.packed');

goog.require('capnp.serialize');
goog.require('capnp.message');
goog.require('capnp.packed');
goog.require('capnp.test.util');
goog.require('kj.io');

goog.require('capnproto_test.capnp.test');

var repeat = function(pattern, count) {
  if (count < 1) return '';
  var result = '';
  while (count > 0) {
    if (count & 1) result += pattern;
    count >>= 1, pattern += pattern;
  }
  return result;
};

var bufferLength = function(buffer) {
  if (toString.call(buffer) == '[object Array]') {
    return buffer.length;
  }
  else {
    return buffer.byteLength;
  }
};

var equalBuffer = function(buffer1, buffer2) {
  var len1 = bufferLength(buffer1);
  var len2 = bufferLength(buffer2);

  if (len1 === len2) {
    for (var i=0; i<len1; ++i) {
      if (buffer1[i] !== buffer2[i]) {
        return false;
      }
    }
    return true;
  }
  else {
    return false;
  }
}

var DisplayByteArray = function(buffer) {

  var hexbytes = [];
  for (var i=0, len = bufferLength(buffer); i<len; i++) {
    var hex = Number(buffer[i]).toString(16);
    while (hex.length < 2) {
      hex = "0" + hex;
    }
    hexbytes.push(hex);
  }
  return "[ " + hexbytes.join(", ") + " ] (" + len + ")";
};

/**
 *  @constructor
 */
var TestPipe = function(preferredReadSize) {

  var self = this;

  if (preferredReadSize === undefined) {
    preferredReadSize = Number.MAX_VALUE;
  }

  this.preferredReadSize = preferredReadSize;
  this.readPos = 0;
  this.writePos = 0;
  this.data = new ArrayBuffer(10240);
  this.dataArray = new Uint8Array(this.data);

  this.getData = function() {
    return new Uint8Array(this.data.slice(0, this.writePos));
  };

  this.resetRead = function(preferredReadSize) {
    if (preferredReadSize === undefined) {
      preferredReadSize = Number.MAX_VALUE;
    }

    this.readPos = 0;
    this.readIndex = 0;
    this.preferredReadSize = preferredReadSize;
  }

  this.allRead = function() {
    return this.readPos === this.writePos;
  }

  this.clear = function(preferredReadSize) {
    if (preferredReadSize === undefined) {
      preferredReadSize = Number.MAX_VALUE;
    }
    this.resetRead(preferredReadSize);
    this.writePos = 0;
  }

  var OutputStream = function() {
    kj.io.OutputStream.call(this);
  };
  OutputStream.prototype = Object.create(kj.io.OutputStream.prototype);
  OutputStream.prototype.constructor = OutputStream
  OutputStream.prototype.write = function(buffer, offset, size) {
    assertTrue(offset + size <= buffer.byteLength);
    if (toString.call(buffer) == '[object ArrayBuffer]') {
      self.dataArray.set(new Uint8Array(buffer, offset, size), self.writePos);
    }
    else {
      self.dataArray.set(new Uint8Array(buffer.buffer, buffer.byteOffset + offset, size), self.writePos);
    }
    self.writePos += size;
  }

  var InputStream = function() {
    kj.io.BufferedInputStream.call(this);
  };
  InputStream.prototype = Object.create(kj.io.BufferedInputStream.prototype);
  InputStream.prototype.constructor = InputStream;
  InputStream.prototype.tryRead = function(buffer, offset, minBytes, maxBytes) {
    assertTrue("Overran end of stream.", maxBytes <= self.writePos - self.readPos);
    var amount = Math.min(maxBytes, Math.max(minBytes, preferredReadSize));
    new Uint8Array(buffer).set(self.dataArray.subarray(self.readPos, self.readPos + amount), offset);
    self.readPos += amount;
    return amount;
  }

  InputStream.prototype.skip = function(bytes) {
    assertTrue("Overran end of stream.", bytes <= self.writePos - self.readPos);
    self.readPos += bytes;
  }

  InputStream.prototype.tryGetReadBuffer = function() {
    var amount = Math.min(self.writePos - self.readPos, self.preferredReadSize);
    return new Uint8Array(self.data, self.readPos, amount);
  }

  this.outputStream = new OutputStream();
  this.inputStream = new InputStream();

  return this;
};

var expectPacksToWithReadSize = function(unpacked, packed, preferredReadSize) {

  var pipe = new TestPipe(preferredReadSize);

  // -----------------------------------------------------------------
  // write

  {
    var bufferedOut = new kj.io.BufferedOutputStreamWrapper(pipe.outputStream);
    var packedOut = new capnp.packed.PackedOutputStream(bufferedOut);
    packedOut.write(new Uint8Array(unpacked).buffer, 0, unpacked.length);
    bufferedOut.flush()
  }

  if (!equalBuffer(pipe.getData(), packed)) {
    fail("Tried to pack: " + DisplayByteArray(unpacked) + "\n" +
         "Expected:      " + DisplayByteArray(packed) + "\n" +
         "Actual:        " + DisplayByteArray(pipe.getData()));
  }


  // -----------------------------------------------------------------
  // read
  
  var roundTrip = new Uint8Array(unpacked);

  {
    var packedIn = new capnp.packed.PackedInputStream(pipe.inputStream);
    packedIn.read(roundTrip.buffer, 0, roundTrip.byteLength);
    assertTrue(pipe.allRead());
  }

  if (!equalBuffer(roundTrip, unpacked)) {
    fail("\n" +
         "Tried to unpack: " + DisplayByteArray(packed) + "\n" +
         "Expected:        " + DisplayByteArray(unpacked) + "\n" +
         "Actual:          " + DisplayByteArray(roundTrip));
  }

  for (var blockSize = 1; blockSize < packed.byteLength; blockSize <<= 1) {
    pipe.resetRead(blockSize);

    {
      var packedIn = new capnp.packed.PackedInputStream(pipe.inputStream);
      packedIn.read(roundTrip.buffer);
      assertTrue(pipe.allRead());
    }

    if (!equalBuffer(roundTrip, unpacked)) {
      fail("Tried to unpack: " + DisplayByteArray(packed) + "\n" +
           "  Block size: " + blockSize + "\n" +
           "Expected:        " + DisplayByteArray(unpacked) + "\n" +
           "Actual:          " + DisplayByteArray(roundTrip));
    }
  }

  // -----------------------------------------------------------------
  // skip

  pipe.resetRead();

  {
    var packedIn = new capnp.packed.PackedInputStream(pipe.inputStream);
    packedIn.skip(unpacked.length);
    assertTrue(pipe.allRead());
  }

  for (var blockSize = 1; blockSize < packed.byteLength; blockSize <<= 1) {
    pipe.resetRead(blockSize);

    {
      var packedIn = new capnp.packed.PackedInputStream(pipe.inputStream);
      packedIn.skip(unpacked.size());
      assertTrue(pipe.allRead());
    }
  }

  pipe.clear();

  // -----------------------------------------------------------------
  // write / read multiple

  {
    var bufferedOut = new kj.io.BufferedOutputStreamWrapper(pipe.outputStream);
    var packedOut = new capnp.packed.PackedOutputStream(bufferedOut);
    for (var i = 0; i < 5; i++) {
      packedOut.write(new Uint8Array(unpacked).buffer, 0, unpacked.length);
    }
    bufferedOut.flush()
  }

  for (var i = 0; i < 5; i++) {
    var packedIn = new capnp.packed.PackedInputStream(pipe.inputStream);
    packedIn.read(roundTrip, 0, roundTrip.byteLength);

    if (!equalBuffer(roundTrip, unpacked)) {
      fail("Tried to unpack: " + DisplayByteArray(packed) + "\n" +
           "  Index: " + i + "\n" +
           "Expected:        " + DisplayByteArray(unpacked) + "\n" +
           "Actual:          " + DisplayByteArray(roundTrip));
    }
  }
  assertTrue(pipe.allRead());
}

var expectPacksTo = function(unpacked, packed) {
  expectPacksToWithReadSize(unpacked, packed, undefined);
  expectPacksToWithReadSize(unpacked, packed, 1);
};

window['test_SimplePacking'] = function() {

  expectPacksTo([], []);
  expectPacksTo([0,0,0,0,0,0,0,0], [0,0]);
  expectPacksTo([0,0,12,0,0,34,0,0], [0x24,12,34]);
  expectPacksTo([1,3,2,4,5,7,6,8], [0xff,1,3,2,4,5,7,6,8,0]);
  expectPacksTo([0,0,0,0,0,0,0,0,1,3,2,4,5,7,6,8], [0,0,0xff,1,3,2,4,5,7,6,8,0]);
  expectPacksTo([0,0,12,0,0,34,0,0,1,3,2,4,5,7,6,8], [0x24,12,34,0xff,1,3,2,4,5,7,6,8,0]);
  expectPacksTo([1,3,2,4,5,7,6,8,8,6,7,4,5,2,3,1], [0xff,1,3,2,4,5,7,6,8,1,8,6,7,4,5,2,3,1]);

  expectPacksTo(
    [1,2,3,4,5,6,7,8, 1,2,3,4,5,6,7,8, 1,2,3,4,5,6,7,8, 1,2,3,4,5,6,7,8, 0,2,4,0,9,0,5,1],
    [0xff,1,2,3,4,5,6,7,8, 3, 1,2,3,4,5,6,7,8, 1,2,3,4,5,6,7,8, 1,2,3,4,5,6,7,8, 0xd6,2,4,9,5,1]);
  expectPacksTo(
    [1,2,3,4,5,6,7,8, 1,2,3,4,5,6,7,8, 6,2,4,3,9,0,5,1, 1,2,3,4,5,6,7,8, 0,2,4,0,9,0,5,1],
    [0xff,1,2,3,4,5,6,7,8, 3, 1,2,3,4,5,6,7,8, 6,2,4,3,9,0,5,1, 1,2,3,4,5,6,7,8, 0xd6,2,4,9,5,1]);

  expectPacksTo(
    [8,0,100,6,0,1,1,2, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,1,0,2,0,3,1],
    [0xed,8,100,6,1,1,2, 0,2, 0xd4,1,2,3,1]);
};

window['test_RoundTrip'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(1);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var pipe = new TestPipe();
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_RoundTripScratchSpace'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(1);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var pipe = new TestPipe();
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream, new ArrayBuffer(1024));
  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_RoundTripLazy'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(1);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var pipe = new TestPipe(1);
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_RoundTripOddSegmentCount'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(7);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var pipe = new TestPipe();
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_RoundTripOddSegmentCountLazy'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(7);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var pipe = new TestPipe(1);
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_RoundTripEvenSegmentCount'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(10);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var pipe = new TestPipe();
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_RoundTripEvenSegmentCountLazy'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(10);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var pipe = new TestPipe(1);
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
};

window['test_RoundTripTwoMessages'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(1);
  capnp.test.util.initTestMessage(builder.initRoot(test.TestAllTypes));

  var builder2 = new capnp.test.util.TestMessageBuilder(1);
  builder2.initRoot(test.TestAllTypes).setTextField("Second message.");

  var pipe = new TestPipe();
  capnp.packed.writePackedMessage(pipe.outputStream, builder);
  capnp.packed.writePackedMessage(pipe.outputStream, builder2);

  {
    var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
    capnp.test.util.checkTestMessage(reader.getRoot(test.TestAllTypes));
  }

  {
    var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
    assertEquals("Second message.", reader.getRoot(test.TestAllTypes).getTextField().toString());
  }
};

// =======================================================================================

window['test_RoundTripAllZero'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(1);
  builder.initRoot(test.TestAllTypes);

  var pipe = new TestPipe();
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  capnp.test.util.checkTestMessageAllZero(reader.getRoot(test.TestAllTypes));

  // Segment table packs to 2 bytes.
  // Root pointer packs to 3 bytes.
  // Content packs to 2 bytes (zero span).
  assertTrue(pipe.writePos <= 7);
};

window['test_RoundTripAllZeroScratchSpace'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(1);
  builder.initRoot(test.TestAllTypes);

  var pipe = new TestPipe();
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream, {}, new ArrayBuffer(1024));
  capnp.test.util.checkTestMessageAllZero(reader.getRoot(test.TestAllTypes));
};

window['test_RoundTripAllZeroLazy'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(1);
  builder.initRoot(test.TestAllTypes);

  var pipe = new TestPipe(1);
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  capnp.test.util.checkTestMessageAllZero(reader.getRoot(test.TestAllTypes));
};

window['test_RoundTripAllZeroOddSegmentCount'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(3);
  builder.initRoot(test.TestAllTypes);

  var pipe = new TestPipe();
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  capnp.test.util.checkTestMessageAllZero(reader.getRoot(test.TestAllTypes));
};

window['test_RoundTripAllZeroOddSegmentCountLazy'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(3);
  builder.initRoot(test.TestAllTypes);

  var pipe = new TestPipe(1);
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  capnp.test.util.checkTestMessageAllZero(reader.getRoot(test.TestAllTypes));
};

window['test_RoundTripAllZeroEvenSegmentCount'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(2);
  builder.initRoot(test.TestAllTypes);

  var pipe = new TestPipe();
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  capnp.test.util.checkTestMessageAllZero(reader.getRoot(test.TestAllTypes));
};

window['test_RoundTripAllZeroEvenSegmentCountLazy'] = function() {

  var builder = new capnp.test.util.TestMessageBuilder(2);
  builder.initRoot(test.TestAllTypes);

  var pipe = new TestPipe(1);
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  capnp.test.util.checkTestMessageAllZero(reader.getRoot(test.TestAllTypes));
};

// =======================================================================================

window['test_RoundTripHugeString'] = function() {

  var huge = repeat("x", 5023);

  var builder = new capnp.test.util.TestMessageBuilder(1);
  builder.initRoot(test.TestAllTypes).setTextField(huge);

  var pipe = new TestPipe();
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  assertEquals(reader.getRoot(test.TestAllTypes).getTextField().toString(), huge);
};

window['test_RoundTripHugeStringScratchSpace'] = function() {

  var huge = repeat("x", 5023);

  var builder = new capnp.test.util.TestMessageBuilder(1);
  builder.initRoot(test.TestAllTypes).setTextField(huge);

  var pipe = new TestPipe();;
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream, {}, new ArrayBuffer(1024));
  assertEquals(reader.getRoot(test.TestAllTypes).getTextField().toString(), huge);
};

window['test_RoundTripHugeStringLazy'] = function() {

  var huge = repeat("x", 5023);

  var builder = new capnp.test.util.TestMessageBuilder(1);
  builder.initRoot(test.TestAllTypes).setTextField(huge);

  var pipe = new TestPipe(1);
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  assertEquals(reader.getRoot(test.TestAllTypes).getTextField().toString(), huge);
};

window['test_RoundTripHugeStringOddSegmentCount'] = function() {

  var huge = repeat("x", 5023);

  var builder = new capnp.test.util.TestMessageBuilder(3);
  builder.initRoot(test.TestAllTypes).setTextField(huge);

  var pipe = new TestPipe();
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  assertEquals(reader.getRoot(test.TestAllTypes).getTextField().toString(), huge);
};

window['test_RoundTripHugeStringOddSegmentCountLazy'] = function() {

  var huge = repeat("x", 5023);

  var builder = new capnp.test.util.TestMessageBuilder(3);
  builder.initRoot(test.TestAllTypes).setTextField(huge);

  var pipe = new TestPipe(1);
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  assertEquals(reader.getRoot(test.TestAllTypes).getTextField().toString(), huge);
};

window['test_RoundTripHugeStringEvnSegmentCount'] = function() {

  var huge = repeat("x", 5023);

  var builder = new capnp.test.util.TestMessageBuilder(2);
  builder.initRoot(test.TestAllTypes).setTextField(huge);

  var pipe = new TestPipe();
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  assertEquals(reader.getRoot(test.TestAllTypes).getTextField().toString(), huge);
};

window['test_RoundTripHugeStringEvnSegmentCountLazy'] = function() {

  var huge = repeat("x", 5023);

  var builder = new capnp.test.util.TestMessageBuilder(2);
  builder.initRoot(test.TestAllTypes).setTextField(huge);

  var pipe = new TestPipe(1);
  capnp.packed.writePackedMessage(pipe.outputStream, builder);

  var reader = new capnp.packed.PackedMessageReader(pipe.inputStream);
  assertEquals(reader.getRoot(test.TestAllTypes).getTextField().toString(), huge);
};
