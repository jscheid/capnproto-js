// Copyright (c) 2013, Julian Scheid <julians37@gmail.com>
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this
//    list of conditions and the following disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright notice,
//    this list of conditions and the following disclaimer in the documentation
//    and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
// ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
// ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
// ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

// This program is a code generator plugin for `capnp compile` which generates JavaScript code.

#include <capnp/schema.capnp.h>
#include <capnp/serialize.h>
#include <kj/debug.h>
#include <kj/io.h>
#include <kj/string-tree.h>
#include <kj/vector.h>
#include <capnp/schema-loader.h>
#include <capnp/dynamic.h>
#include <unistd.h>
#include <unordered_map>
#include <unordered_set>
#include <set>
#include <kj/main.h>
#include <algorithm>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <errno.h>

#if HAVE_CONFIG_H
#include "config.h"
#endif

#ifndef VERSION
#define VERSION "(unknown)"
#endif

namespace capnp {
namespace {

static constexpr uint64_t NAMESPACE_ANNOTATION_ID = 0xb9c6f99ebf805f2cull;
static constexpr uint64_t JS_NAMESPACE_ANNOTATION_ID = 0x8db73c0d097e6e8bull;

static kj::String indent(int depth) {
  return kj::strTree(kj::repeat(' ', depth * 2)).flatten();
}

void enumerateDeps(schema::Type::Reader type, std::set<uint64_t>& deps) {
  switch (type.which()) {
    case schema::Type::STRUCT:
      deps.insert(type.getStruct().getTypeId());
      break;
    case schema::Type::ENUM:
      deps.insert(type.getEnum().getTypeId());
      break;
    case schema::Type::INTERFACE:
      deps.insert(type.getInterface().getTypeId());
      break;
    case schema::Type::LIST:
      enumerateDeps(type.getList().getElementType(), deps);
      break;
    default:
      break;
  }
}

void enumerateDeps(schema::Node::Reader node, std::set<uint64_t>& deps) {
  switch (node.which()) {
    case schema::Node::STRUCT: {
      auto structNode = node.getStruct();
      for (auto field: structNode.getFields()) {
        switch (field.which()) {
          case schema::Field::SLOT:
            enumerateDeps(field.getSlot().getType(), deps);
            break;
          case schema::Field::GROUP:
            deps.insert(field.getGroup().getTypeId());
            break;
        }
      }
      if (structNode.getIsGroup()) {
        deps.insert(node.getScopeId());
      }
      break;
    }
    case schema::Node::INTERFACE:
      for (auto method: node.getInterface().getMethods()) {
        for (auto param: method.getParams()) {
          enumerateDeps(param.getType(), deps);
        }
        enumerateDeps(method.getReturnType(), deps);
      }
      break;
    default:
      break;
  }
}

struct OrderByName {
  template <typename T>
  inline bool operator()(const T& a, const T& b) const {
    return a.getProto().getName() < b.getProto().getName();
  }
};

template <typename MemberList>
kj::Array<uint> makeMembersByName(MemberList&& members) {
  auto sorted = KJ_MAP(member, members) { return member; };
  std::sort(sorted.begin(), sorted.end(), OrderByName());
  return KJ_MAP(member, sorted) { return member.getIndex(); };
}

kj::StringPtr baseName(kj::StringPtr path) {
  KJ_IF_MAYBE(slashPos, path.findLast('/')) {
    return path.slice(*slashPos + 1);
  } else {
    return path;
  }
}

// =======================================================================================

class CapnpcJavaScriptMain {
public:
  CapnpcJavaScriptMain(kj::ProcessContext& context): context(context) {}

  kj::MainFunc getMain() {
    return kj::MainBuilder(context, "Cap'n Proto JavaScript plugin version " VERSION,
                           "This is a Cap'n Proto compiler plugin which generates JavaScript code. "
                           "It is meant to be run using the Cap'n Proto compiler, e.g.:\n"
                           "    capnp compile -ojs foo.capnp")
    .callAfterParsing(KJ_BIND_METHOD(*this, run))
    .build();
  }

private:
  kj::ProcessContext& context;
  SchemaLoader schemaLoader;
  std::unordered_set<uint64_t> usedImports;

  kj::StringTree cppFullName(schema::CodeGeneratorRequest::RequestedFile::Reader request, Schema schema) {
    auto node = schema.getProto();
    if (node.getScopeId() == 0) {
      usedImports.insert(node.getId());
      for (auto annotation: node.getAnnotations()) {
        if (annotation.getId() == JS_NAMESPACE_ANNOTATION_ID) {
          return kj::strTree("capnp_generated_", kj::hex(node.getId()));
        }
      }
      if (request.getId() == node.getId()) {
        return kj::strTree("module");
      }
      else {
        return kj::strTree("import_", kj::hex(node.getId()));
      }
    } else {
      Schema parent = schemaLoader.get(node.getScopeId());
      for (auto nested: parent.getProto().getNestedNodes()) {
        if (nested.getId() == node.getId()) {
          return kj::strTree(cppFullName(request, parent), ".", nested.getName());
        }
      }
      KJ_FAIL_REQUIRE("A schema Node's supposed scope did not contain the node as a NestedNode.");
    }
  }

  kj::String toUpperCase(kj::StringPtr name) {
    kj::Vector<char> result(name.size() + 4);

    for (char c: name) {
      if ('a' <= c && c <= 'z') {
        result.add(c - 'a' + 'A');
      } else if (result.size() > 0 && 'A' <= c && c <= 'Z') {
        result.add('_');
        result.add(c);
      } else {
        result.add(c);
      }
    }

    result.add('\0');

    return kj::String(result.releaseAsArray());
  }

  kj::String toTitleCase(kj::StringPtr name) {
    kj::String result = kj::heapString(name);
    if ('a' <= result[0] && result[0] <= 'z') {
      result[0] = result[0] - 'a' + 'A';
    }
    return kj::mv(result);
  }

  kj::StringTree typeNameShort(schema::Type::Which type) {
    switch (type) {
      case schema::Type::BOOL: return kj::strTree("bool");
      case schema::Type::INT8: return kj::strTree("int8");
      case schema::Type::INT16: return kj::strTree("int16");
      case schema::Type::INT32: return kj::strTree("int32");
      case schema::Type::INT64: return kj::strTree("int64");
      case schema::Type::UINT8: return kj::strTree("uint8");
      case schema::Type::UINT16: return kj::strTree("uint16");
      case schema::Type::UINT32: return kj::strTree("uint32");
      case schema::Type::UINT64: return kj::strTree("uint64");
      case schema::Type::FLOAT32: return kj::strTree("float32");
      case schema::Type::FLOAT64: return kj::strTree("float64");
      case schema::Type::ENUM: return kj::strTree("uint16");
      default: return kj::strTree("");
    }
  }

  kj::StringTree typeNameShort(schema::Type::Reader type) {
    return typeNameShort(type.which());
  }

