import { createSecretSourceClients, readSecretSource } from "../secret-source"
import type { ICache, ISecretStore } from "./ports"

export class SecretStore implements ISecretStore {
  private clients = createSecretSourceClients("us-east-1")

  async getSecret(secretName: string): Promise<string | undefined> {
    const sourceType = process.env.SECRET_SOURCE_TYPE ?? "secretsManager"
    if (sourceType !== "secretsManager" && sourceType !== "ssm") {
      throw new Error(`Unsupported secret source type: ${sourceType}`)
    }
    try {
      return await readSecretSource(
        {
          type: sourceType,
          name: secretName,
        },
        this.clients,
      )
    } catch (e) {
      console.error(e)
    }
    return undefined
  }
}

export class InMemorySecretStore implements ISecretStore {
  constructor(private secrets: Record<string, string>) {}
  async getSecret(secretName: string): Promise<string | undefined> {
    return Promise.resolve(this.secrets[secretName])
  }
}

export class InMemoryCache implements ICache {
  private cache: Record<string, unknown>
  constructor() {
    this.cache = {}
  }
  get(key: string) {
    return this.cache[key]
  }
  put(key: string, value: unknown) {
    this.cache[key] = value
  }
}
