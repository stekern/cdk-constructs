import {
  type SecretSource,
  createSecretSourceClients,
  readSecretSource,
} from "../secret-source"
import type { ICache, ISecretStore } from "./ports"

export class SecretStore implements ISecretStore {
  private clients = createSecretSourceClients("us-east-1")

  constructor(private readonly source: SecretSource) {}

  async getSecret(): Promise<string | undefined> {
    try {
      return await readSecretSource(this.source, this.clients)
    } catch (e) {
      console.error(e)
    }
    return undefined
  }
}

export class InMemorySecretStore implements ISecretStore {
  constructor(private readonly secret?: string) {}
  async getSecret(): Promise<string | undefined> {
    return Promise.resolve(this.secret)
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