  kj::StringTree typeName(schema::CodeGeneratorRequest::RequestedFile::Reader request, schema::Type::Reader type) {
    switch (type.which()) {
      case schema::Type::VOID: return kj::strTree("capnp.prim.Void");

      case schema::Type::BOOL: return kj::strTree("capnp.prim.bool");
      case schema::Type::INT8: return kj::strTree("capnp.prim.int8_t");
      case schema::Type::INT16: return kj::strTree("capnp.prim.int16_t");
      case schema::Type::INT32: return kj::strTree("capnp.prim.int32_t");
      case schema::Type::INT64: return kj::strTree("capnp.prim.int64_t");
      case schema::Type::UINT8: return kj::strTree("capnp.prim.uint8_t");
      case schema::Type::UINT16: return kj::strTree("capnp.prim.uint16_t");
      case schema::Type::UINT32: return kj::strTree("capnp.prim.uint32_t");
      case schema::Type::UINT64: return kj::strTree("capnp.prim.uint64_t");
      case schema::Type::FLOAT32: return kj::strTree("capnp.prim.float32_t");
      case schema::Type::FLOAT64: return kj::strTree("capnp.prim.float64_t");

      case schema::Type::TEXT: return kj::strTree("capnp.blob.Text");
      case schema::Type::DATA: return kj::strTree("capnp.blob.Data");

      case schema::Type::ENUM:
        return cppFullName(request, schemaLoader.get(type.getEnum().getTypeId()));
      case schema::Type::STRUCT:
        return cppFullName(request, schemaLoader.get(type.getStruct().getTypeId()));
      case schema::Type::INTERFACE:
        return cppFullName(request, schemaLoader.get(type.getInterface().getTypeId()));

      case schema::Type::LIST:
        switch (type.getList().getElementType().which()) {
          case schema::Value::STRUCT:
          case schema::Value::INTERFACE:
          case schema::Value::OBJECT:
            return kj::strTree("capnp.list.ListOfStructs(", typeName(request, type.getList().getElementType()), ")");
          case schema::Value::LIST:
            return kj::strTree("capnp.list.ListOfLists(", typeName(request, type.getList().getElementType()), ")");
          case schema::Value::TEXT:
            return kj::strTree("capnp.list.ListOfBlobs(capnp.blob.Text)");
          case schema::Value::DATA:
            return kj::strTree("capnp.list.ListOfBlobs(capnp.blob.Data)");
          case schema::Value::ENUM:
            return kj::strTree("capnp.list.ListOfEnums(", typeName(request, type.getList().getElementType()), ")");
          default:
            return kj::strTree("capnp.list.ListOfPrimitives(", typeName(request, type.getList().getElementType()), ")");
        }

      case schema::Type::OBJECT:
        // Not used.
        return kj::strTree();
    }
    KJ_UNREACHABLE;
  }

  kj::StringTree literalValue(schema::CodeGeneratorRequest::RequestedFile::Reader request, schema::Type::Reader type, schema::Value::Reader value) {
    switch (value.which()) {
      case schema::Value::VOID: return kj::strTree("undefined");
      case schema::Value::BOOL: return kj::strTree(value.getBool() ? "true" : "false");
      case schema::Value::INT8: return kj::strTree(value.getInt8());
      case schema::Value::INT16: return kj::strTree(value.getInt16());
      case schema::Value::INT32: return kj::strTree(value.getInt32());
      case schema::Value::UINT8: return kj::strTree(value.getUint8());
      case schema::Value::UINT16: return kj::strTree(value.getUint16());
      case schema::Value::UINT32: return kj::strTree(value.getUint32());
      case schema::Value::INT64:
        return kj::strTree("[", value.getInt64() >> 32, ", ", value.getInt64() & 0xffffffff, "]");
      case schema::Value::UINT64:
        return kj::strTree("[", value.getUint64() >> 32, ", ", value.getUint64() & 0xffffffff, "]");
      case schema::Value::FLOAT32: return kj::strTree(value.getFloat32());
      case schema::Value::FLOAT64: return kj::strTree(value.getFloat64());
      case schema::Value::ENUM: {
        EnumSchema schema = schemaLoader.get(type.getEnum().getTypeId()).asEnum();
        if (value.getEnum() < schema.getEnumerants().size()) {
          return kj::strTree(
              cppFullName(request, schema), ".",
              toUpperCase(schema.getEnumerants()[value.getEnum()].getProto().getName()));
        } else {
          return kj::strTree("static_cast<", cppFullName(request, schema), ">(", value.getEnum(), ")");
        }
      }

      case schema::Value::TEXT:
      case schema::Value::DATA:
      case schema::Value::STRUCT:
      case schema::Value::INTERFACE:
      case schema::Value::LIST:
      case schema::Value::OBJECT:
        KJ_FAIL_REQUIRE("literalValue() can only be used on primitive types.");
    }
    KJ_UNREACHABLE;
  }

  // -----------------------------------------------------------------
  // Code to deal with "slots" -- determines what to zero out when we clear a group.

  static uint typeSizeBits(schema::Type::Which whichType) {
    switch (whichType) {
      case schema::Type::BOOL: return 1;
      case schema::Type::INT8: return 8;
      case schema::Type::INT16: return 16;
      case schema::Type::INT32: return 32;
      case schema::Type::INT64: return 64;
      case schema::Type::UINT8: return 8;
      case schema::Type::UINT16: return 16;
      case schema::Type::UINT32: return 32;
      case schema::Type::UINT64: return 64;
      case schema::Type::FLOAT32: return 32;
      case schema::Type::FLOAT64: return 64;
      case schema::Type::ENUM: return 16;

      case schema::Type::VOID:
      case schema::Type::TEXT:
      case schema::Type::DATA:
      case schema::Type::LIST:
      case schema::Type::STRUCT:
      case schema::Type::INTERFACE:
      case schema::Type::OBJECT:
        KJ_FAIL_REQUIRE("Should only be called for data types.");
    }
    KJ_UNREACHABLE;
  }

  enum class Section {
    NONE,
      DATA,
      POINTERS
    };

  static Section sectionFor(schema::Type::Which whichType) {
    switch (whichType) {
      case schema::Type::VOID:
        return Section::NONE;
      case schema::Type::BOOL:
      case schema::Type::INT8:
      case schema::Type::INT16:
      case schema::Type::INT32:
      case schema::Type::INT64:
      case schema::Type::UINT8:
      case schema::Type::UINT16:
      case schema::Type::UINT32:
      case schema::Type::UINT64:
      case schema::Type::FLOAT32:
      case schema::Type::FLOAT64:
      case schema::Type::ENUM:
        return Section::DATA;
      case schema::Type::TEXT:
      case schema::Type::DATA:
      case schema::Type::LIST:
      case schema::Type::STRUCT:
      case schema::Type::INTERFACE:
      case schema::Type::OBJECT:
        return Section::POINTERS;
    }
    KJ_UNREACHABLE;
  }

  struct Slot {
    schema::Type::Which whichType;
    uint offset;

    bool isSupersetOf(Slot other) const {
      auto section = sectionFor(whichType);
      if (section != sectionFor(other.whichType)) return false;
      switch (section) {
        case Section::NONE:
          return true;  // all voids overlap
        case Section::DATA: {
          auto bits = typeSizeBits(whichType);
          auto start = offset * bits;
          auto otherBits = typeSizeBits(other.whichType);
          auto otherStart = other.offset * otherBits;
          return start <= otherStart && otherStart + otherBits <= start + bits;
        }
        case Section::POINTERS:
          return offset == other.offset;
      }
      KJ_UNREACHABLE;
    }

    bool operator<(Slot other) const {
      // Sort by section, then start position, and finally size.

      auto section = sectionFor(whichType);
      auto otherSection = sectionFor(other.whichType);
      if (section < otherSection) {
        return true;
      } else if (section > otherSection) {
        return false;
      }

      switch (section) {
        case Section::NONE:
          return false;
        case Section::DATA: {
          auto bits = typeSizeBits(whichType);
          auto start = offset * bits;
          auto otherBits = typeSizeBits(other.whichType);
          auto otherStart = other.offset * otherBits;
          if (start < otherStart) {
            return true;
          } else if (start > otherStart) {
            return false;
          }

          // Sort larger sizes before smaller.
          return bits > otherBits;
        }
        case Section::POINTERS:
          return offset < other.offset;
      }
      KJ_UNREACHABLE;
    }
  };

