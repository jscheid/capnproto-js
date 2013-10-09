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

goog.provide('capnp.orphan');

/**
 * @constructor
 */
capnp.orphan.Orphan = function(type, builder) {
  this.type = type;
  this.builder = builder;
};

capnp.orphan.Orphan.prototype.destroy = function() {
  if (this.builder) this.builder.destroy();
}

capnp.orphan.Orphan.prototype.isNull = function() {
  return this.builder === null || this.builder.isNull();
}

capnp.orphan.Orphan.prototype.get = function() {
  //return new this.type.Builder(this.builder.asStruct(this.type.STRUCT_SIZE));
  return this.type.getOrphan(this.builder);
}

capnp.orphan.Orphan.prototype.getReader = function() {
  //return new this.type.Reader(this.builder.asStructReader(this.type.STRUCT_SIZE));
  return this.type.getOrphanReader(this.builder);
}

/**
 * @constructor
 */
capnp.orphan.Orphanage = function(arena) {
  this.arena = arena;
};

capnp.orphan.Orphanage.prototype.newOrphan = function(RootType, size) {
  if ((RootType instanceof capnp.list.List) || (RootType === capnp.blob.Text) || (RootType === capnp.blob.Data)) {
    return new capnp.orphan.Orphan(RootType, RootType.getNewOrphanList(this.arena, size));    
  }
  else {
    return new capnp.orphan.Orphan(RootType, capnp.layout.OrphanBuilder.initStruct(this.arena, RootType.STRUCT_SIZE));
  }
};

capnp.orphan.Orphanage.prototype.newOrphanCopy = function(copyFrom) {

  return new capnp.orphan.Orphan(copyFrom._getParentType(), copyFrom._getParentType().copyOrphan(
    this.arena, copyFrom._getInnerReader()));
}
