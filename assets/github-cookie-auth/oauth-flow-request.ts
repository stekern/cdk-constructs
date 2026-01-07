import { createHash } from "node:crypto"
import { SecretsManager } from "@aws-sdk/client-secrets-manager"
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm"
import type * as lambdaTypes from "aws-lambda"
import { generateRandomString, getUrlWithEncodedQueryParams } from "./lib"

const secretsManager = new SecretsManager()
const ssmClient = new SSMClient({})

async function getSecretValue(
  name: string,
  type: string,
): Promise<string | undefined> {
  if (type === "parameter-store") {
    const result = await ssmClient.send(
      new GetParameterCommand({ Name: name, WithDecryption: true }),
    )
    return result.Parameter?.Value
  }
  const result = await secretsManager.getSecretValue({ SecretId: name })
  return result.SecretString
}

export const handler = async (_event: lambdaTypes.APIGatewayProxyEvent) => {
  const [
    nonceCookieName,
    nonceCookieAttributes,
    callbackUrl,
    responseHeaders,
    secretName,
    secretType,
  ] = [
    process.env.NONCE_COOKIE_NAME,
    process.env.NONCE_COOKIE_ATTRIBUTES,
    process.env.CALLBACK_URL,
    process.env.RESPONSE_HEADERS
      ? (JSON.parse(process.env.RESPONSE_HEADERS) as Record<string, string>)
      : undefined,
    process.env.SECRET_NAME,
    process.env.SECRET_TYPE || "secrets-manager",
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

  const secretString = await getSecretValue(secretName, secretType)
  const secrets = secretString
    ? (JSON.parse(secretString) as {
        clientId: string
        clientSecret: string
      })
    : null
  if (!secrets || !secrets.clientId || !secrets.clientSecret) {
    console.error("Could not properly read secret")
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
