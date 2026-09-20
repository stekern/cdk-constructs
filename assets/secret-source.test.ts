import { describe, expect, test } from "@jest/globals"
import { parseSecretReference } from "./secret-source"

describe("parseSecretReference", () => {
  test("parses a Secrets Manager reference", () => {
    expect(parseSecretReference("sm://my-secret")).toEqual({
      type: "sm",
      name: "my-secret",
    })
  })

  test("parses an SSM parameter reference", () => {
    expect(parseSecretReference("ssm:///app/secret")).toEqual({
      type: "ssm",
      name: "/app/secret",
    })
  })

  test("rejects a reference without a supported protocol", () => {
    expect(() => parseSecretReference("my-secret")).toThrow(
      "Unsupported secret reference: my-secret",
    )
  })
})
