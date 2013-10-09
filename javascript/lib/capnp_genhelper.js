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

goog.provide('capnp.genhelper')

goog.require('capnp.blob')
goog.require('capnp.list')
goog.require('capnp.layout')
goog.require('capnp.orphan')

goog.require('kj.util')

/**
 *  @param {capnp.layout.StructBuilder} builder
 *  @param {number} index
 */
capnp.genhelper.textBlobSet = function(builder, index, value) {
  if (kj.util.isString(value)) {
    builder.setTextBlobField(index, new capnp.blob.StringTextReader(value));
  }
  else {
    builder.setTextBlobField(index, value);
  }
};

capnp.genhelper.textBlobDisown = function(builder, index) {
  return new capnp.orphan.Orphan(capnp.blob.Text, builder.disownTextBlobField(index));
};

/**
 *  @param {capnp.layout.StructBuilder} builder
 *  @param {number} index
 */
capnp.genhelper.dataBlobSet = function(builder, index, value) {
  if (kj.util.isString(value)) {
    builder.setDataBlobField(index, new capnp.blob.StringTextReader(value));
  }
  else {
    builder.setDataBlobField(index, value);
  }
};

capnp.genhelper.dataBlobDisown = function(builder, index) {
  return new capnp.orphan.Orphan(capnp.blob.Data, builder.disownDataBlobField(index));
};


/**
 *  @param {number} index
 *  @param {number} size
 */
capnp.genhelper.listInit = function(listClass, builder, index, size) {
  return new listClass.Builder(listClass.initBuilderAsFieldOf(builder, index, size));
};

/**
 *  @param {capnp.layout.StructBuilder} builder
 *  @param {number} index
 */
capnp.genhelper.listSet = function(listClass, builder, index, value) {
  if (goog.isArray(value)) {

    var len = value.length;
    var l = capnp.genhelper.listInit(listClass, builder, index, len);
    for (var i = 0; i < len; ++i) {
      l.set(i, value[i]);
    }
  }
  else {
    builder.setListField(index, value.getReader());
  }
};

capnp.genhelper.listDisown = function(listClass, builder, index) {
  return new capnp.orphan.Orphan(listClass, builder.disownListField(index));
};

/**
 *  @param {capnp.layout.StructBuilder} builder
 *  @param {number} index
 */
capnp.genhelper.structSet = function(structClass, builder, index, value) {
  builder.setStructField(index, value._getReader());
};

capnp.genhelper.structAdopt = function(structClass, builder, index, value) {
  builder.adoptStructField(index, value.builder);
}

capnp.genhelper.structDisown = function(structClass, builder, index) {
  return new capnp.orphan.Orphan(structClass, builder.disownStructField(index));
};


/**
 *  @param {number} index
 */
capnp.genhelper.objectInit = function(builder, index, _args) {
  var args = Array.prototype.slice.call(_args, 0);
  var type = args.shift();
  if (type instanceof capnp.list.List) {
    var size = args.shift();
    return new type.Builder(type.initBuilderAsFieldOf(builder, index, size));
  }
  else if (type.STRUCT_SIZE) {
    return new type.Builder(builder.initStructField(index, type.STRUCT_SIZE));
  }
  else {
    throw new Error('unsupported type: ' + type); // FIXME
  }
};

/**
 *  @param {number} index
 */
capnp.genhelper.objectSet = function(type, builder, index, value) {
  if (type instanceof capnp.list.List) {
    if (goog.isArray(value)) {
      var len = value.length;
      var l = capnp.genhelper.objectInit(builder, index, [type, len]);
      for (var i = 0; i < len; ++i) {
        l.set(i, value[i]);
      }
    }
    else {
      builder.setListField(index, value.getReader());
    }
  }
  else if (type === capnp.blob.Text) {
    if (kj.util.isString(value)) {
      value = new capnp.blob.StringTextReader(value);
    }
    builder.setTextBlobField(index, value);
  }
  else if (type === capnp.blob.Data) {
    builder.setDataBlobField(index, value);
  }
  else {
    capnp.genhelper.structSet(type, builder, index, value);
  }
};

/**
 *  @param {number} index
 *  @param {number} defaultBytes
 */
capnp.genhelper.objectGetFromBuilder = function(type, builder, index, defaultValue, defaultBytes) {
  if (type instanceof capnp.list.List) {
    return new type.Builder(type.getBuilderAsFieldOf(builder, index, defaultValue));
  }
  else if (type === capnp.blob.Text) {
    if (!defaultValue) { defaultValue = null; defaultBytes = 0; }
    else if (!defaultBytes) { defaultBytes = 0; }
    return builder.getTextBlobField(index, defaultValue, defaultBytes);
  }
  else if (type === capnp.blob.Data) {
    if (!defaultValue) { defaultValue = null; defaultBytes = 0; }
    else if (!defaultBytes) { defaultBytes = 0; }
    return builder.getDataBlobField(index, defaultValue, defaultBytes);
  }
  else {
    return new type.Builder(builder.getStructField(index, type.STRUCT_SIZE));
  }
};

