export interface ISecretStore {
  getSecret(): Promise<string | undefined>
}

export interface IRequestEvent {
  authorizationHeader: string
}

export interface ICache {
  get(key: string): unknown
  put(key: string, value: unknown): void
}
