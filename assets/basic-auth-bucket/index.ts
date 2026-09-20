import type * as lambdaTypes from "aws-lambda"
import { parseSecretReference } from "../secret-source"
import { InMemoryCache, SecretStore } from "./adapters"
import { AuthorizeRequest } from "./core"
import type { ICache, ISecretStore } from "./ports"

const secretReference = process.env.SECRET_NAME
const secretStore = secretReference
  ? new SecretStore(parseSecretReference(secretReference))
  : undefined

export const makeHandler =
  (
    secretStore: ISecretStore | undefined,
    cache: ICache = new InMemoryCache(),
  ): lambdaTypes.CloudFrontRequestHandler =>
  async (event) => {
    let response: lambdaTypes.CloudFrontRequestResult = {
      status: "401",
      body: "Unauthorized",
      headers: {
        "www-authenticate": [{ key: "WWW-Authenticate", value: "Basic" }],
      },
    }
    const request = event.Records[0].cf.request
    const headers = request.headers
    const authorizationHeader = headers.authorization?.[0].value
    if (secretStore && authorizationHeader) {
      const handle = new AuthorizeRequest(secretStore, cache)
      const authorized = await handle.handle({
        authorizationHeader,
      })
      if (authorized) {
        response = request
      }
    }
    return response
  }

export const handler = makeHandler(secretStore)
