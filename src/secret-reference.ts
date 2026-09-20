import type * as iam from "aws-cdk-lib/aws-iam"
import type * as sm from "aws-cdk-lib/aws-secretsmanager"
import type * as ssm from "aws-cdk-lib/aws-ssm"

/**
 * A Secrets Manager secret or an SSM SecureString parameter.
 *
 * When using an SSM parameter encrypted with a customer-managed KMS key,
 * import it with `encryptionKey` so read grants include KMS decrypt
 * permissions.
 */
export type SecretReference = sm.ISecret | ssm.IParameter

export type ResolvedSecretReference = {
  reference: string
  grantRead: (grantee: iam.IGrantable) => iam.Grant
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const isSecretsManagerSecret = (value: unknown): value is sm.ISecret =>
  isObject(value) &&
  typeof value.secretName === "string" &&
  typeof value.secretArn === "string" &&
  typeof value.grantRead === "function"

export const isSecureStringParameter = (
  value: unknown,
): value is ssm.IParameter =>
  isObject(value) &&
  typeof value.parameterName === "string" &&
  typeof value.parameterArn === "string" &&
  value.parameterType === "SecureString" &&
  typeof value.grantRead === "function"

export const resolveSecretReference = (
  reference: SecretReference,
): ResolvedSecretReference => {
  if (isSecretsManagerSecret(reference)) {
    return {
      reference: `sm://${reference.secretName}`,
      grantRead: (grantee) => reference.grantRead(grantee),
    }
  }
  if (isSecureStringParameter(reference)) {
    return {
      reference: `ssm://${reference.parameterName}`,
      grantRead: (grantee) => reference.grantRead(grantee),
    }
  }
  throw new Error(
    "Expected a Secrets Manager secret or an SSM SecureString parameter",
  )
}
