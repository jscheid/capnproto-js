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

goog.provide('capnp.prim');

goog.require('kj.util');
goog.require('capnp.layout');

capnp.prim.asUint64Val = function(args) {
  if (args.length == 1 && kj.util.isNumber(args[0])) {
    return { hi: (args[0] / 2e32) >>> 0, lo: args[0] >>> 0 };
  }
  else if (args.length == 2 && kj.util.isNumber(args[0]) && kj.util.isNumber(args[1])) {
    return { hi: args[0], lo: args[1] };
  }
  else if (args.length == 1 && goog.isArray(args[0]) && kj.util.isNumber(args[0][0]) && kj.util.isNumber(args[0][1])) {
    return { hi: args[0][0], lo: args[0][1] };
  }
  else if (args[0].hasOwnProperty('remainder') && args[0].hasOwnProperty('divideAndRemainder')) {
    throw new TypeError('appears to be bigdeciaml');
  }
  else {
    throw new TypeError('cannot convert to int64 from ' + args)
  }
};

capnp.prim.asInt64Val = capnp.prim.asUint64Val

capnp.prim.bool = {
  elementSize: capnp.layout.FieldSize.BIT,
  setValue: function(dataView, offset, value) {
    var byteOffset = offset / capnp.common.BITS_PER_BYTE;
    var bitOffset = offset % capnp.common.BITS_PER_BYTE;
    dataView.setUint8(byteOffset,
                      dataView.getUint8(byteOffset) &
                      ~(1 << bitOffset) | (value << bitOffset));
  },
  getValue: function(dataView, offset) {
    var byteOffset = offset / capnp.common.BITS_PER_BYTE;
    var bitOffset = offset % capnp.common.BITS_PER_BYTE;
    return (dataView.getUint8(byteOffset) & (1 << bitOffset)) !== 0;
  },

  Reader: function(message, segment, offset, relativeOffset) {
    var value = segment.getInt8(offset + (relativeOffset / 8) >> 0);
    return !!((value >>> (relativeOffset & 7)) & 1);
  }
};

capnp.prim.int8_t = {
  elementSize: capnp.layout.FieldSize.BYTE,
  setValue: function(dataView, offset, value) {
    dataView.setInt8(offset / capnp.common.BITS_PER_BYTE, value);
  },
  getValue: function(dataView, offset) {
    return dataView.getInt8(offset / capnp.common.BITS_PER_BYTE);
  },

  Reader: function(message, segment, offset, relativeOffset, mask) {
    return segment.getInt8(offset + relativeOffset) ^ mask;
  }
};


capnp.prim.int16_t = {
  elementSize: capnp.layout.FieldSize.TWO_BYTES,
  setValue: function(dataView, offset, value) {
    dataView.setInt16(offset / capnp.common.BITS_PER_BYTE, value, true);
  },
  getValue: function(dataView, offset) {
    return dataView.getInt16(offset / capnp.common.BITS_PER_BYTE, true);
  },

  Reader: function(message, segment, offset, relativeOffset, mask) {
    return segment.getInt16(offset + relativeOffset * 2, true) ^ mask;
  }
};

capnp.prim.int32_t = {
  elementSize: capnp.layout.FieldSize.FOUR_BYTES,
  setValue: function(dataView, offset, value) {
    dataView.setInt32(offset / capnp.common.BITS_PER_BYTE, value, true);
  },
  getValue: function(dataView, offset) {
    return dataView.getInt32(offset / capnp.common.BITS_PER_BYTE, true);
  },

  Reader: function(message, segment, offset, relativeOffset, mask) {
    return segment.getInt32(offset + relativeOffset * 4, true) ^ mask;
  }
};

capnp.prim.int64_t = {
  elementSize: capnp.layout.FieldSize.EIGHT_BYTES,
  setValue: function(dataView, offset, value) {
    var byteOffset = offset / capnp.common.BITS_PER_BYTE;
    var int64val = capnp.prim.asInt64Val([value]);
    dataView.setInt32(byteOffset, int64val.lo, true);
    dataView.setInt32(byteOffset + 4, int64val.hi, true);
  },
  getValue: function(dataView, offset) {
    var byteOffset = offset / capnp.common.BITS_PER_BYTE;
    var lo = dataView.getInt32(byteOffset, true);
    var hi = dataView.getInt32(byteOffset + 4, true);
    return [hi, lo];
  },

  Reader: function(message, segment, offset, relativeOffset) {
    var lo = segment.getInt32(offset + relativeOffset * 8 + 0, true);
    var hi = segment.getInt32(offset + relativeOffset * 8 + 4, true);
    return capnp.prim.makeInt64(hi, lo);
  }
};

