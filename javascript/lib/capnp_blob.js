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

goog.provide('capnp.blob');

goog.require('kj.util');

capnp.blob.Text = {

  copyOrphan: capnp.layout.OrphanBuilder.copyText,

  getReaderAsElement: function(reader, index) {
    return reader.getTextBlobElement(index);
  },

  getBuilderAsElement: function(builder, index) {
    var result = builder.getTextBlobElement(index);
    return result;
  },

  setElement: function(builder, index, value) {
    builder.setTextBlobElement(index, value);
  },

  getReader: function(reader, index, defaultValue, defaultBytes) {
    if (defaultValue === undefined) { defaultBytes = 0; }
    if (defaultBytes === undefined) { defaultBytes = 0; }
    return reader.getTextBlobField(index, defaultValue, defaultBytes);
  },

  getBuilder: function(builder, index, defaultValue, defaultBytes) {
    if (defaultValue === undefined) { defaultBytes = 0; }
    if (defaultBytes === undefined) { defaultBytes = 0; }
    return builder.getTextBlobField(index, defaultValue, defaultBytes);
  },

  Builder:
  /**
   * @constructor
   */
  function(segment, ptr, size) {

    this.toDebugString = function() {
      return 'Text.Builder{ptr=' + ptr + ', size=' + size +
        ', str="' + this.str() + '"}';
    };

    this.toString = function() { return this.str(); };

    this.begin = function() { return ptr * 8; };

    this.size = function() { return size; };

    this.str = function() {

      var pad = function(n) {
        return n.length < 2 ? '0' + n : n;
      };

      var str = '';
      var dataView = segment.getUint8Array();
      for (var i = ptr * 8, end = ptr * 8 + size; i < end; ++i) {
        str += ('%' + pad(dataView[i].toString(16)));
      }

      return decodeURIComponent(str);
    };


    this.asUint8Array = function() {
      return segment.getUint8Array().subarray(ptr * 8,
                                              ptr * 8 + size);
    };

    this.getOrphan = function(builder) {
      return builder.asText();
    };

    this.getOrphanReader = function(builder) {
      return builder.asTextReader();
    };

    this.getNewOrphanList = function(arena, size) {
      return capnp.layout.OrphanBuilder.initText(arena, size);
    };

    return this;
  },

  Reader:
  /**
   * @constructor
   */
  function(segment, offset, numElements) {

    goog.asserts.assert(kj.util.isRegularNumber(numElements), 'invalid Reader.numElements: ' + numElements);

    this.totalSizeInWords = 1;

    goog.asserts.assert(numElements === 0 || segment !== null);

    return new (function() {
      this.str = function() {

        if (numElements === 0) {
          return '';
        }
        else {
          var pad = function(n) {
            return n.length < 2 ? '0' + n : n;
          };

          var str = '';
          var dataView = segment.getUint8Array();
          for (var i = offset * 8,
               end = offset * 8 + numElements; i < end; ++i) {
            str += ('%' + pad(dataView[i].toString(16)));
          }

          return decodeURIComponent(str);
        }
      };

      this.raw = function() {
        var dataView = segment;
        return new DataView(dataView.buffer,
                            dataView.byteOffset + offset,
                            numElements);
      };

      this.toString = function() {
        return this.str();
      };
      this.toDebugString = function() {
        return 'Text{offset=' + offset +
          ', numElements=' + numElements +
          ', str="' + this.str() + '"}';
      };

      this._getParentType = function() {
        return capnp.blob.Text;
      };

      this._getInnerReader = function() {
        return this;
      };

      return this;
    });
  }
};

capnp.blob.Data = {

  copyOrphan: capnp.layout.OrphanBuilder.copyData,

  getReaderAsElement: function(reader, index) {
    return reader.getDataBlobElement(index);
  },

  getBuilderAsElement: function(builder, index) {
    return builder.getDataBlobElement(index);
  },

  setElement: function(builder, index, value) {
    builder.setDataBlobElement(index, value);
  },

  getReader: function(reader, index, defaultValue, defaultBytes) {
    if (defaultValue === undefined) {
      defaultValue = null;
      defaultBytes = 0;
    }
    if (defaultBytes === undefined) {
      defaultBytes = 0;
    }
    return reader.getDataBlobField(index, defaultValue, defaultBytes);
  },

  getBuilder: function(builder, index, defaultValue, defaultBytes) {
    if (defaultValue === undefined) {
      defaultValue = null; defaultBytes = 0; }
    if (defaultBytes === undefined) {
      defaultBytes = 0;
    }
    return builder.getDataBlobField(index, defaultValue, defaultBytes);
  },

  getOrphan: function(builder) {
    return builder.asData();
  },

  getOrphanReader: function(builder) {
    return builder.asDataReader();
  },

  getNewOrphanList: function(arena, size) {
    return capnp.layout.OrphanBuilder.initData(arena, size);
  },

  Builder:
  /**
   * @constructor
   */
  function(segment, ptr, size) {

    this.begin = function() { return ptr * 8; };

    this.size = function() { return size; };

    this.toDebugString = function() {
      return 'Data.Builder{ptr=' + ptr +
        ', size=' + size +
        ', arr="<TBD>"}';
    };

    this.toString = function() { return '[...]'; }; // FIXME

    this.asArray = function() {
      var bytes = [];
      var arr = this.asUint8Array();
      for (var i = 0, len = this.size(); i < len; i++) {
        bytes.push(arr[i]);
      }
      return bytes;
    };

    this.asUint8Array = function() {
      return segment.getUint8Array().subarray(ptr * 8,
                                              ptr * 8 + size);
    };

    return this;
  },

  Reader:
  /**
   * @constructor
   */
  function(uint8array, numElements) {

    goog.asserts.assert(kj.util.isRegularNumber(numElements),
                        'numElements not a regular number: ' + numElements);

    return new (function() {
      this.size = function() {
        return numElements;
      };

      this.asUint8Array = function() {
        return uint8array;
      };

      this.asArray = function() {
        var bytes = [];
        var arr = this.asUint8Array();
        for (var i = 0, len = this.size(); i < len; i++) {
          bytes.push(arr[i]);
        }
        return bytes;
      };

      this.equals = function(other) {
        if (this.size() !== other.size()) {
          return false;
        }
        var arr1 = this.asUint8Array();
        var arr2 = this.asUint8Array();
        for (var i = 0, len = this.size(); i < len; i++) {
          if (arr1[i] != arr2[i]) {
            return false;
          }
        }
        return true;
      };

      this.toString = function() {
        return '[ ' + this.asArray().join(', ') + ' ]';
      };

      this._getParentType = function() {
        return capnp.blob.Data;
      };

      this._getInnerReader = function() {
        return this;
      };

      return this;
    });
  }
};

/**
 * @constructor
 */
capnp.blob.StringTextReader = function(str) {
  var strUtf8 = unescape(encodeURIComponent(str));
  var ab = new Uint8Array(strUtf8.length);
  for (var i = 0; i < strUtf8.length; i++) {
    ab[i] = strUtf8.charCodeAt(i);
  }

  this.asUint8Array = function() { return ab; };
  this.size = function() { return ab.byteLength; };
  this._getParentType = function() {
    return capnp.blob.Text;
  };
  this._getInnerReader = function() {
    return this;
  };

  return this;
};
