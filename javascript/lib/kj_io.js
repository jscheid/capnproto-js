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

goog.provide('kj');
goog.provide('kj.io');
goog.provide('kj.io.InputStream');
goog.provide('kj.io.BufferedInputStream');
goog.provide('kj.io.OutputStream');
goog.provide('kj.io.FdOutputStream');
goog.provide('kj.io.BufferedOutputStream');
goog.provide('kj.io.BufferedOutputStreamWrapper');

goog.require('kj.debug');

/**
 * @constructor
 */
kj.io.InputStream = function() {};
kj.io.InputStream.prototype.read = function(buffer, offset, minBytes, maxBytes) {
    // Reads at least minBytes and at most maxBytes, copying them into the given buffer.  Returns
    // the size read.  Throws an exception on errors.  Implemented in terms of tryRead().
    //
    // maxBytes is the number of bytes the caller really wants, but minBytes is the minimum amount
    // needed by the caller before it can start doing useful processing.  If the stream returns less
    // than maxBytes, the caller will usually call read() again later to get the rest.  Returning
    // less than maxBytes is useful when it makes sense for the caller to parallelize processing
    // with I/O.
    //
    // Never blocks if minBytes is zero.  If minBytes is zero and maxBytes is non-zero, this may
    // attempt a non-blocking read or may just return zero.  To force a read, use a non-zero minBytes.
    // To detect EOF without throwing an exception, use tryRead().
    //
    // Cap'n Proto never asks for more bytes than it knows are part of the message.  Therefore, if
    // the InputStream happens to know that the stream will never reach maxBytes -- even if it has
    // reached minBytes -- it should throw an exception to avoid wasting time processing an incomplete
    // message.  If it can't even reach minBytes, it MUST throw an exception, as the caller is not
    // expected to understand how to deal with partial reads.

    if (maxBytes === undefined) {
        maxBytes = minBytes;
    }

    var n = this.tryRead(buffer, offset, minBytes, maxBytes);
    kj.debug.REQUIRE(n >= minBytes, 'Premature EOF');
    return n;
};


/**
 * @constructor
 * @extends kj.io.InputStream
 */
kj.io.BufferedInputStream = function() {
    kj.io.InputStream.call(this);
};
kj.io.BufferedInputStream.prototype = Object.create(kj.io.InputStream.prototype);
kj.io.BufferedInputStream.prototype.constructor = kj.io.BufferedInputStream;
kj.io.BufferedInputStream.prototype.getReadBuffer = function() {
    var result = this.tryGetReadBuffer();
    kj.debug.REQUIRE(result.byteLength > 0, 'Premature EOF');
    return result;
};

/**
 * @constructor
 */
kj.io.OutputStream = function() {
};


/**
 * @constructor
 */
kj.io.FdOutputStream = function(fd) {

};

/**
 * @constructor
 * @extends kj.io.OutputStream
 */
kj.io.BufferedOutputStream = function() {
    kj.io.OutputStream.call(this);
};
kj.io.BufferedOutputStream.prototype = Object.create(kj.io.OutputStream.prototype);
kj.io.BufferedOutputStream.prototype.constructor = kj.io.BufferedOutputStream;


// Implements BufferedOutputStream in terms of an OutputStream.  Note that writes to the
// underlying stream may be delayed until flush() is called or the wrapper is destroyed.

// Creates a buffered stream wrapping the given non-buffered stream.
//
// If the second parameter is non-null, the stream uses the given buffer instead of allocating
// its own.  This may improve performance if the buffer can be reused.

/**
 * @constructor
 * @extends kj.io.BufferedOutputStream
 */
kj.io.BufferedOutputStreamWrapper = function(inner, buffer) {
    this.inner = inner;
    if (buffer) {
        goog.assert(kj.util.isArrayBuffer(buffer));
        this.buffer = buffer;
    }
    else {
        this.buffer = new ArrayBuffer(8192);
    }
    this.bufferArray = new Uint8Array(this.buffer);
    this.bufferPos = 0;
    kj.io.BufferedOutputStream.call(this);
};
kj.io.BufferedOutputStreamWrapper.prototype = Object.create(kj.io.BufferedOutputStream.prototype);
kj.io.BufferedOutputStreamWrapper.prototype.constructor = kj.io.BufferedOutputStreamWrapper;

// Force the wrapper to write any remaining bytes in its buffer to the inner stream.  Note that
// this only flushes this object's buffer; this object has no idea how to flush any other buffers
// that may be present in the underlying stream.
kj.io.BufferedOutputStreamWrapper.prototype.flush = function() {
    throw new Error('NYI');
};

// implements BufferedOutputStream ---------------------------------
kj.io.BufferedOutputStreamWrapper.prototype.getWriteBuffer = function() {
    return new Uint8Array(this.buffer, this.bufferPos);
};

kj.io.BufferedOutputStreamWrapper.prototype.write = function(src, offset, size) {
    if (src === this.buffer && offset === this.bufferPos) {
        // Oh goody, the caller wrote directly into our buffer.
        this.bufferPos += size;
    } else {
        var available = this.buffer.byteLength - this.bufferPos;

        if (size <= available) {
            if (toString.call(src) == '[object ArrayBuffer]') {
                this.bufferArray.set(new Uint8Array(src, offset, size), this.bufferPos);
            }
            else {
                this.bufferArray.set(src.subarray(offset, offset + size), this.bufferPos);
            }
            this.bufferPos += size;
        } else if (size <= this.buffer.byteLength) {
            // Too much for this buffer, but not a full buffer's worth, so we'll go ahead and copy.
            this.bufferArray.set(new Uint8Array(src, offset, available), this.bufferPos);
            this.inner.write(this.buffer, 0, this.buffer.byteLength);
            size -= available;
            this.bufferArray.set(new Uint8Array(src, available, size));
            this.bufferPos = size;
        } else {
            // Writing so much data that we might as well write directly to avoid a copy.
            this.inner.write(this.buffer, 0, this.bufferPos);
            this.bufferPos = 0;
            this.inner.write(src, 0, size);
        }
    }
};

kj.io.BufferedOutputStreamWrapper.prototype.flush = function() {
    if (this.bufferPos > 0) {
        this.inner.write(this.buffer, 0, this.bufferPos);
        this.bufferPos = 0;
    }
};
