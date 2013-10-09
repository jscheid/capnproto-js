#!/bin/sh

set -exuo pipefail

export NODE_PATH=${NODE_PATH}:${PWD}/src/capnp:${PWD}/src:${srcdir}/../javascript/lib/

mocha --reporter tap ${srcdir}/../javascript/tests/
