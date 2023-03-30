export interface ISecretStore {
  getSecret(secretName: string): Promise<string | undefined>
}

export interface IRequestEvent {
  authorizationHeader: string
  secretName: string
}

export interface ICache {
  get(key: string): unknown
  put(key: string, value: unknown): void
}