/**
 *  @param {number} index
 */
capnp.genhelper.objectGetFromReader = function(type, reader, index, defaultValue) {
  if (type === undefined) {
    throw new Error('NYI');
  }
  else if (type instanceof capnp.list.List) {
    return new type.Reader(type.getReaderAsFieldOf(reader, index, defaultValue));
  }
  else if (type === capnp.blob.Text) {
    var defaultBytes;
    if (!defaultValue) { defaultValue = null; defaultBytes = 0; }
    else if (!defaultBytes) { defaultBytes = 0; }
    return reader.getTextBlobField(index, defaultValue, defaultBytes);
  }
  else if (type === capnp.blob.Data) {
    var defaultBytes;
    if (!defaultValue) { defaultValue = null; defaultBytes = 0; }
    else if (!defaultBytes) { defaultBytes = 0; }
    return reader.getDataBlobField(index, defaultValue, defaultBytes);
  }
  else {
    return new type.Reader(reader.getStructField(index, type.STRUCT_SIZE));
  }
};

/**
 *  @constructor
 *  @param {number} offset
 *  @param {number} numElements
 */
capnp.genhelper.ConstText = function(segmentData, offset, numElements) {

  var segment = new capnp.arena.SegmentReader(null, null, new DataView(segmentData), null);

  this.get = function() {
    return capnp.blob.Text.Reader(segment, offset, numElements);
  };
  return this;
};

/**
 *  @constructor
 *  @param {number} offset
 *  @param {number} numElements
 */
capnp.genhelper.ConstData = function(segmentData, offset, numElements) {

  this.get = function() {
    return new capnp.blob.Data.Reader(new Uint8Array(segmentData, offset, numElements), numElements);
  };
  return this;
};

/**
 *  @constructor
 *  @param {number} offset
 *  @param {number} numElements
 */
capnp.genhelper.ConstStruct = function(type, segmentData, offset, numElements) {

  var segment = new capnp.arena.SegmentReader(null, null, new DataView(segmentData), null);

  this.get = function() {
    return new type.Reader(capnp.layout.StructReader.readRoot(offset << 3, segment, Number.MAX_VALUE));
  };
  return this;
};

/**
 *  @constructor
 *  @param {number} offset
 *  @param {number} numElements
 */
capnp.genhelper.ConstList = function(type, segmentData, offset, numElements) {

  var segment = new capnp.arena.SegmentReader(null, null, new DataView(segmentData), null);

  this.get = function() {
    return new type.Reader(capnp.layout.ListReader.readRoot(offset << 3, segment, type.getElementSize()));
  };
  return this;
};

/** @const */ capnp.genhelper.NullStructReader = new capnp.layout.StructReader(null, 0, 0, 0, 0, 0, Number.MAX_VALUE);

function safeToString(obj) {
  if (obj === null) {
    return 'null';
  }
  if (obj === undefined) {
    return 'undefined';
  }
  if (obj instanceof capnp.blob.Text.Reader ||
      obj instanceof capnp.blob.Text.Builder) {
    return '"' + obj + '"';
  }
  return obj.toString();
}


capnp.genhelper.ToStringHelper = function(object, className, fieldList, hasList, getList, discriminator) {
  if (discriminator !== undefined) {
    var hasGetter = hasList[discriminator];
    var getter = getList[discriminator];
    var value = getter.call(object);
    if (hasGetter.call(object) || value === 0) {
      if (value !== undefined) {
        return '(' + fieldList[discriminator] + ' = ' + safeToString(value) + ')';
      }
      else {
        return '(' + fieldList[discriminator] + ')';
      }
    }
    else {
      return '()';
    }
  }

  /*
    var result = className + "{";
    for (var i=0, len=fieldList.length; i<len; ++i) {
    if (i>0) result += ', ';
    result += fieldList[i];
    result += '=';
    var getter = 'get' + fieldList[i].charAt(0).toUpperCase() + fieldList[i].slice(1);
    result += safeToString(object[getter]());
    }
    return result + "}";
  */

  var result = '(';
  //result += " [discrim=" + discriminator + " / " + (object.which ? object.which() : "?")  + "] ";
  var first = true;
  for (var i = 0, len = fieldList.length; i < len; ++i) {
    var hasGetter = hasList[i];
    var getter = getList[i];
    if (hasGetter.call(object)) {
      if (first) {
        first = false;
      }
      else {
        result += ', ';
      }
      result += fieldList[i];
      result += ' = ' + safeToString(getter.call(object));
    }
  }
  return result + ')';
};

capnp.genhelper.StructSize = capnp.layout.StructSize;
