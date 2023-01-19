// @generated by protoc-gen-es v1.0.0 with parameter "target=ts"
// @generated from file skipped-repo-group-schema.proto (package docs, syntax proto3)
/* eslint-disable */
// @ts-nocheck

import type {
  BinaryReadOptions,
  FieldList,
  JsonReadOptions,
  JsonValue,
  PartialMessage,
  PlainMessage,
} from "@bufbuild/protobuf";
import { Message, proto3 } from "@bufbuild/protobuf";
import { VariantAnalysisSkippedRepoSchema } from "./variant-analysis-skipped-repo-schema_pb";

/**
 * @generated from message docs.SkippedRepoGroupSchema
 */
export class SkippedRepoGroupSchema extends Message<SkippedRepoGroupSchema> {
  /**
   * @generated from field: double repositoryCount = 1;
   */
  repositoryCount = 0;

  /**
   * @generated from field: repeated docs.VariantAnalysisSkippedRepoSchema repositories = 2;
   */
  repositories: VariantAnalysisSkippedRepoSchema[] = [];

  constructor(data?: PartialMessage<SkippedRepoGroupSchema>) {
    super();
    proto3.util.initPartial(data, this);
  }

  static readonly runtime = proto3;
  static readonly typeName = "docs.SkippedRepoGroupSchema";
  static readonly fields: FieldList = proto3.util.newFieldList(() => [
    {
      no: 1,
      name: "repositoryCount",
      kind: "scalar",
      T: 1 /* ScalarType.DOUBLE */,
    },
    {
      no: 2,
      name: "repositories",
      kind: "message",
      T: VariantAnalysisSkippedRepoSchema,
      repeated: true,
    },
  ]);

  static fromBinary(
    bytes: Uint8Array,
    options?: Partial<BinaryReadOptions>,
  ): SkippedRepoGroupSchema {
    return new SkippedRepoGroupSchema().fromBinary(bytes, options);
  }

  static fromJson(
    jsonValue: JsonValue,
    options?: Partial<JsonReadOptions>,
  ): SkippedRepoGroupSchema {
    return new SkippedRepoGroupSchema().fromJson(jsonValue, options);
  }

  static fromJsonString(
    jsonString: string,
    options?: Partial<JsonReadOptions>,
  ): SkippedRepoGroupSchema {
    return new SkippedRepoGroupSchema().fromJsonString(jsonString, options);
  }

  static equals(
    a:
      | SkippedRepoGroupSchema
      | PlainMessage<SkippedRepoGroupSchema>
      | undefined,
    b:
      | SkippedRepoGroupSchema
      | PlainMessage<SkippedRepoGroupSchema>
      | undefined,
  ): boolean {
    return proto3.util.equals(SkippedRepoGroupSchema, a, b);
  }
}
