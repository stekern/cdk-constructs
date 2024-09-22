import * as ssm from "aws-cdk-lib/aws-ssm"
import * as sm from "aws-cdk-lib/aws-secretsmanager"
import * as cdk from "aws-cdk-lib"
import { GrafanaCognitoAuth } from "./grafana-cognito-auth"

describe("GrafanaCognitoAuth", () => {
  it("generates correct role attribute path", () => {
    const roleAttributePath = GrafanaCognitoAuth.generateRoleAttributePath({
      serverAdmins: { emails: ["admin@example.com"], groups: ["Admins"] },
      editors: { groups: ["Editors"] },
      viewers: { emails: ["viewer@example.com"] },
    })
    expect(roleAttributePath).toBe(
      "(contains(\"cognito:groups\" || `[]`, 'Admins') || contains(['admin@example.com'], email) && 'GrafanaAdmin') || " +
        "(contains(\"cognito:groups\" || `[]`, 'Editors') && 'Editor') || " +
        "(contains(['viewer@example.com'], email) && 'Viewer') || null",
    )
  })
  it("generates correct role attribute path with default role", () => {
    const roleAttributePath = GrafanaCognitoAuth.generateRoleAttributePath({
      defaultRole: "Viewer",
      serverAdmins: { emails: ["admin@example.com"] },
    })
    expect(roleAttributePath).toBe(
      "(contains(['admin@example.com'], email) && 'GrafanaAdmin') || 'Viewer'",
    )
  })
  it("generates environment variables correctly", () => {
    const stack = new cdk.Stack()
    const secret = sm.Secret.fromSecretNameV2(stack, "Secret", "secret-name")
    const parameter = ssm.StringParameter.fromStringParameterName(
      stack,
      "Parameter",
      "parameter-name",
    )
    const config = {
      auth: {
        genericOauth: {
          enabled: true,
          name: "Cognito",
        },
      },
      custom: {
        config: {
          key: "value",
          secret,
          parameter,
        },
      },
    }
    const env = GrafanaCognitoAuth.generateEnvironmentVariables(config)
    expect(env.strings).toEqual({
      GF_AUTH_GENERIC_OAUTH_ENABLED: "true",
      GF_AUTH_GENERIC_OAUTH_NAME: "Cognito",
      GF_CUSTOM_CONFIG_KEY: "value",
    })
    expect(env.secrets).toEqual({
      GF_CUSTOM_CONFIG_SECRET: secret,
    })
    expect(env.parameters).toEqual({
      GF_CUSTOM_CONFIG_PARAMETER: parameter,
    })
  })
})
