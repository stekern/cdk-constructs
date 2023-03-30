import * as lambdaTypes from "aws-lambda"
import { SecretStore, InMemoryCache } from "./adapters"
import { AuthorizeRequest } from "./core"

const secretStore = new SecretStore()
const cache = new InMemoryCache()

export const handler: lambdaTypes.CloudFrontRequestHandler = async (event) => {
  let response: lambdaTypes.CloudFrontRequestResult = {
    status: "401",
    body: "Unauthorized",
    headers: {
      "www-authenticate": [{ key: "WWW-Authenticate", value: "Basic" }],
    },
  }
  const request = event.Records[0].cf.request
  const headers = request.headers
  const secretName = process.env.SECRET_NAME
  const authorizationHeader = headers.authorization?.[0].value
  if (secretName && authorizationHeader) {
    const handle = new AuthorizeRequest(secretStore, cache)
    const authorized = await handle.handle({
      authorizationHeader,
      secretName,
    })
    if (authorized) {
      response = request
    }
  }
  return response
}
