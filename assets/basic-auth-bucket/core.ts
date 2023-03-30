import { IRequestEvent, ICache, ISecretStore } from "./ports"
import {
  getBase64EncodedCredentialsFromHeader,
  getParsedSecretString as getParsedCredentials,
  verifyBasicAuthCredentials,
} from "./lib"
export class AuthorizeRequest {
  constructor(private secretStore: ISecretStore, private cache?: ICache) {}
  async handle(requestEvent: IRequestEvent): Promise<boolean> {
    const base64EncodedCredentials = getBase64EncodedCredentialsFromHeader(
      requestEvent.authorizationHeader,
    )
    if (base64EncodedCredentials) {
      let secret
      if (this.cache) {
        secret = this.cache.get(requestEvent.secretName)
        if (!secret) {
          secret = await this.secretStore.getSecret(requestEvent.secretName)
          this.cache.put(requestEvent.secretName, secret)
        }
      } else {
        secret = await this.secretStore.getSecret(requestEvent.secretName)
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
