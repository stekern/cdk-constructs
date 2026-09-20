import { describe, expect, test } from "@jest/globals"
import * as cdk from "aws-cdk-lib"
import * as sm from "aws-cdk-lib/aws-secretsmanager"
import * as ssm from "aws-cdk-lib/aws-ssm"
import { resolveSecretReference } from "./secret-reference"

describe("resolveSecretReference", () => {
  test("resolves a Secrets Manager secret", () => {
    const app = new cdk.App()
    const stack = new cdk.Stack(app, "Stack")
    const secret = new sm.Secret(stack, "Secret")

    expect(resolveSecretReference(secret)).toMatchObject({
      reference: `sm://${secret.secretName}`,
    })
  })

  test("resolves an SSM SecureString parameter", () => {
    const app = new cdk.App()
    const stack = new cdk.Stack(app, "Stack")
    const parameter = ssm.StringParameter.fromSecureStringParameterAttributes(
      stack,
      "Parameter",
      {
        parameterName: "/github/client-credentials",
      },
    )

    expect(resolveSecretReference(parameter)).toMatchObject({
      reference: "ssm:///github/client-credentials",
    })
  })

  test("rejects an SSM String parameter", () => {
    const app = new cdk.App()
    const stack = new cdk.Stack(app, "Stack")
    const parameter = ssm.StringParameter.fromStringParameterName(
      stack,
      "Parameter",
      "/github/client-credentials",
    )

    expect(() => resolveSecretReference(parameter)).toThrow(
      "Expected a Secrets Manager secret or an SSM SecureString parameter",
    )
  })
})
