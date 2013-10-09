## Process this file with autoconf to produce configure.

AC_INIT([Capn Proto for JavaScript],[0.4-dev],[julian37@gmail.com],[capnproto-js])

AC_CONFIG_SRCDIR([src/capnp/compiler/capnpc-js.c++])
AC_CONFIG_AUX_DIR([build-aux])
AC_CONFIG_HEADERS([config.h])
AC_CONFIG_MACRO_DIR([m4])
AC_REQUIRE_AUX_FILE([tap-driver.sh])

# autoconf's default CXXFLAGS are usually "-g -O2".  A far more reasonable
# default is -O2 -NDEBUG.
AS_IF([test "x${ac_cv_env_CFLAGS_set}" = "x"],
      [CFLAGS="-O2 -DNDEBUG"])
AS_IF([test "x${ac_cv_env_CXXFLAGS_set}" = "x"],
      [CXXFLAGS="-O2 -DNDEBUG"])

AM_INIT_AUTOMAKE([tar-ustar])

AC_ARG_WITH([capnp],
  [AS_HELP_STRING([--with-capnp],
    [use the given capnp binary])],
  [external_capnp=yes],
  [AC_MSG_FAILURE([--with-capnp is currently mandatory])])

AC_ARG_WITH([capnp-source],
  [AS_HELP_STRING([--with-capnp-source],
    [use the given capnp source root])],
  [have_capnp_source=yes],
  [AC_MSG_FAILURE([--with-capnp-source is currently mandatory])])

AC_ARG_WITH([capnp-libdir],
  [AS_HELP_STRING([--with-capnp-libdir],
    [use the given directory for locating capnp libraries])],
  [have_capnp_libdir=yes],
  [AC_MSG_FAILURE([--with-capnp-libdir is currently mandatory])])

# Checks for programs.
AC_PROG_CC
AC_PROG_CXX
AC_LANG([C++])
AX_CXX_COMPILE_STDCXX_11
ACX_PTHREAD
AC_PROG_LIBTOOL
AC_PROG_AWK

CAPNP="$with_capnp"
AC_SUBST([CAPNP])

CAPNP_SOURCE="$with_capnp_source"
AC_SUBST([CAPNP_SOURCE])

CAPNP_LIBDIR="$with_capnp_libdir"
AC_SUBST([CAPNP_LIBDIR])

AC_SUBST([NODE_PATH])

AC_SEARCH_LIBS(sched_yield, rt)

LIBS="$PTHREAD_LIBS $LIBS"
CXXFLAGS="$CXXFLAGS $PTHREAD_CFLAGS"

AC_CONFIG_FILES([Makefile])
AC_OUTPUT
