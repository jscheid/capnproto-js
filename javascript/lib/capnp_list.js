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

goog.provide('capnp.list');

goog.require('capnp.prim');
goog.require('capnp.blob');
goog.require('capnp.layout');
goog.require('kj.util');

var primitiveClasses = [
  capnp.prim.int8_t,
  capnp.prim.uint8_t,
  capnp.prim.int16_t,
  capnp.prim.uint16_t,
  capnp.prim.int32_t,
  capnp.prim.uint32_t,
  capnp.prim.int64_t,
  capnp.prim.uint64_t,
  capnp.prim.float32_t,
  capnp.prim.float64_t,
  capnp.prim.bool,
  capnp.prim.Void
];

var blobClasses = [
  capnp.blob.Text,
  capnp.blob.Data
];


/**
 * @constructor
 */
capnp.list.List = function(clazz) {
  if (clazz) {
    if (primitiveClasses.indexOf(clazz) >= 0) {
      return capnp.list.ListOfPrimitives(clazz);
    }
    else if (blobClasses.indexOf(clazz) >= 0) {
      return capnp.list.ListOfBlobs(clazz);
    }
    else if (kj.util.isFunction(clazz) && clazz instanceof this) {
      return capnp.list.ListOfLists(clazz);
    }
    else if (clazz.STRUCT_SIZE) {
      return capnp.list.ListOfStructs(clazz);
    }
    else {
      return capnp.list.ListOfEnums(clazz);
    }
  }
};


capnp.list.List.prototype.getOrphan = function(builder) {
  return this.Builder(builder.asList(this.getElementSize()));
};

capnp.list.List.prototype.getOrphanReader = function(builder) {
  return this.Reader(builder.asListReader(this.getElementSize()));
};

capnp.list.List.prototype.getNewOrphanList = function(arena, size) {
  return capnp.layout.OrphanBuilder.initList(arena, size, this.getElementSize());
};

capnp.list.ListOfPrimitives = function(clazz, defaultElementSize) {

  /**
   * @constructor
   */
  var subType = function() {
  }
  subType.prototype = new capnp.list.List();
  
  subType.prototype.getElementSize = function() {
    return defaultElementSize || clazz.elementSize;
  };

  subType.prototype.getReaderAsElementOf = function(reader,
                                         index,
                                         defaultValue) {
    return reader.getListElement(
      index, defaultElementSize || clazz.elementSize);
  };

  subType.prototype.getBuilderAsElementOf = function(builder,
                                                     index,
                                                     defaultValue) {
    return builder.getListElement(
      index, defaultElementSize || clazz.elementSize);
  };

  subType.prototype.initBuilderAsElementOf = function(builder,
                                                      index,
                                                      size) {
    return builder.initListElement(
      index, defaultElementSize || clazz.elementSize, size);
  };

  subType.prototype.getReaderAsFieldOf = function(reader,
                                                  index,
                                                  defaultValue) {
    return reader.getListField(
      index, defaultElementSize || clazz.elementSize, defaultValue);
  };

  subType.prototype.getBuilderAsFieldOf = function(builder,
                                                   index,
                                                   defaultValue) {
    return builder.getListField(
      index, defaultElementSize || clazz.elementSize, defaultValue);
  };

  subType.prototype.getBuilder = function(builder,
                                          index,
                                          defaultValue) {
    return this.Builder(
      this.getBuilderAsFieldOf(builder, index, defaultValue));
  };

  subType.prototype.initBuilder = function(builder,
                                           index,
                                           size) {
    return new this.Builder(
      this.initBuilderAsFieldOf(builder, index, size));
  };

  subType.prototype.initBuilderAsFieldOf = function(builder, index, size) {
    var elementSize = defaultElementSize || clazz.elementSize;
    return builder.initListField(index, elementSize, size);
  };

  subType.prototype.getReader = function(reader, index, defaultValue) {
    return new this.Reader(
      this.getReaderAsFieldOf(reader, index, defaultValue));
  };

  /**
   * @constructor
   */
  var Reader = function(_reader) {

    this.getReader = function() {
      return _reader;
    };

    this._getInnerReader = function() {
      return this.getReader();
    }

    this.length = function() {
      return _reader.size();
    };

    this.size = function() {
      return _reader.size();
    };

    this.get = function(index) {
      if (index < 0 || index >= _reader.size()) {
        throw new RangeError();
      }
      return _reader.getDataElement(clazz, index);
    };

    this.toString = function() {
      var result = '[ ';

      for (var i = 0, len = this.length(); i < len; ++i) {
        if (i > 0) result += ', ';
        result += safeToString(this.get(i));
      }

      return result + ' ]';
    };

    return this;
  };

  /**
   * @constructor
   */
  subType.prototype.Builder = function(_builder) {
    return new (function() {

      this.getReader = function() {
        return _builder.asReader();
      };

      this.length = function() {
        return _builder.size();
      };

      this.size = function() {
        return _builder.size();
      };

      this.get = function(index) {
        if (index < 0 || index >= _builder.size()) {
          throw new RangeError();
        }
        return _builder.getDataElement(clazz, index);
      };

      this.set = function(index, value) {
        if (index < 0 || index >= _builder.size()) {
          throw new RangeError();
        }
        _builder.setDataElement(clazz, index, value);
      };
    });
  };

  subType.prototype.constructor = subType;
  subType.prototype.Reader = Reader;

  subType.prototype.copyOrphan = capnp.layout.OrphanBuilder.copyList;
  var instance = new subType();

  Reader.prototype._getParentType = function() {
    return instance;
  };

  return instance;
};

