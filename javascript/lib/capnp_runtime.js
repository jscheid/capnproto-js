/**
 * @license Copyright (c) 2013, Julian Scheid <julians37@gmail.com>
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

goog.provide('capnp.runtime');

goog.require('kj.io.InputStream');
goog.require('kj.io.BufferedInputStream');

goog.require('capnp.arena');
goog.require('capnp.blob');
goog.require('capnp.genhelper');
goog.require('capnp.layout');
goog.require('capnp.list');
goog.require('capnp.message');
goog.require('capnp.packed');
goog.require('capnp.serialize');

(function (exports) {

  "use strict";

  exports['OutputStream'] = kj.io.OutputStream;
  exports['InputStream'] = kj.io.InputStream;
  exports['BufferedInputStream'] = kj.io.BufferedInputStream;
  exports['BufferedOutputStream'] = kj.io.BufferedOutputStream;
  exports['BufferedOutputStreamWrapper'] = kj.io.BufferedOutputStreamWrapper;

  exports['bool']      = capnp.prim.bool;
  exports['int8_t']    = capnp.prim.int8_t;
  exports['int16_t']   = capnp.prim.int16_t;
  exports['int32_t']   = capnp.prim.int32_t;
  exports['int64_t']   = capnp.prim.int64_t;
  exports['uint8_t']   = capnp.prim.uint8_t;
  exports['uint16_t']  = capnp.prim.uint16_t;
  exports['uint32_t']  = capnp.prim.uint32_t;
  exports['uint64_t']  = capnp.prim.uint64_t;
  exports['float32_t'] = capnp.prim.float32_t;
  exports['float64_t'] = capnp.prim.float64_t;
  exports['Void']      = capnp.prim.Void;
  exports['asUint64Val'] = capnp.prim.asUint64Val;
  exports['asInt64Val'] = capnp.prim.asUint64Val;

  exports['List'] = capnp.list.List;
  exports['ListOfPrimitives'] = capnp.list.ListOfPrimitives;
  exports['ListOfEnums'] = capnp.list.ListOfEnums;
  exports['ListOfLists'] = capnp.list.ListOfLists;
  exports['ListOfBlobs'] = capnp.list.ListOfBlobs;
  exports['ListOfStructs'] = capnp.list.ListOfStructs;
  
  exports['textBlobSet'] = capnp.genhelper.textBlobSet;
  exports['dataBlobSet'] = capnp.genhelper.dataBlobSet;

  exports['writeMessageToFd'] = capnp.serialize.writeMessageToFd;

  exports['MessageReader'] = capnp.message.MessageReader;
  exports['SegmentArrayMessageReader'] = capnp.message.SegmentArrayMessageReader;
  exports['FlatArrayMessageReader'] = capnp.message.FlatArrayMessageReader;
  exports['MessageBuilder'] = capnp.message.MessageBuilder;
  exports['AllocationStrategy'] = capnp.message.AllocationStrategy;
  exports['readMessageUnchecked'] = capnp.message.readMessageUnchecked;
  exports['SUGGESTED_FIRST_SEGMENT_WORDS'] = capnp.message.SUGGESTED_FIRST_SEGMENT_WORDS;

  exports['ToStringHelper'] = capnp.genhelper.ToStringHelper;
  exports['listInit'] = capnp.genhelper.listInit;
  exports['listSet'] = capnp.genhelper.listSet;
  exports['structSet'] = capnp.genhelper.structSet;
  exports['objectInit'] = capnp.genhelper.objectInit;
  exports['objectSet'] = capnp.genhelper.objectSet;
  exports['objectGetFromBuilder'] = capnp.genhelper.objectGetFromBuilder;
  exports['objectGetFromReader'] = capnp.genhelper.objectGetFromReader;
  exports['ConstText'] = capnp.genhelper.ConstText;
  exports['ConstData'] = capnp.genhelper.ConstData;
  exports['ConstStruct'] = capnp.genhelper.ConstStruct;
  exports['ConstList'] = capnp.genhelper.ConstList;
  exports['NullStructReader'] = capnp.genhelper.NullStructReader;

  exports['StructSize'] = capnp.layout.StructSize;
  exports['StructReader'] = capnp.layout.StructReader;
  exports['StructBuilder'] = capnp.layout.StructBuilder;

  exports['BuilderArena'] = capnp.arena.BuilderArena;

  exports['NodeJsBufferMessageReader'] = capnp.serialize.NodeJsBufferMessageReader;
  exports['StreamFdMessageReader'] = capnp.serialize.StreamFdMessageReader;
  exports['writeMessageSegments'] = capnp.serialize.writeMessageSegments;
  exports['messageToFlatArray'] = capnp.serialize.messageToFlatArray;
  exports['InputStreamMessageReader'] = capnp.serialize.InputStreamMessageReader;

  exports['PackedInputStream'] = capnp.packed.PackedInputStream;
  exports['PackedOutputStream'] = capnp.packed.PackedOutputStream;
  exports['PackedMessageReader'] = capnp.packed.PackedMessageReader;
  exports['writePackedMessage'] = capnp.packed.writePackedMessage;


  goog.exportSymbol('MallocMessageBuilder', capnp.message.MallocMessageBuilder, exports);
  goog.exportSymbol('MallocMessageBuilder.prototype.initRoot', capnp.message.MallocMessageBuilder.prototype.initRoot, exports);

  goog.exportSymbol('StructBuilder', capnp.layout.StructBuilder, exports);
  goog.exportSymbol('StructBuilder.prototype.setDataField_bool', capnp.layout.StructBuilder.prototype.setDataField_bool, exports);
  goog.exportSymbol('StructBuilder.prototype.setDataField_int8', capnp.layout.StructBuilder.prototype.setDataField_int8, exports);
  goog.exportSymbol('StructBuilder.prototype.setDataField_int16', capnp.layout.StructBuilder.prototype.setDataField_int16, exports);
  goog.exportSymbol('StructBuilder.prototype.setDataField_int32', capnp.layout.StructBuilder.prototype.setDataField_int32, exports);
  goog.exportSymbol('StructBuilder.prototype.setDataField_int64', capnp.layout.StructBuilder.prototype.setDataField_int64, exports);
  goog.exportSymbol('StructBuilder.prototype.setDataField_uint8', capnp.layout.StructBuilder.prototype.setDataField_uint8, exports);
  goog.exportSymbol('StructBuilder.prototype.setDataField_uint16', capnp.layout.StructBuilder.prototype.setDataField_uint16, exports);
  goog.exportSymbol('StructBuilder.prototype.setDataField_uint32', capnp.layout.StructBuilder.prototype.setDataField_uint32, exports);
  goog.exportSymbol('StructBuilder.prototype.setDataField_uint64', capnp.layout.StructBuilder.prototype.setDataField_uint64, exports);
  goog.exportSymbol('StructBuilder.prototype.setDataField_float32', capnp.layout.StructBuilder.prototype.setDataField_float32, exports);
  goog.exportSymbol('StructBuilder.prototype.setDataField_float64', capnp.layout.StructBuilder.prototype.setDataField_float64, exports);

  goog.exportSymbol('Data', capnp.blob.Data, exports);
  goog.exportSymbol('Data.Reader', capnp.blob.Data.Reader, exports);
  goog.exportSymbol('Data.Builder', capnp.blob.Data.Builder, exports);

  goog.exportSymbol('Text', capnp.blob.Text, exports);
  goog.exportSymbol('Text.Reader', capnp.blob.Text.Reader, exports);
  goog.exportSymbol('Text.Builder', capnp.blob.Text.Builder, exports);


  exports['StringTextReader'] = capnp.blob.StringTextReader;

  //goog.exportProperty(capnp.message.MallocMessageBuilder, 'initRoot', capnp.message.MallocMessageBuilder.initRoot);


})(typeof exports === 'undefined' ? this['capnp_runtime'] = {} : exports);