capnp.prim.uint8_t = {
  elementSize: capnp.layout.FieldSize.BYTE,
  setValue: function(dataView, offset, value) {
    dataView.setUint8(offset / capnp.common.BITS_PER_BYTE, value);
  },
  getValue: function(dataView, offset) {
    return dataView.getUint8(offset / capnp.common.BITS_PER_BYTE);
  },

  Reader: function(message, segment, offset, relativeOffset, mask) {
    return (segment.getUint8(offset + relativeOffset) ^ mask) >>> 0;
  }
};

capnp.prim.uint16_t = {
  elementSize: capnp.layout.FieldSize.TWO_BYTES,
  setValue: function(dataView, offset, value) {
    dataView.setUint16(offset / capnp.common.BITS_PER_BYTE, value, true);
  },
  getValue: function(dataView, offset) {
    return dataView.getUint16(offset / capnp.common.BITS_PER_BYTE, true);
  },

  Reader: function(message, segment, offset, relativeOffset, mask) {
    return (segment.getUint16(offset + relativeOffset * 2,
                              true) ^ mask) >>> 0;
  }
};

capnp.prim.uint32_t = {
  elementSize: capnp.layout.FieldSize.FOUR_BYTES,
  setValue: function(dataView, offset, value) {
    dataView.setUint32(offset / capnp.common.BITS_PER_BYTE, value, true);
  },
  getValue: function(dataView, offset) {
    return dataView.getUint32(offset / capnp.common.BITS_PER_BYTE, true);
  },

  Reader: function(message, segment, offset, relativeOffset, mask) {
    return (segment.getUint32(offset + relativeOffset * 4,
                              true) ^ mask) >>> 0;
  }
};

capnp.prim.uint64_t = {
  elementSize: capnp.layout.FieldSize.EIGHT_BYTES,
  setValue: function(dataView, offset, value) {
    var byteOffset = offset / capnp.common.BITS_PER_BYTE;
    var uint64val = capnp.prim.asUint64Val([value]);
    dataView.setUint32(byteOffset, uint64val.lo, true);
    dataView.setUint32(byteOffset + 4, uint64val.hi, true);
  },
  getValue: function(dataView, offset) {
    var byteOffset = offset / capnp.common.BITS_PER_BYTE;
    var lo = dataView.getUint32(byteOffset, true);
    var hi = dataView.getUint32(byteOffset + 4, true);
    return [hi, lo];
  },

  Reader: function(message, segment, offset, relativeOffset) {
    var lo = segment.getUint32(offset + relativeOffset * 8 + 0, true);
    var hi = segment.getUint32(offset + relativeOffset * 8 + 4, true);
    return capnp.prim.makeInt64(hi, lo);
  }
};

capnp.prim.float32_t = {
  elementSize: capnp.layout.FieldSize.FOUR_BYTES,
  setValue: function(dataView, offset, value) {
    dataView.setFloat32(offset / capnp.common.BITS_PER_BYTE, value, true);
  },
  getValue: function(dataView, offset) {
    return dataView.getFloat32(offset / capnp.common.BITS_PER_BYTE, true);
  },

  Reader: function(message, segment, offset, relativeOffset) {
    return segment.getFloat32(offset + relativeOffset * 4, true);
  }
};

capnp.prim.float64_t = {
  elementSize: capnp.layout.FieldSize.EIGHT_BYTES,
  setValue: function(dataView, offset, value) {
    dataView.setFloat64(offset / capnp.common.BITS_PER_BYTE, value, true);
  },
  getValue: function(dataView, offset) {
    return dataView.getFloat64(offset / capnp.common.BITS_PER_BYTE, true);
  },

  Reader: function(message, segment, offset, relativeOffset) {
    return segment.getFloat64(offset + relativeOffset * 8, true);
  }
};

capnp.prim.Void = {
  elementSize: capnp.layout.FieldSize.VOID,
  setValue: function(dataView, offset, value) {
  },
  getValue: function(dataView, offset) {
    return undefined;
  },

  Builder: function(message, segment, offset) {
  },

  Reader: function(message, segment, offset, relativeOffset) {
    return undefined;
  }
};