capnp.list.ListOfEnums = function(clazz) {
  return capnp.list.ListOfPrimitives(capnp.prim.uint16_t, capnp.layout.FieldSize.TWO_BYTES);
};


/**
 * @constructor
 */
capnp.list.ListOfLists = function(clazz) {

  return {
    type: 'ListsOfLists',

    getElementSize: function() {
      return capnp.layout.FieldSize.POINTER;
    },

    getReaderAsElementOf: function(reader, index, defaultValue) {
      return reader.getListField(index, capnp.layout.FieldSize.POINTER, defaultValue);
    },

    getBuilderAsElementOf: function(builder, index, defaultValue) {
      return builder.getListField(index, capnp.layout.FieldSize.POINTER, defaultValue);
    },

    getReaderAsFieldOf: function(reader, index, defaultValue) {
      return reader.getListField(index, capnp.layout.FieldSize.POINTER, defaultValue);
    },

    getReader: function(reader, index, defaultValue) {
      return new this.Reader(this.getReaderAsFieldOf(reader, index, defaultValue));
    },

    getBuilderAsFieldOf: function(builder, index, defaultValue) {
      return builder.getListField(index, capnp.layout.FieldSize.POINTER, defaultValue);
    },

    initBuilderAsFieldOf: function(builder, index, size) {
      return builder.initListField(index, capnp.layout.FieldSize.POINTER, size);
    },

    getBuilder: function(builder, index, defaultValue) {
      return new this.Builder(this.getBuilderAsFieldOf(builder, index, defaultValue));
    },

    initBuilder: function(builder, index, size) {
      return new this.Builder(this.initBuilderAsFieldOf(builder, index, size));
    },

    /**
     * @constructor
     */
    Reader: function(_reader) {

      this.getReader = function() {
        return _reader;
      };

      this.length = function() {
        return _reader.size();
      };

      this.size = function() {
        return _reader.size();
      };

      this.get = function(index) {
        if (index < 0 || index >= _reader.size()) {
          throw new RangeError();
        }

        return new clazz.Reader(clazz.getReaderAsElementOf(_reader, index));
      };

      this.toString = function() {
        var result = '[ ';

        for (var i = 0, len = this.length(); i < len; ++i) {
          if (i > 0) result += ', ';
          result += safeToString(this.get(i));
        }

        return result + ' ]';
      };

      return this;
    },

    /**
     * @constructor
     */
    Builder: function(_builder) {

      this.getReader = function() {
        return _builder.asReader();
      };

      this.length = function() {
        return _builder.size();
      };

      this.size = function() {
        return _builder.size();
      };

      this.get = function(index) {
        if (index < 0 || index >= _builder.size()) {
          throw new RangeError();
        }

        return new clazz.Builder(clazz.getBuilderAsElementOf(_builder, index));
      };

      this.init = function(index, size) {
        if (index < 0 || index >= _builder.size()) {
          throw new RangeError();
        }
        return new clazz.Builder(clazz.initBuilderAsElementOf(_builder, index, size));
      };

      this.set = function(index, value) {
        if (index < 0 || index >= _builder.size()) {
          throw new RangeError();
        }

        if (goog.isArray(value)) {
          var l = this.init(index, value.length);

          for (var i = 0, len = value.length; i < len; ++i) {
            l.set(i, value[i]);
          }
        }
        else {
          this._setSingle(index, value);
        }
      };

      this._setSingle = function(index, value) {
        _builder.setListElement(index, value);
      };

      this.toString = function() {
        var result = '[ ';

        for (var i = 0, len = this.length(); i < len; ++i) {
          if (i > 0) result += ', ';
          result += safeToString(this.get(i));
        }

        return result + ' ]';
      };

      return this;
    }
  };
};
capnp.list.ListOfLists.prototype = new capnp.list.List();

