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

goog.provide('kj.debug');

kj.debug.REQUIRE = function(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
};

kj.debug.DREQUIRE = kj.debug.REQUIRE;
kj.debug.DASSERT = kj.debug.REQUIRE;

goog.provide('kj.util');

var toString = Object.prototype.toString;

kj.util.isString = function(obj) {
    return toString.call(obj) === '[object String]';
}

kj.util.isNumber = function(obj) {
    return toString.call(obj) === '[object Number]';
}

kj.util.isArray = function(obj) {
    return toString.call(obj) === '[object Array]';
}

kj.util.isFunction = function(obj) {
    return toString.call(obj) === '[object Function]';
}

kj.util.isArrayBuffer = function(obj) {
    return toString.call(obj) === '[object ArrayBuffer]';
}

kj.util.isDataView = function(obj) {
    return toString.call(obj) === '[object DataView]';
}

kj.util.isRegularNumber = function(obj) {
    return kj.util.isNumber(obj) && !isNaN(obj);
}

var alreadyWarned = {};

kj.util.warnOnce = function (message) {
    if (!alreadyWarned[message]) {
        console.warn(message);
        alreadyWarned[message] = true;
    }
};

kj.util.decimalToHex = function(d, padding) {
    var hex = Number(d).toString(16);
    padding = (padding === undefined || padding === null) ? 2 : padding;

    while (hex.length < padding) {
        hex = '0' + hex;
    }

    return hex;
};