  void getSlots(StructSchema schema, kj::Vector<Slot>& slots) {
    auto structProto = schema.getProto().getStruct();
    if (structProto.getDiscriminantCount() > 0) {
      slots.add(Slot { schema::Type::UINT16, structProto.getDiscriminantOffset() });
    }

    for (auto field: schema.getFields()) {
      auto proto = field.getProto();
      switch (proto.which()) {
        case schema::Field::SLOT: {
          auto slot = proto.getSlot();
          slots.add(Slot { slot.getType().which(), slot.getOffset() });
          break;
        }
        case schema::Field::GROUP:
          getSlots(schema.getDependency(proto.getGroup().getTypeId()).asStruct(), slots);
          break;
      }
    }
  }

  kj::Array<Slot> getSortedSlots(StructSchema schema) {
    // Get a representation of all of the field locations owned by this schema, e.g. so that they
    // can be zero'd out.

    kj::Vector<Slot> slots(schema.getFields().size());
    getSlots(schema, slots);
    std::sort(slots.begin(), slots.end());

    kj::Vector<Slot> result(slots.size());

    // All void slots are redundant, and they sort towards the front of the list.  By starting out
    // with `prevSlot` = void, we will end up skipping them all, which is what we want.
    Slot prevSlot = { schema::Type::VOID, 0 };
    for (auto slot: slots) {
      if (prevSlot.isSupersetOf(slot)) {
        // This slot is redundant as prevSlot is a superset of it.
        continue;
      }

      // Since all sizes are power-of-two, if two slots overlap at all, one must be a superset of
      // the other.  Since we sort slots by starting position, we know that the only way `slot`
      // could be a superset of `prevSlot` is if they have the same starting position.  However,
      // since we sort slots with the same starting position by descending size, this is not
      // possible.
      KJ_DASSERT(!slot.isSupersetOf(prevSlot));

      result.add(slot);

      prevSlot = slot;
    }

    return result.releaseAsArray();
  }

  // -----------------------------------------------------------------

  struct DiscriminantChecks {
    kj::String has;
    kj::String check;
    kj::String set;
    kj::StringTree readerIsDecl;
    kj::StringTree builderIsDecl;
  };

  DiscriminantChecks makeDiscriminantChecks(kj::StringPtr scope,
                                            uint16_t discrimValue,
                                            kj::StringPtr memberName,
                                            StructSchema containingStruct,
                                            int outerIndent) {
    auto discrimOffset = containingStruct.getProto().getStruct().getDiscriminantOffset();
    kj::String titleCase = toTitleCase(memberName);
    kj::String upperCase = toUpperCase(memberName);

    return DiscriminantChecks {
      kj::str(
          "  if (this.which() != ", discrimValue, ") return false;\n"),
      kj::str(
          "  if (this.which() != ", discrimValue, ") throw new Error(\"Must check which() before get()ing a union member.\");\n"),
      kj::str("_builder.setDataField_uint16(", discrimOffset, ", ", discrimValue, ");\n"),
      kj::strTree(indent(outerIndent), "this.is", titleCase, " = function() { return this.which() === ", scope, upperCase, "; };\n"),
      kj::strTree(indent(outerIndent), "this.is", titleCase, " = function() { return this.which() === ", scope, upperCase, "; };\n")
      };
  }

  // -----------------------------------------------------------------

  struct FieldText {
    kj::StringTree readerMethodDecls;
    kj::StringTree builderMethodDecls;
  };

  enum class FieldKind {
    PRIMITIVE,
      BLOB,
      STRUCT,
      LIST,
      INTERFACE,
      OBJECT
    };