capnp.list.ListOfBlobs = function(clazz) {

  /**
   * @constructor
   */
  var subType = function() {

    this.getElementSize = function() {
      return capnp.layout.FieldSize.POINTER;
    };

    this.getReaderAsElementOf = function(reader, index, defaultValue, defaultBytes) {
      return reader.getListElement(index, capnp.layout.FieldSize.POINTER);
    };

    this.getBuilderAsElementOf = function(builder, index, defaultValue, defaultBytes) {
      return builder.getListElement(index, capnp.layout.FieldSize.POINTER);
    };

    this.initBuilderAsElementOf = function(builder, index, size) {
      return builder.initListElement(index, capnp.layout.FieldSize.POINTER, size);
    };

    this.initBuilderAsFieldOf = function(builder, index, size) {
      return builder.initListField(index, capnp.layout.FieldSize.POINTER, size);
    };

    this.getReaderAsFieldOf = function(reader, index, defaultValue) {
      return reader.getListField(index, capnp.layout.FieldSize.POINTER, defaultValue);
    };

    this.getBuilderAsFieldOf = function(builder, index, defaultValue) {
      var result = builder.getListField(index, capnp.layout.FieldSize.POINTER, defaultValue);
      return result;
    };

    this.getReader = function(reader, index, defaultValue) {
      return new this.Reader(this.getReaderAsFieldOf(reader, index, defaultValue));
    };

    this.getBuilder = function(builder, index, defaultValue) {
      return new this.Builder(this.getBuilderAsFieldOf(builder, index, defaultValue));
    };

    /**
     * @constructor
     */
    this.Reader = function(_reader) {

      this.getReader = function() {
        return _reader;
      };

      this.length = function() {
        return _reader.size();
      };

      this.size = function() {
        return _reader.size();
      };

      this.get = function(index) {
        if (index < 0 || index >= _reader.size()) {
          throw new RangeError();
        }
        return clazz.getReaderAsElement(_reader, index);
      };

      this.toString = function() {
        var result = '[ ';

        for (var i = 0, len = this.length(); i < len; ++i) {
          if (i > 0) result += ', ';
          result += safeToString(this.get(i));
        }

        return result + ' ]';
      };

      return this;
    };

    /**
     * @constructor
     */
    this.Builder = function(_builder) {

      this.getReader = function() {
        return _builder.asReader();
      };

      this.length = function() {
        return _builder.size();
      };

      this.size = function() {
        return _builder.size();
      };

      this.get = function(index) {
        if (index < 0 || index >= _builder.size()) {
          throw new RangeError();
        }

        return clazz.getBuilderAsElement(_builder, index);
      };

      this.set = function(index, value) {
        if (index < 0 || index >= _builder.size()) {
          throw new RangeError();
        }
        if (kj.util.isString(value)) {
          value = new capnp.blob.StringTextReader(value);
        }
        clazz.setElement(_builder, index, value);
      };

      this.toString = function() {
        var result = '[ ';

        for (var i = 0, len = this.length(); i < len; ++i) {
          if (i > 0) result += ', ';
          result += safeToString(this.get(i));
        }

        return result + ' ]';
      };

      return this;
    };
  };
  subType.prototype = new capnp.list.List();
  subType.prototype.constructor = subType;
  return new subType;
};
capnp.list.ListOfBlobs.prototype = new capnp.list.List();


