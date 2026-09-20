import { SecretsManager } from "@aws-sdk/client-secrets-manager"
import { SSM } from "@aws-sdk/client-ssm"

export type SecretSource = {
  type: "secretsManager" | "ssm"
  name: string
}

export type SecretSourceClients = {
  secretsManager: SecretsManager
  ssm: SSM
}

export const createSecretSourceClients = (
  region?: string,
): SecretSourceClients => {
  const config = region ? { region } : {}
  return {
    secretsManager: new SecretsManager(config),
    ssm: new SSM(config),
  }
}

export const secretSourceFromEnvironment = (
  typeEnvironmentVariable = "SECRET_SOURCE_TYPE",
  nameEnvironmentVariable = "SECRET_NAME",
): SecretSource | undefined => {
  const name = process.env[nameEnvironmentVariable]
  if (!name) {
    return undefined
  }
  const type = process.env[typeEnvironmentVariable] ?? "secretsManager"
  if (type !== "secretsManager" && type !== "ssm") {
    throw new Error(`Unsupported secret source type: ${type}`)
  }
  return { type, name }
}

export const readSecretSource = async (
  source: SecretSource,
  clients: SecretSourceClients,
): Promise<string | undefined> => {
  if (source.type === "ssm") {
    const result = await clients.ssm.getParameter({
      Name: source.name,
      WithDecryption: true,
    })
    return result.Parameter?.Value
  }
  const result = await clients.secretsManager.getSecretValue({
    SecretId: source.name,
  })
  return result.SecretString
}