  FieldText makeFieldText(schema::CodeGeneratorRequest::RequestedFile::Reader request, kj::StringPtr scope, StructSchema::Field field, int outerIndent) {
    auto proto = field.getProto();
    kj::String titleCase = toTitleCase(proto.getName());
    auto fullName = kj::str(scope, titleCase);

    DiscriminantChecks unionDiscrim;
    if (proto.hasDiscriminantValue()) {
      unionDiscrim = makeDiscriminantChecks(scope, proto.getDiscriminantValue(), proto.getName(), field.getContainingStruct(), outerIndent);
    }

    switch (proto.which()) {
      case schema::Field::SLOT:
        // Continue below.
        break;

      case schema::Field::GROUP: {
        auto slots = getSortedSlots(schemaLoader.get(
                                        field.getProto().getGroup().getTypeId()).asStruct());
        return FieldText {
          kj::strTree(
              kj::mv(unionDiscrim.readerIsDecl),
              indent(outerIndent), "this.has", titleCase, " = function() {\n",
              indent(outerIndent + 2), "return ",

              kj::StringTree(KJ_MAP(slot, slots) {
                  kj::String suffix = typeNameShort(slot.whichType).flatten();
                  switch (sectionFor(slot.whichType)) {
                    case Section::NONE:
                      return kj::strTree();
                    case Section::DATA:
                      return kj::strTree("_reader.hasDataField_", suffix, "(", slot.offset, ")");
                    case Section::POINTERS:
                      return kj::strTree(
                          "!_reader.isPointerFieldNull(", slot.offset, ")");
                  }
                  KJ_UNREACHABLE;
                }, kj::strTree("\n", indent(outerIndent + 2), "       || ").flatten()),
              ";\n",
              indent(outerIndent), "};\n",
              indent(outerIndent), "this.get", titleCase, " = function() { return new module.", fullName, ".Reader(_reader); };\n",
              "\n"),

          kj::strTree(
              kj::mv(unionDiscrim.builderIsDecl),
              indent(outerIndent), "this.has", titleCase, " = function() {\n",
              indent(outerIndent + 2), "return ",

              kj::StringTree(KJ_MAP(slot, slots) {
                  kj::String suffix = typeNameShort(slot.whichType).flatten();
                  switch (sectionFor(slot.whichType)) {
                    case Section::NONE:
                      return kj::strTree();
                    case Section::DATA:
                      return kj::strTree("_builder.hasDataField_", suffix, "(", slot.offset, ")");
                    case Section::POINTERS:
                      return kj::strTree(
                          "!_builder.isPointerFieldNull(", slot.offset, ")");
                  }
                  KJ_UNREACHABLE;
                }, kj::strTree("\n", indent(outerIndent + 2), "       || ").flatten()),
              ";\n",
              indent(outerIndent), "};\n",
              indent(outerIndent), "this.get", titleCase, " = function() { return new module.", fullName, ".Builder(_builder); };\n",
              indent(outerIndent), "this.init", titleCase, " = function() {\n",

              indent(outerIndent + 2), unionDiscrim.set, "\n",
              indent(outerIndent + 2),
              kj::StringTree(KJ_MAP(slot, slots) {
                  kj::String suffix = typeNameShort(slot.whichType).flatten();
                  switch (sectionFor(slot.whichType)) {
                    case Section::NONE:
                      return kj::strTree();
                    case Section::DATA:
                      return kj::strTree("_builder.setDataField_", suffix, "(", slot.offset, ", 0)");
                    case Section::POINTERS:
                      return kj::strTree(
                          "_builder.clearPointerField(", slot.offset, ");");
                  }
                  KJ_UNREACHABLE;
                }, kj::strTree("\n", indent(outerIndent + 2), "").flatten()),
              "\n",
              indent(outerIndent + 2), "return new module.", fullName, ".Builder(_builder);\n",
              indent(outerIndent), "};\n",
              "\n"),
          };
      }
    }

    auto slot = proto.getSlot();

    FieldKind kind = FieldKind::PRIMITIVE;
    kj::String ownedType;
    kj::String type = typeName(request, slot.getType()).flatten();
    kj::String suffix = typeNameShort(slot.getType()).flatten();
    kj::String defaultMask;       // primitives only
    size_t defaultOffset = 0;     // pointers only: offset of the default value within the schema.
    size_t defaultSize = 0;       // blobs only: byte size of the default value.

    auto typeBody = slot.getType();
    auto defaultBody = slot.getDefaultValue();
    switch (typeBody.which()) {
      case schema::Type::VOID:
        kind = FieldKind::PRIMITIVE;
        break;

#define HANDLE_PRIMITIVE(discrim, typeName, defaultName, suffix)        \
        case schema::Type::discrim:                                     \
          kind = FieldKind::PRIMITIVE;                                  \
          if (defaultBody.get##defaultName() != 0) {                    \
            defaultMask = kj::str(defaultBody.get##defaultName() /*, #suffix*/); \
          }                                                             \
          break;

        HANDLE_PRIMITIVE(BOOL, bool, Bool, );
        HANDLE_PRIMITIVE(INT8 , ::int8_t , Int8 , );
        HANDLE_PRIMITIVE(INT16, ::int16_t, Int16, );
        HANDLE_PRIMITIVE(INT32, ::int32_t, Int32, );
        HANDLE_PRIMITIVE(UINT8 , ::uint8_t , Uint8 , u);
        HANDLE_PRIMITIVE(UINT16, ::uint16_t, Uint16, u);
        HANDLE_PRIMITIVE(UINT32, ::uint32_t, Uint32, u);
#undef HANDLE_PRIMITIVE

      case schema::Type::INT64:
        kind = FieldKind::PRIMITIVE;
        if (defaultBody.getInt64() != 0) {
          int32_t hi = (defaultBody.getInt64() >> 32);
          int32_t lo = static_cast<int32_t>(defaultBody.getUint64() & 0xffffffff);
          defaultMask = kj::strTree("[", hi, ", ", lo, "]").flatten();
        }
        break;

      case schema::Type::UINT64:
        kind = FieldKind::PRIMITIVE;
        if (defaultBody.getUint64() != 0) {
          defaultMask = kj::strTree("[", (defaultBody.getUint64() >> 32), ", ", (defaultBody.getUint64() & 0xffffffff), "]").flatten();
        }
        break;

      case schema::Type::FLOAT32:
        kind = FieldKind::PRIMITIVE;
        if (defaultBody.getFloat32() != 0) {
          uint32_t mask;
          float value = defaultBody.getFloat32();
          static_assert(sizeof(mask) == sizeof(value), "bug");
          memcpy(&mask, &value, sizeof(mask));
          defaultMask = kj::str(mask);
        }
        break;

      case schema::Type::FLOAT64:
        kind = FieldKind::PRIMITIVE;
        if (defaultBody.getFloat64() != 0) {
          uint64_t mask;
          double value = defaultBody.getFloat64();
          static_assert(sizeof(mask) == sizeof(value), "bug");
          memcpy(&mask, &value, sizeof(mask));
          defaultMask = kj::strTree("[", (mask >> 32), ", ", (mask & 0xffffffff), "]").flatten();
        }
        break;

      case schema::Type::TEXT:
        kind = FieldKind::BLOB;
        if (defaultBody.hasText()) {
          defaultOffset = field.getDefaultValueSchemaOffset();
          defaultSize = defaultBody.getText().size();
        }
        break;
      case schema::Type::DATA:
        kind = FieldKind::BLOB;
        if (defaultBody.hasData()) {
          defaultOffset = field.getDefaultValueSchemaOffset();
          defaultSize = defaultBody.getData().size();
        }
        break;

      case schema::Type::ENUM:
        kind = FieldKind::PRIMITIVE;
        if (defaultBody.getEnum() != 0) {
          defaultMask = kj::str(defaultBody.getEnum());
        }
        type = kj::str("capnp.uint16_t");
        break;

      case schema::Type::STRUCT:
        kind = FieldKind::STRUCT;
        if (defaultBody.hasStruct()) {
          defaultOffset = field.getDefaultValueSchemaOffset();
        }
        break;
      case schema::Type::LIST:
        kind = FieldKind::LIST;
        if (defaultBody.hasList()) {
          defaultOffset = field.getDefaultValueSchemaOffset();
        }
        break;
      case schema::Type::INTERFACE:
        kind = FieldKind::INTERFACE;
        break;
      case schema::Type::OBJECT:
        kind = FieldKind::OBJECT;
        if (defaultBody.hasObject()) {
          defaultOffset = field.getDefaultValueSchemaOffset();
        }
        break;
    }

    kj::String defaultMaskParam;
    kj::String defaultMaskSuffix;
    if (defaultMask.size() > 0) {
      defaultMaskParam = kj::str(", ", defaultMask);
      defaultMaskSuffix = kj::str("_masked");
    }

    uint offset = slot.getOffset();

    if (kind == FieldKind::PRIMITIVE) {

      kj::String hasGetter;
      kj::String builderHasGetter;
      kj::String getter;
      kj::String builderGetter;
      kj::String setter;

      switch (slot.getType().which()) {

        case schema::Type::VOID:
          hasGetter = kj::strTree("this.has", titleCase, " = function() { ", unionDiscrim.has, "return false; };\n").flatten();
          builderHasGetter = kj::strTree("this.has", titleCase, " = function() { ", unionDiscrim.has, "return false; };\n").flatten();
          getter = kj::strTree("this.get", titleCase, " = function() { ", unionDiscrim.check, "return undefined; };\n").flatten();
          builderGetter = kj::strTree("this.get", titleCase, " = function() { ", unionDiscrim.check, "return undefined; };\n").flatten();
          setter = kj::strTree("this.set", titleCase, " = function(val) { ", unionDiscrim.set, " };\n").flatten();
          break;

        case schema::Type::ENUM:
        case schema::Type::INT8:
        case schema::Type::INT16:
        case schema::Type::INT32:
        case schema::Type::UINT8:
        case schema::Type::UINT16:
        case schema::Type::UINT32:
        case schema::Type::FLOAT32:
        case schema::Type::FLOAT64:
        case schema::Type::INT64:
        case schema::Type::UINT64:
        case schema::Type::BOOL:
          hasGetter = kj::strTree("this.has", titleCase, " = function() { ", unionDiscrim.has, "return _reader.hasDataField_", suffix, defaultMaskSuffix, "(", offset, "); };\n").flatten();
          builderHasGetter = kj::strTree("this.has", titleCase, " = function() { ", unionDiscrim.has, "return _builder.hasDataField_", suffix, defaultMaskSuffix, "(", offset, "); };\n").flatten();
          getter = kj::strTree("this.get", titleCase, " = function() { ", unionDiscrim.check, "return _reader.getDataField_", suffix, defaultMaskSuffix, "(", offset, defaultMaskParam, "); };\n").flatten();
          builderGetter = kj::strTree("this.get", titleCase, " = function() { ", unionDiscrim.check, "return _builder.getDataField_", suffix, defaultMaskSuffix, "(", offset, defaultMaskParam, "); };\n").flatten();
          setter = kj::strTree("this.set", titleCase, " = function(value) { ", unionDiscrim.set, "_builder.setDataField_", suffix, defaultMaskSuffix, "(", offset, defaultMaskParam, ", value); };\n").flatten();

          break;

        default:
          hasGetter = kj::strTree("this.has", titleCase, " = function() { ", unionDiscrim.has, "return seg.getUint32(", offset, ") !== 0 && seg.getUint32(", offset + 4, ") !== 0; };\n").flatten();
          builderHasGetter = kj::strTree("this.has", titleCase, " = function() { ", unionDiscrim.has, "return seg.getUint32(", offset, ") !== 0 && seg.getUint32(", offset + 4, ") !== 0; };\n").flatten();
          getter = kj::strTree("this.get", titleCase, " = function() { ", unionDiscrim.check, "return ", type, ".Reader(msg, seg, ofs + ", (offset * 8), defaultMaskParam, "); };\n").flatten();
          setter = kj::strTree("this.set", titleCase, " = function(value) { ", unionDiscrim.set, type, ".Builder(msg, seg, ofs + ", (offset * 8), defaultMaskParam, ").set(value); };\n").flatten();
          builderGetter = kj::strTree("this.get", titleCase, " = function() { return new ", type, ".Builder(_builder); };\n").flatten();
      }


      return FieldText {
        kj::strTree(
            kj::mv(unionDiscrim.readerIsDecl),
            indent(outerIndent), hasGetter,
            indent(outerIndent), getter,
            "\n"),

        kj::strTree(
            kj::mv(unionDiscrim.builderIsDecl),
            indent(outerIndent), builderHasGetter,
            indent(outerIndent), builderGetter,
            indent(outerIndent), setter,
            "\n"),
        };

    } else if (kind == FieldKind::INTERFACE) {
      // Not implemented.
      return FieldText { kj::strTree(), kj::strTree() };

    } else if (kind == FieldKind::OBJECT) {
      return FieldText {
        kj::strTree(
            kj::mv(unionDiscrim.readerIsDecl),
            indent(outerIndent), "this.has", titleCase, " = function() { ", unionDiscrim.has, "return !_reader.isPointerFieldNull(", offset, "); };\n",
            indent(outerIndent), "this.get", titleCase, " = function(type) { return capnp.genhelper.objectGetFromReader(type, _reader, ", offset, "); },\n",
            "\n"),

        kj::strTree(
            kj::mv(unionDiscrim.builderIsDecl),
            indent(outerIndent), "this.has", titleCase, " = function() { ", unionDiscrim.has, "return !_builder.isPointerFieldNull(", offset, "); };\n",
            indent(outerIndent), "this.get", titleCase, " = function(type) { return capnp.genhelper.objectGetFromBuilder(type, _builder, ", offset, "); };\n",
            indent(outerIndent), "this.set", titleCase, " = function(type, value) { capnp.genhelper.objectSet(type, _builder, ", offset, ", value); };\n",
            indent(outerIndent), "this.init", titleCase, " = function(type, arg /* , arg... */) { return capnp.genhelper.objectInit(_builder, ", offset, ", arguments); };\n",
            indent(outerIndent), "this.adopt", titleCase, " = function(type, value) { return capnp.genhelper.objectAdopt(type, _builder, ", offset, ", value); };\n",
            indent(outerIndent), "this.disown", titleCase, " = function(type) { return capnp.genhelper.objectDisown(type, _builder, ", offset, "); };\n",
            "\n")
        };

    } else {
      // Blob, struct, or list.  These have only minor differences.

      uint64_t typeId = field.getContainingStruct().getProto().getId();

      kj::String defaultParam = defaultOffset == 0 ? kj::str() : kj::str(", new Uint8Array(schemas['", kj::hex(typeId), "']).buffer.slice(", defaultOffset * 8, ")", defaultSize == 0 ? kj::strTree() : kj::strTree(", ", defaultSize));

      kj::String elementReaderType;
      bool isStructList = false;
      if (kind == FieldKind::LIST) {
        bool primitiveElement = false;
        switch (typeBody.getList().getElementType().which()) {
          case schema::Type::VOID:
          case schema::Type::BOOL:
          case schema::Type::INT8:
          case schema::Type::INT16:
          case schema::Type::INT32:
          case schema::Type::INT64:
          case schema::Type::UINT8:
          case schema::Type::UINT16:
          case schema::Type::UINT32:
          case schema::Type::UINT64:
          case schema::Type::FLOAT32:
          case schema::Type::FLOAT64:
          case schema::Type::ENUM:
            primitiveElement = true;
            break;

          case schema::Type::TEXT:
          case schema::Type::DATA:
          case schema::Type::LIST:
          case schema::Type::INTERFACE:
          case schema::Type::OBJECT:
            primitiveElement = false;
            break;

          case schema::Type::STRUCT:
            isStructList = true;
            primitiveElement = false;
            break;
        }
        elementReaderType = kj::str(
            typeName(request, typeBody.getList().getElementType()),
            primitiveElement ? "" : "::Reader");
      }

      return FieldText {
        kj::strTree(
            kj::mv(unionDiscrim.readerIsDecl),
            indent(outerIndent), "this.has", titleCase, " = function() { return !_reader.isPointerFieldNull(", offset, "); };\n",
            kind == FieldKind::STRUCT ?
            kj::strTree(indent(outerIndent), "this.get", titleCase, " = function() { return new ", type, ".Reader(_reader.getStructField(", offset, defaultParam, ")); };\n")
            :
            kj::strTree(indent(outerIndent), "this.get", titleCase, " = function() { return ", type, ".getReader(_reader, ", offset, defaultParam, "); };\n"),
            "\n"),

        kj::strTree(
            kj::mv(unionDiscrim.builderIsDecl),
            indent(outerIndent), "this.has", titleCase, " = function() { return !_builder.isPointerFieldNull(", offset, "); };\n",
            kind == FieldKind::STRUCT
            ? kj::strTree(indent(outerIndent), "this.get", titleCase, " = function() { return new ", type, ".Builder(_builder.getStructField(", offset, ", module.", scope, "STRUCT_SIZE", defaultParam, ")); };\n")
            : kj::strTree(indent(outerIndent), "this.get", titleCase, " = function() { return ", type, ".getBuilder(_builder, ", offset, defaultParam, "); };\n"),

            indent(outerIndent), "this.set", titleCase, " = function(val) { ", unionDiscrim.set,

            kind == FieldKind::BLOB
            ? ((slot.getType().which() == schema::Type::TEXT) ? kj::strTree("capnp.genhelper.textBlobSet(_builder, ", offset, ", val); };\n") : kj::strTree("capnp.genhelper.dataBlobSet(_builder, ", offset, ", val); };\n"))
            : (kind == FieldKind::LIST
               ? kj::strTree("capnp.genhelper.listSet(", type, ", _builder, ", offset, ", val); };\n")
               : kj::strTree("capnp.genhelper.structSet(", type, ", _builder, ", offset, ", val); };\n")),

            kind == FieldKind::LIST && !isStructList
            ? kj::strTree()
            : kj::strTree(),

            kind == FieldKind::STRUCT
            ? kj::strTree(indent(outerIndent), "this.init", titleCase, " = function(size) {\n",
                          indent(outerIndent + 2), "return new ", type, ".Builder(_builder.initStructField(", offset, ", ", type, ".STRUCT_SIZE));\n",
                          indent(outerIndent), "};\n")
            : isStructList ? kj::strTree(indent(outerIndent), "this.init", titleCase, " = function(size) { return ", type, ".initBuilder(_builder, ", offset,  ", size); };\n") :

            kj::strTree(indent(outerIndent), "this.init", titleCase, " = function(size) { return new ", type, ".initBuilder(_builder, ", offset,  ", size); };\n"),
            indent(outerIndent), "this.adopt", titleCase, " = function(val) { capnp.genhelper.structAdopt(", type, ", _builder, ", offset, ", val); };;\n",

            indent(outerIndent), "this.disown", titleCase, " = function() { ",
            kind == FieldKind::BLOB
            ? ((slot.getType().which() == schema::Type::TEXT) ? kj::strTree("return capnp.genhelper.textBlobDisown(_builder, ", offset, "); };\n") : kj::strTree("return capnp.genhelper.dataBlobDisown(_builder, ", offset, "); };\n"))
            : (kind == FieldKind::LIST
               ? kj::strTree("return capnp.genhelper.listDisown(", type, ", _builder, ", offset, "); };\n")
               : kj::strTree("return capnp.genhelper.structDisown(", type, ", _builder, ", offset, "); };\n")),

            "\n")
        };
    }
  }

  // -----------------------------------------------------------------

  kj::StringTree makeReaderDef(Schema schema, kj::StringPtr fullName, kj::StringPtr unqualifiedParentType,
                               bool isUnion, kj::Array<kj::StringTree>&& methodDecls, kj::Array<kj::String>& fieldNames, kj::StringPtr name, int outerIndent) {
    auto structNode = schema.asStruct().getProto().getStruct();
    return kj::strTree(
        "\n",
        indent(outerIndent), "STRUCT_SIZE: new capnp.genhelper.StructSize(", structNode.getDataWordCount(), ", ", structNode.getPointerCount(), ", ", static_cast<uint>(structNode.getPreferredListEncoding()), "),\n",
        indent(outerIndent), "ELEMENT_SIZE: 7, // FieldSize::INLINE_COMPOSITE\n",
        indent(outerIndent), "FIELD_LIST: [", kj::StringTree(KJ_MAP(n, fieldNames) { return kj::strTree("\"", n, "\""); }, ", ").flatten(), "],\n",
        "\n",
        indent(outerIndent), "toString: function() { return '", fullName, "'; },\n",

        indent(outerIndent), "getOrphanReader: function(builder) { return new this.Reader(builder.asStructReader(this.STRUCT_SIZE)); },\n",
        indent(outerIndent), "getOrphan: function(builder) { return new this.Builder(builder.asStruct(this.STRUCT_SIZE)); },\n",

        indent(outerIndent), "copyOrphan: capnp.layout.OrphanBuilder.copyStruct,\n",

        indent(outerIndent), "Reader: function(_reader) {\n",
        indent(outerIndent + 1), "if (_reader === undefined) _reader = capnp.genhelper.NullStructReader;\n",
        indent(outerIndent + 1), "//return {\n"
        "\n",
        isUnion ? kj::strTree(indent(outerIndent + 2), "this.which = function() { return _reader.getDataField_uint16(", structNode.getDiscriminantOffset()  ,"); };\n") : kj::strTree(),
        kj::mv(methodDecls),
        indent(outerIndent+2), "this._getParentType = function() { return module.", fullName, "; };\n",
        indent(outerIndent+2), "this._getInnerReader = function() { return _reader; };\n",
        indent(outerIndent+2), "this.totalSizeInWords = function() { return _reader.totalSize(); };\n",
        indent(outerIndent+2), "this._getReader = function() { return _reader; };\n",
        indent(outerIndent+2), "this.GET_MEMBER = [", kj::StringTree(KJ_MAP(n, fieldNames) { return kj::strTree("this.get", toTitleCase(n)); }, ", ").flatten(), "];\n",
        indent(outerIndent+2), "this.HAS_MEMBER = [", kj::StringTree(KJ_MAP(n, fieldNames) { return kj::strTree("this.has", toTitleCase(n)); }, ", ").flatten(), "];\n",
        indent(outerIndent+2), "this.toString = function() { return capnp.genhelper.ToStringHelper(this, \"", name, ".Reader\", module.", fullName, ".FIELD_LIST, this.HAS_MEMBER, this.GET_MEMBER",
        isUnion? kj::strTree(", this.which()") : kj::strTree(""),
        "); }\n",
        indent(outerIndent + 1), "//};\n",
        indent(outerIndent), "},\n"
        "\n");
  }

  kj::StringTree makeBuilderDef(Schema schema, kj::StringPtr fullName, kj::StringPtr unqualifiedParentType,
                                bool isUnion, kj::Array<kj::StringTree>&& methodDecls, kj::Array<kj::String>& fieldNames, kj::StringPtr name, int outerIndent) {
    auto structNode = schema.asStruct().getProto().getStruct();
    return kj::strTree(
        indent(outerIndent), "Builder: function(_builder) {\n",
        indent(outerIndent+1), "//return {\n",
        isUnion ? kj::strTree(indent(outerIndent + 2), "this.which = function() { return _builder.getDataField_uint16(", structNode.getDiscriminantOffset()  ,"); };\n") : kj::strTree(),
        kj::mv(methodDecls),
        indent(outerIndent+2), "this.asReader = function() { return new module.", fullName, ".Reader(_builder.asReader()); };\n",
        //
        indent(outerIndent+2), "this.getReader = function() { return _builder.asReader(); };\n",
        indent(outerIndent+2), "this.totalSizeInWords = function() { return this.asReader().totalSizeInWords(); };\n",
        indent(outerIndent+2), "this.GET_MEMBER = [", kj::StringTree(KJ_MAP(n, fieldNames) { return kj::strTree("this.get", toTitleCase(n)); }, ", ").flatten(), "];\n",
        indent(outerIndent+2), "this.HAS_MEMBER = [", kj::StringTree(KJ_MAP(n, fieldNames) { return kj::strTree("this.has", toTitleCase(n)); }, ", ").flatten(), "];\n",
        indent(outerIndent+2), "this.toString = function() { return capnp.genhelper.ToStringHelper(this, \"", name,  ".Builder\", module.", fullName, ".FIELD_LIST, this.HAS_MEMBER, this.GET_MEMBER",
        isUnion? kj::strTree(", this.which()") : kj::strTree(""),
        "); }\n",
        indent(outerIndent+1), "//};\n",
        indent(outerIndent), "},\n"
        "\n");
  }

  // -----------------------------------------------------------------

  struct ConstText {
    bool needsSchema;
    kj::StringTree decl;
    kj::StringTree def;
  };

  ConstText makeConstText(schema::CodeGeneratorRequest::RequestedFile::Reader request, kj::StringPtr scope, kj::StringPtr name, ConstSchema schema, int outerIndent) {
    auto proto = schema.getProto();
    auto constProto = proto.getConst();
    auto type = constProto.getType();
    auto typeName_ = typeName(request, type).flatten();
    auto upperCase = toUpperCase(name);

    switch (type.which()) {
      case schema::Value::VOID:
      case schema::Value::BOOL:
      case schema::Value::INT8:
      case schema::Value::INT16:
      case schema::Value::INT32:
      case schema::Value::UINT8:
      case schema::Value::UINT16:
      case schema::Value::UINT32:
      case schema::Value::FLOAT32:
      case schema::Value::FLOAT64:
      case schema::Value::ENUM:
        return ConstText {
          false,
          kj::strTree(((scope.size() == 0) ?
                       kj::strTree(
                           indent(outerIndent + 1), "module.", upperCase, " = ",
                           literalValue(request, constProto.getType(), constProto.getValue()),
                           ";\n")
                       : 
                       kj::strTree(indent(outerIndent), upperCase, ": ",
                                   literalValue(request, constProto.getType(), constProto.getValue()),
                                   ",\n"))),
          scope.size() == 0 ? kj::strTree() : kj::strTree(
              "constexpr ", typeName_, ' ', scope, upperCase, ";\n")
          };

      case schema::Value::INT64:
      case schema::Value::UINT64:
        return ConstText {
          false,
          kj::strTree(((scope.size() == 0) ?
                       kj::strTree(indent(outerIndent + 1), "module.", upperCase, " = ",
                                   literalValue(request, constProto.getType(), constProto.getValue()), ";\n")
                       : 
                       kj::strTree(indent(outerIndent), upperCase, ": ",
                                   literalValue(request, constProto.getType(), constProto.getValue()), ",\n"))),
          scope.size() == 0 ? kj::strTree() : kj::strTree(
              "constexpr ", typeName_, ' ', scope, upperCase, ";\n")
          };

      case schema::Value::TEXT: {
        return ConstText {
          true,
            
          (scope.size() == 0)
          ? kj::strTree(indent(outerIndent + 1), "module.", upperCase,
                        " = new capnp.genhelper.ConstText(new Uint8Array(schemas['", kj::hex(proto.getId()), "']).buffer, ",
                        schema.getValueSchemaOffset(), ", ", schema.as<Text>().size(),");\n")
          : kj::strTree(indent(outerIndent), upperCase,
                        ": new capnp.genhelper.ConstText(new Uint8Array(schemas['", kj::hex(proto.getId()), "']).buffer, ",
                        schema.getValueSchemaOffset(), ", ", schema.as<Text>().size(),"),\n"),
          kj::strTree()
          };
      }

      case schema::Value::DATA: {
        return ConstText {
          true,

          (scope.size() == 0)
          ? kj::strTree(indent(outerIndent + 1), "module.", upperCase,
                        " = new capnp.genhelper.ConstData(new Uint8Array(schemas['", kj::hex(proto.getId()), "']).buffer, ",
                        schema.getValueSchemaOffset(), ", ", schema.as<Data>().size(),");\n")
          : kj::strTree(indent(outerIndent), upperCase, ": new capnp.genhelper.ConstData(new Uint8Array(schemas['", kj::hex(proto.getId()), "']).buffer, ",
                        schema.getValueSchemaOffset(), ", ", schema.as<Data>().size(),"),\n"),
          kj::strTree()
          };
      }

      case schema::Value::STRUCT: {
        return ConstText {
          true,

          (scope.size() == 0)
          ? kj::strTree(indent(outerIndent + 1), "module.", upperCase, " = new capnp.genhelper.ConstStruct(", typeName_,
                        ", new Uint8Array(schemas['", kj::hex(proto.getId()), "']).buffer, ",
                        schema.getValueSchemaOffset(), ");\n")
          : kj::strTree(indent(outerIndent), upperCase, ": new capnp.genhelper.ConstStruct(", typeName_,
                        ", new Uint8Array(schemas['", kj::hex(proto.getId()), "']).buffer, ", schema.getValueSchemaOffset(), "),\n"),
          kj::strTree()
          };
      }

      case schema::Value::LIST: {

        return ConstText {
          true,

          (scope.size() == 0)
          ? kj::strTree(indent(outerIndent + 1), "module.", upperCase, " = new capnp.genhelper.ConstList(",
                        typeName(request, type.getList().getElementType()),
                        ", new Uint8Array(schemas['", kj::hex(proto.getId()), "']).buffer, ",
                        schema.getValueSchemaOffset(), ");\n")
          : kj::strTree(indent(outerIndent), upperCase, ": new capnp.genhelper.ConstList(capnp.list.List(",
                        typeName(request, type.getList().getElementType()),
                        "), new Uint8Array(schemas['", kj::hex(proto.getId()), "']).buffer, ",
                        schema.getValueSchemaOffset(), "),\n"),
          kj::strTree()
          };
      }

      case schema::Value::OBJECT:
      case schema::Value::INTERFACE:
        return ConstText { false, kj::strTree(), kj::strTree() };
    }

    KJ_UNREACHABLE;
  }

  // -----------------------------------------------------------------

  struct NodeText {
    kj::StringTree outerTypeDecl;
    kj::StringTree outerTypeDef;
    kj::StringTree capnpSchemaDefs;
  };

  NodeText makeNodeText(schema::CodeGeneratorRequest::RequestedFile::Reader request,
                        kj::StringPtr namespace_, kj::StringPtr scope,
                        kj::StringPtr name, Schema schema, int outerIndent) {
    auto proto = schema.getProto();
    auto fullName = kj::str(scope, name);
    auto subScope = kj::str(fullName, ".");
    auto hexId = kj::hex(proto.getId());

    // Compute nested nodes, including groups.
    kj::Vector<NodeText> nestedTexts(proto.getNestedNodes().size());
    for (auto nested: proto.getNestedNodes()) {
      nestedTexts.add(makeNodeText(request,
                                   namespace_, subScope, nested.getName(), schemaLoader.get(nested.getId()),
                                   outerIndent + 1));
    };

    if (proto.isStruct()) {
      for (auto field: proto.getStruct().getFields()) {
        if (field.isGroup()) {
          nestedTexts.add(makeNodeText(request, 
                                       namespace_, subScope, toTitleCase(field.getName()),
                                       schemaLoader.get(field.getGroup().getTypeId()),
                                       outerIndent + 1));
        }
      }
    }

    // Convert the encoded schema to a literal byte array.
    kj::ArrayPtr<const word> rawSchema = schema.asUncheckedMessage();
    auto schemaLiteral = kj::StringTree(KJ_MAP(w, rawSchema) {
        const byte* bytes = reinterpret_cast<const byte*>(&w);

        return kj::strTree(KJ_MAP(i, kj::range<uint>(0, sizeof(word))) {
            auto text = kj::toCharSequence(kj::implicitCast<uint>(bytes[i]));
            return kj::strTree(kj::repeat(' ', 4 - text.size()), text, ((i < sizeof(word)-1) || (&w != rawSchema.end() - 1)) ? "," : "");
          });
      }, kj::strTree("\n", indent(outerIndent + 4)).flatten());

    std::set<uint64_t> deps;
    enumerateDeps(proto, deps);

    kj::Array<uint> membersByName;
    kj::Array<uint> membersByDiscrim;
    switch (proto.which()) {
      case schema::Node::STRUCT: {
        auto structSchema = schema.asStruct();
        membersByName = makeMembersByName(structSchema.getFields());
        auto builder = kj::heapArrayBuilder<uint>(structSchema.getFields().size());
        for (auto field: structSchema.getUnionFields()) {
          builder.add(field.getIndex());
        }
        for (auto field: structSchema.getNonUnionFields()) {
          builder.add(field.getIndex());
        }
        membersByDiscrim = builder.finish();
        break;
      }
      case schema::Node::ENUM:
        membersByName = makeMembersByName(schema.asEnum().getEnumerants());
        break;
      case schema::Node::INTERFACE:
        membersByName = makeMembersByName(schema.asInterface().getMethods());
        break;
      default:
        break;
    }

    auto schemaDef = kj::strTree(indent(outerIndent + 3), "schemas['", kj::hex(proto.getId()),"'] = [\n",
                                 indent(outerIndent + 4), kj::mv(schemaLiteral), "\n",
                                 indent(outerIndent + 3), "];\n",
                                 "\n");

    auto declaration = (scope.size() == 0) ? kj::strTree("module.", name, " = ").flatten() : kj::strTree(name, ": ").flatten();
    auto declEnd = (scope.size() == 0) ? kj::str("}}();") : kj::strTree("}}(),").flatten();

    switch (proto.which()) {
      case schema::Node::FILE:
        KJ_FAIL_REQUIRE("This method shouldn't be called on file nodes.");

      case schema::Node::STRUCT: {
        auto fieldTexts =
        KJ_MAP(f, schema.asStruct().getFields()) { return makeFieldText(request, subScope, f, outerIndent + 4); };

        auto fieldNames =
        KJ_MAP(f, schema.asStruct().getFields()) { return kj::strTree(f.getProto().getName()).flatten(); };

        auto structNode = proto.getStruct();
        uint discrimOffset = structNode.getDiscriminantOffset();

        return NodeText {
          kj::str(),

          kj::strTree(
              indent(outerIndent + 1),
              declaration, "function() {\n",
              "\n",

              indent(outerIndent + 2), "return {\n",
              structNode.getDiscriminantCount() == 0 ? kj::strTree() : kj::strTree(
                  KJ_MAP(f, structNode.getFields()) {
                    if (f.hasDiscriminantValue()) {
                      return kj::strTree(indent(outerIndent + 3), toUpperCase(f.getName()), ": ", f.getDiscriminantValue(), ",\n");
                    } else {
                      return kj::strTree();
                    }
                  }),
              KJ_MAP(n, nestedTexts) { return kj::mv(n.outerTypeDecl); },
              KJ_MAP(n, nestedTexts) { return kj::mv(n.outerTypeDef); },


              makeReaderDef(schema, fullName, name, structNode.getDiscriminantCount() != 0,
                            KJ_MAP(f, fieldTexts) { return kj::mv(f.readerMethodDecls); }, fieldNames, name, outerIndent + 3),
              makeBuilderDef(schema, fullName, name, structNode.getDiscriminantCount() != 0,
                             KJ_MAP(f, fieldTexts) { return kj::mv(f.builderMethodDecls); }, fieldNames, name, outerIndent + 3),

              indent(outerIndent + 2), declEnd, "\n",
              "\n"),

          kj::strTree(
              kj::mv(schemaDef),
              KJ_MAP(n, nestedTexts) { return kj::mv(n.capnpSchemaDefs); }),

          };
      }

      case schema::Node::ENUM: {
        auto enumerants = schema.asEnum().getEnumerants();

        return NodeText {
          scope.size() == 0
          ? kj::strTree()
          : kj::strTree(
              indent(outerIndent+1), declaration, "function() {\n",
              indent(outerIndent+2), "return {\n",
              KJ_MAP(e, enumerants) {
                return kj::strTree(indent(outerIndent+3), toUpperCase(e.getProto().getName()), ": ", e.getOrdinal(), ",\n");
              },
              indent(outerIndent+1), declEnd, "\n"
              "\n"),

          scope.size() > 0
          ? kj::strTree()
          : kj::strTree(
              indent(outerIndent+1), declaration, "function() {\n",
              indent(outerIndent+2), "return {\n",
              KJ_MAP(e, enumerants) {
                return kj::strTree(indent(outerIndent+3), toUpperCase(e.getProto().getName()), ": ", e.getOrdinal(), ",\n");
              },
              indent(outerIndent+1), declEnd, "\n"
              "\n"),

          kj::mv(schemaDef),

          };
      }

      case schema::Node::INTERFACE: {
        return NodeText {
          kj::strTree(),
          kj::strTree(),

          kj::mv(schemaDef),

          };
      }

      case schema::Node::CONST: {
        auto constText = makeConstText(request, scope, name, schema.asConst(), outerIndent);

        return NodeText {
          scope.size() == 0 ? kj::strTree() : kj::strTree("  ", kj::mv(constText.decl)),
          scope.size() > 0 ? kj::strTree() : kj::mv(constText.decl),

          constText.needsSchema ? kj::mv(schemaDef) : kj::strTree(),

          };
      }

      case schema::Node::ANNOTATION: {
        return NodeText {
          kj::strTree(),
          kj::strTree(),

          kj::mv(schemaDef),

          };
      }
    }

    KJ_UNREACHABLE;
  }

  struct FileText {
    kj::StringTree javascript;
  };

  FileText makeFileText(Schema schema,
                        schema::CodeGeneratorRequest::RequestedFile::Reader request) {
    usedImports.clear();

    auto node = schema.getProto();
    auto displayName = node.getDisplayName();

    kj::Vector<kj::ArrayPtr<const char>> namespaceParts;
    kj::String namespacePrefix;

    kj::String fileNamespace;

    for (auto annotation: node.getAnnotations()) {
      if (annotation.getId() == JS_NAMESPACE_ANNOTATION_ID) {
        fileNamespace = kj::str(annotation.getValue().getText());
        break;
      }
    }

    auto nodeTexts = KJ_MAP(nested, node.getNestedNodes()) {
      return makeNodeText(request, namespacePrefix, "", nested.getName(), schemaLoader.get(nested.getId()), 0);
    };

    kj::Vector<kj::StringPtr> includes;
    for (auto import: request.getImports()) {
      if (usedImports.count(import.getId()) > 0) {
        includes.add(import.getName());
      }
    }

    return FileText {
      kj::strTree(
          "// Generated by Cap'n Proto compiler, DO NOT EDIT\n"
          "// source: ", baseName(displayName), "\n"
          "\n"
          "goog.provide('capnp_generated_", kj::hex(node.getId()), "');\n",
          (fileNamespace.size() > 0 ? kj::strTree("goog.provide('", fileNamespace, "');\n") : kj::strTree()),
          "\n"
          "goog.require('capnp.genhelper');\n"
          "goog.require('goog.object');\n"
          "\n"
          "(function() {\n"
          "\n",
          indent(1), "var module = capnp_generated_", kj::hex(node.getId()), ";\n",
          indent(1), "var schemas = {};\n"
          "\n",
          KJ_MAP(includedFile, request.getImports()) {
            if (usedImports.count(includedFile.getId()) > 0) {
              kj::String filename = kj::strTree(includedFile.getName()).flatten();
              return kj::strTree("goog.require('capnp_generated_", kj::hex(includedFile.getId()), "');\n");
            }
            else {
              return kj::strTree();
            }
          },
          KJ_MAP(n, nodeTexts) { return kj::mv(n.capnpSchemaDefs); },
          KJ_MAP(n, nodeTexts) { return kj::mv(n.outerTypeDef); },

          "\n",
          (fileNamespace.size() > 0 ? kj::strTree(indent(1), "goog.object.extend(", fileNamespace, ", capnp_generated_", kj::hex(node.getId()), ");\n") : kj::strTree()),
          "})();\n")
      };
  }

  // -----------------------------------------------------------------

  void makeDirectory(kj::StringPtr path) {
    KJ_IF_MAYBE(slashpos, path.findLast('/')) {
      // Make the parent dir.
      makeDirectory(kj::str(path.slice(0, *slashpos)));
    }

    if (mkdir(path.cStr(), 0777) < 0) {
      int error = errno;
      if (error != EEXIST) {
        KJ_FAIL_SYSCALL("mkdir(path)", error, path);
      }
    }
  }

  void writeFile(kj::StringPtr filename, const kj::StringTree& text) {
    KJ_IF_MAYBE(slashpos, filename.findLast('/')) {
      // Make the parent dir.
      makeDirectory(kj::str(filename.slice(0, *slashpos)));
    }

    int fd;
    KJ_SYSCALL(fd = open(filename.cStr(), O_CREAT | O_WRONLY | O_TRUNC, 0666), filename);
    kj::FdOutputStream out((kj::AutoCloseFd(fd)));

    text.visit(
        [&](kj::ArrayPtr<const char> text) {
          out.write(text.begin(), text.size());
        });
  }

  kj::MainBuilder::Validity run() {
    ReaderOptions options;
    options.traversalLimitInWords = 1 << 30;  // Don't limit.
    StreamFdMessageReader reader(STDIN_FILENO, options);
    auto request = reader.getRoot<schema::CodeGeneratorRequest>();

    for (auto node: request.getNodes()) {
      schemaLoader.load(node);
    }

    kj::FdOutputStream rawOut(STDOUT_FILENO);
    kj::BufferedOutputStreamWrapper out(rawOut);

    for (auto requestedFile: request.getRequestedFiles()) {
      auto schema = schemaLoader.get(requestedFile.getId());
      auto fileText = makeFileText(schema, requestedFile);

      writeFile(kj::str(schema.getProto().getDisplayName(), ".js"), fileText.javascript);
    }

    return true;
  }
};

}  // namespace
}  // namespace capnp

KJ_MAIN(capnp::CapnpcJavaScriptMain);
