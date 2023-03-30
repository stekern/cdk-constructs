import { ISecretStore, ICache } from "./ports"
import { SecretsManager } from "@aws-sdk/client-secrets-manager"

export class SecretStore implements ISecretStore {
  private client: SecretsManager
  constructor() {
    this.client = new SecretsManager({
      apiVersion: "2017-10-17",
      // To avoid the need for cross region replication of secrets
      region: "us-east-1",
    })
  }
  async getSecret(secretName: string): Promise<string | undefined> {
    let secret
    try {
      const result = await this.client.getSecretValue({
        SecretId: secretName,
      })
      secret = result.SecretString
    } catch (e) {
      console.error(e)
    }
    return secret
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
