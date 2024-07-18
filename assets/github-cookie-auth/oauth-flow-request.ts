import * as lambdaTypes from "aws-lambda"
import { createHash } from "crypto"
import { SecretsManager } from "@aws-sdk/client-secrets-manager"
import { generateRandomString, getUrlWithEncodedQueryParams } from "./lib"

const secretsManager = new SecretsManager()

export const handler = async (event: lambdaTypes.APIGatewayProxyEvent) => {
  const [
    nonceCookieName,
    nonceCookieAttributes,
    callbackUrl,
    responseHeaders,
    secretName,
  ] = [
    process.env.NONCE_COOKIE_NAME,
    process.env.NONCE_COOKIE_ATTRIBUTES,
    process.env.CALLBACK_URL,
    process.env.RESPONSE_HEADERS
      ? (JSON.parse(process.env.RESPONSE_HEADERS) as Record<string, string>)
      : undefined,
    process.env.SECRET_NAME,
  ]
  if (!nonceCookieName || !secretName || !callbackUrl) {
    console.error("Missing required environment variables")
    return {
      headers: {
        ...responseHeaders,
      },
      statusCode: 500,
    }
  }

  const secret = await secretsManager.getSecretValue({
    SecretId: secretName,
  })

  const secrets = secret.SecretString
    ? (JSON.parse(secret.SecretString) as {
        clientId: string
        clientSecret: string
      })
    : null
  if (!secrets || !secrets.clientId || !secrets.clientSecret) {
    console.error("Could not properly read secrets from Secrets Manager")
    return {
      headers: {
        ...responseHeaders,
      },
      statusCode: 500,
    }
  }

  const allowedCharacters =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.~"

  const nonce = generateRandomString(128, allowedCharacters)
  const encodedeNonce = Buffer.from(nonce).toString("base64")
  const state = createHash("sha256").update(nonce).digest("hex")
  const queryParams = {
    client_id: secrets.clientId,
    redirect_uri: callbackUrl,
    state,
  }
  const requestUrl = getUrlWithEncodedQueryParams(
    "https://github.com/login/oauth/authorize",
    queryParams,
  )
  const cookieString = nonceCookieAttributes
    ? `${nonceCookieName}=${encodedeNonce}; ${nonceCookieAttributes}`
    : `${nonceCookieName}=${encodedeNonce}`
  const response = {
    statusCode: 307,
    body: "",
    headers: {
      ...responseHeaders,
      Location: requestUrl,
      // Cookie needs to have SameSite=Lax to allow us to read it after redirect?
      "Set-Cookie": cookieString,
    },
  } as lambdaTypes.APIGatewayProxyResult
  return response
}
