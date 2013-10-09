#!/bin/sh

#-------------------- edit here >>>
closure_library=../capnproto-js/thirdparty/closure-library
compiler_jar=../capnproto-js/thirdparty/compiler.jar
capnproto_js=../capnproto-js
#-------------------- <<< edit here

set -exuo pipefail

builddir=$PWD
srcdir=$(dirname $0)

python $closure_library/closure/bin/build/closurebuilder.py --root=$capnproto_js/javascript/lib/ --root=$closure_library/ --namespace='capnp.runtime' --output_mode=compiled  --compiler_jar=$compiler_jar --compiler_flags="--compilation_level=ADVANCED_OPTIMIZATIONS" > dist/capnp_runtime.js

python $closure_library/closure/bin/build/closurebuilder.py \
    --root=$capnproto_js/javascript/lib/ \
    --root=$capnproto_js/javascript/tests/ \
    --root=$closure_library/ \
    --root=src/capnp \
    --namespace='capnp.tests.encoding' \
    --namespace='capnp.tests.serialize' \
    --namespace='capnp.tests.packed' \
    --namespace='capnp.tests.layout' \
    --namespace='capnp.tests.stringify' \
    --namespace='capnp.tests.orphans' \
    --output_mode=compiled \
    --compiler_jar=$compiler_jar \
    --compiler_flags="--compilation_level=SIMPLE_OPTIMIZATIONS" \
    --compiler_flags="--language_in=ECMASCRIPT5" \
    --compiler_flags="--use_types_for_optimization" \
    --compiler_flags="--formatting=PRETTY_PRINT" \
    > dist/capnp_tests.js

    #--compiler_flags="--warning_level=VERBOSE" \

#export NODE_PATH=${NODEPATH}:${builddir}/src/capnp:${builddir}/src:${builddir}/dist
#mocha --bail ${srcdir}/../javascript/tests/
