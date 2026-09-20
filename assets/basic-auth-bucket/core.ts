import {
  getBase64EncodedCredentialsFromHeader,
  getParsedSecretString as getParsedCredentials,
  verifyBasicAuthCredentials,
} from "./lib"
import type { ICache, IRequestEvent, ISecretStore } from "./ports"

const secretCacheKey = "credentials"

export class AuthorizeRequest {
  constructor(
    private secretStore: ISecretStore,
    private cache?: ICache,
  ) {}
  async handle(requestEvent: IRequestEvent): Promise<boolean> {
    const base64EncodedCredentials = getBase64EncodedCredentialsFromHeader(
      requestEvent.authorizationHeader,
    )
    if (base64EncodedCredentials) {
      let secret
      if (this.cache) {
        secret = this.cache.get(secretCacheKey)
        if (!secret) {
          secret = await this.secretStore.getSecret()
          this.cache.put(secretCacheKey, secret)
        }
      } else {
        secret = await this.secretStore.getSecret()
      }
      const parsedCredentials = getParsedCredentials(secret)
      if (parsedCredentials) {
        return verifyBasicAuthCredentials(
          parsedCredentials.username,
          parsedCredentials.password,
          base64EncodedCredentials,
        )
      }
    }
    return false
  }
}
