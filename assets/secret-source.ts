import { SecretsManager } from "@aws-sdk/client-secrets-manager"
import { SSM } from "@aws-sdk/client-ssm"

export type SecretSource = {
  type: "sm" | "ssm"
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

export const parseSecretReference = (reference: string): SecretSource => {
  const separatorIndex = reference.indexOf("://")
  if (separatorIndex === -1) {
    return { type: "sm", name: reference }
  }
  const type = reference.slice(0, separatorIndex)
  const name = reference.slice(separatorIndex + 3)
  if ((type !== "sm" && type !== "ssm") || !name) {
    throw new Error(`Unsupported secret reference: ${reference}`)
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
