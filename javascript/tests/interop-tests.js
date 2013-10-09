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

function assertMessageDeserializesTo(message, capnpType, deserializedString, done) {
  var command = process.env.CAPNP + ' decode --short ' + process.env.CAPNP_SOURCE + '/src/capnp/test.capnp ' + capnpType;
  var child = exec(
    command,
    function(error, stdout, stderr) {
      assert.ok(error === null);
      assert.equal(stdout, deserializedString);
      done();
    });
  capnp.writeMessageToFd(child.stdin._handle.fd, message);
  child.stdin.end();
}

function withMessageFromString(capnpType, deserializedString, callback) {
  var command = process.env.CAPNP + ' encode ' + process.env.CAPNP_SOURCE + '/src/capnp/test.capnp ' + capnpType;
  var child = exec(
    command,
    function(error, stdout, stderr) {
      assert.ok(error === null);
      var message = new capnp.NodeJsBufferMessageReader(new Buffer(stdout));
      callback(message)
    });
  child.stdin.write(deserializedString);
  child.stdin.end();
}


describe('Interop', function() {

  it('should build a message correctly', function(done) {
    var message = new capnp.MallocMessageBuilder();
    var testOutOfOrder = message.initRoot(test.TestOutOfOrder);

    testOutOfOrder.setFoo('foo');
    testOutOfOrder.setWaldo('waldo');
    testOutOfOrder.setGrault('grault');
    testOutOfOrder.setQuux('quux');
    testOutOfOrder.setCorge('corge');
    testOutOfOrder.setBaz('baz');
    testOutOfOrder.setBar('bar');
    testOutOfOrder.setQux('qux');
    testOutOfOrder.setGarply('garply');

    assertMessageDeserializesTo(
      message, 'TestOutOfOrder',
      '(qux = "qux", grault = "grault", bar = "bar", foo = "foo", corge = "corge", waldo = "waldo", quux = "quux", garply = "garply", baz = "baz")\n',
      done);
  }),

  it('should parse a message correctly', function(done) {
    withMessageFromString(
      'TestOutOfOrder',
      '(qux = "qux", grault = "grault", bar = "bar", foo = "foo", corge = "corge", waldo = "waldo", quux = "quux", garply = "garply", baz = "baz")\n',
      function (message) {
        var testOutOfOrder = message.getRoot(test.TestOutOfOrder);
        assert.equal(testOutOfOrder.getWaldo(), 'waldo');
        assert.equal(testOutOfOrder.getFoo(), 'foo');
        assert.equal(testOutOfOrder.getGrault(), 'grault');
        assert.equal(testOutOfOrder.getBar(), 'bar');
        assert.equal(testOutOfOrder.getGarply(), 'garply');
        assert.equal(testOutOfOrder.getBaz(), 'baz');
        assert.equal(testOutOfOrder.getQuux(), 'quux');
        assert.equal(testOutOfOrder.getQux(), 'qux');
        done();
      });
  }),

  it('should build a message correctly', function(done) {
    var message = new capnp.MallocMessageBuilder();
    var testDefaults = message.initRoot(test.TestDefaults);

    testDefaults.setVoidField();
    testDefaults.setBoolField(false);
    testDefaults.setInt8Field(100);
    testDefaults.setInt16Field(10000);
    testDefaults.setInt32Field(1000000);
    //testDefaults.setInt64Field([ 1000000, 1000000 ]);

    assertMessageDeserializesTo(
      message, 'TestDefaults',
      '(boolField = false, int8Field = 100, int16Field = 10000, int32Field = 1000000)\n',
      done);
  });
});
