capnproto-js
============

A port of the [Cap'n Proto](http://kentonv.github.io/capnproto/) runtime to
JavaScript. Includes a schema compiler that generates JavaScript.

Status
------

This is work in progress, and <https://github.com/capnp-js> is more actively
maintained.  It is currently based on an [outdated 
version](https://github.com/kentonv/capnproto/commit/798ff87b1b7e0a2da96355a34fa6e0aa10aaae85)
of Cap'n Proto, which means it doesn't include the recent object capability and
RPC additions or any recent bugfixes.  Also, dynamic access (at runtime, based
on schemas) is not implemented and probably will never be, as JavaScript is
itself a dynamic language.

It includes a mostly complete port of the Cap'n Proto test suite with over 100
test cases passing.

There are a number of open issues, including the following:

* This isn't very optimized yet and might be terribly slow.

* Currently you need to use Google Closure Compiler to link your code.

* Functions are distributed over nested namespaces, which makes client code
  (pre-link) somewhat verbose.

* Functions don't check their argument types and are mostly lacking Google
  Closure parameter annotations, which means it's pretty easy to shoot yourself
  in the foot.

* Generated code is overly verbose and in places uses inconsistent naming.

* Some of the code is a bit messy and redundant, in particular primitive
  getter/setters and capnp_list.js.

* No support for Mozilla's int64 datatype or any of the common JavaScript bignum
  libraries.  int64 are currently represented as an array of two int32s.

Getting Started
---------------

The build isn't very straighforward at the moment.  You will need:

* The capnproto source code, to be safe checkout the correct version (798ff87b1b7e0a2da96355a34fa6e0aa10aaae85)
* A corresponding capnproto installation or build tree
* [Google Closure Compiler](https://developers.google.com/closure/compiler/)
* [Google Closure Library](https://developers.google.com/closure/library/)

You need to edit the following files and adjust paths manually:

* javascript/build-tests.sh
* javascript/tests/all_tests.html

Then try this:

```
capnproto_js=/path/to/capnproto-js
capnproto=/path/to/capnproto
capnproto_build=/path/to/capnproto-build
$capnproto_js/c++/configure \
    --with-capnp-source=$capnproto/c++ \
    --with-capnp=$capnproto_build/capnp \
    --with-capnp-libdir=$capnproto_build/.libs
make
$capnproto_js/javascript/build-tests.sh
open test/all_tests.html # in your browser
```

Compatibility
-------------

All tests pass in current versions of Chrome (31), Firefox (25) and Safari (7).
Other browsers have not been tested yet.