capnp.list.ListOfStructs = function(clazz) {

  /**
   * @constructor
   */
  var subType = function() {

    this.getElementSize = function() {
      return capnp.layout.FieldSize.POINTER;
    };

    this.getReaderAsElementOf = function(reader, index) {
      return reader.getListElement(index, clazz.ELEMENT_SIZE);
    };

    this.getBuilderAsElementOf = function(builder, index) {
      return builder.getStructListElement(index, clazz.STRUCT_SIZE);
    };

    this.initBuilderAsElementOf = function(builder, index, size) {
      return builder.initStructListElement(index, size, clazz.STRUCT_SIZE);
    };

    this.getReaderAsFieldOf = function(reader, index, defaultValue) {
      return reader.getListField(index, clazz.ELEMENT_SIZE, defaultValue);
    };

    this.getReader = function(reader, index, defaultValue) {
      return new this.Reader(this.getReaderAsFieldOf(reader, index, defaultValue));
    };

    this.getBuilderAsFieldOf = function(builder, index, defaultValue) {
      return builder.getStructListField(index, clazz.STRUCT_SIZE, defaultValue);
    };

    this.initBuilderAsFieldOf = function(builder, index, size) {
      return builder.initStructListField(index, size, clazz.STRUCT_SIZE);
    };

    this.getBuilder = function(builder, index, defaultValue) {
      var structBuilder = this.getBuilderAsFieldOf(builder, index, defaultValue);
      return this.Builder(structBuilder);
    };

    this.initBuilder = function(builder, index, size) {
      return this.Builder(this.initBuilderAsFieldOf(builder, index, size));
    };

    this.getOrphan = function(builder) {
      return this.Builder(builder.asStructList(clazz.STRUCT_SIZE));
    };

    this.getNewOrphanList = function(arena, size) {
      return capnp.layout.OrphanBuilder.initStructList(arena, size, clazz.STRUCT_SIZE);
    };

    /**
     * @constructor
     */
    this.Builder = function(_builder) {
      return new (function() {

        this.getReader = function() {
          return _builder.asReader();
        };

        this.length = function() {
          return _builder.size();
        };

        this.size = function() {
          return _builder.size();
        };

        this.get = function(index) {
          return new clazz.Builder(_builder.getStructElement(index));
        };

        return this;
      });
    };

    /**
     * @constructor
     */
    this.Reader = function(_reader) {

      this.getReader = function() {
        return _reader;
      };

      this.length = function() {
        return _reader.size();
      };

      this.size = function() {
        return _reader.size();
      };

      this.get = function(index) {
        if (index < 0 || index >= _reader.size()) {
          throw new RangeError();
        }

        return new clazz.Reader(_reader.getStructElement(index));
      };

      this.toString = function() {
        var result = '[ ';

        for (var i = 0, len = this.length(); i < len; ++i) {
          if (i > 0) result += ', ';
          result += safeToString(this.get(i));
        }

        return result + ' ]';
      };

      return this;
    };
  };
  subType.prototype = new capnp.list.List();
  return new subType;
};
capnp.list.ListOfStructs.prototype = new capnp.list.List();
