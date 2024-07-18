import * as lambdaTypes from "aws-lambda"
import { KMS } from "@aws-sdk/client-kms"
import { SecretsManager } from "@aws-sdk/client-secrets-manager"
import { createHash } from "crypto"
import { httpRequest, getCookieValue } from "./lib"

const secretsManager = new SecretsManager()
const kms = new KMS()

export const handler = async (event: lambdaTypes.APIGatewayProxyEvent) => {
  const [
    nonceCookieName,
    authCookieName,
    authCookieAttributes,
    authCookieEncryptionKeyArn,
    responseHeaders,
    secretName,
    redirectUrl,
  ] = [
    process.env.NONCE_COOKIE_NAME,
    process.env.AUTH_COOKIE_NAME,
    process.env.AUTH_COOKIE_ATTRIBUTES,
    process.env.AUTH_COOKIE_ENCRYPTION_KEY_ARN,
    process.env.RESPONSE_HEADERS
      ? (JSON.parse(process.env.RESPONSE_HEADERS) as Record<string, string>)
      : undefined,
    process.env.SECRET_NAME,
    process.env.REDIRECT_URL,
  ]
  if (
    !nonceCookieName ||
    !authCookieName ||
    !secretName ||
    !authCookieEncryptionKeyArn ||
    !redirectUrl
  ) {
    console.error("Missing required environment variables")
    return {
      headers: {
        ...responseHeaders,
      },
      statusCode: 500,
    }
  }

  const code = event.queryStringParameters?.code
  const state = event.queryStringParameters?.state
  if (!code || !state) {
    console.warn("Missing required query parameters")
    return {
      headers: {
        ...responseHeaders,
      },
      statusCode: 400,
    }
  }
  const cookieHeader = event.headers?.Cookie
  if (!cookieHeader) {
    console.warn("Required cookie header is not set")
    throw new Error("Unauthenticated")
  }
  const encodedNonce = getCookieValue(cookieHeader, nonceCookieName)
  if (!encodedNonce) {
    // Missing cookie value
    console.warn("Required cookie is not set")
    throw new Error("Unauthenticated")
  }
  const nonce = Buffer.from(encodedNonce, "base64").toString("utf8")
  const expectedHash = createHash("sha256").update(nonce).digest("hex")
  if (expectedHash !== state) {
    console.warn(
      `Potential CSRF attempt, expected hash ${expectedHash} but got ${state}`,
    )
    return {
      headers: {
        ...responseHeaders,
      },
      statusCode: 400,
    }
  }

  // Perform code exchange
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
  const payload = JSON.stringify({
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
    code,
    state,
  })

  const options = {
    hostname: "github.com",
    port: 443,
    path: "/login/oauth/access_token",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": payload.length,
      Accept: "application/json",
    },
  }

  const res = (await httpRequest(options, payload)) as {
    error?: string
    access_token?: string
  }
  if (res?.error) {
    console.error(`Received error ${res.error} from GitHub during code exhange`)
    return {
      headers: {
        ...responseHeaders,
      },
      statusCode: 500,
    }
  }
  if (!res?.access_token) {
    console.error(
      "Did not receive an access token from GitHub during code exchange",
    )
    return {
      headers: {
        ...responseHeaders,
      },
      statusCode: 500,
    }
  }

  const encrypted = await kms.encrypt({
    KeyId: authCookieEncryptionKeyArn,
    Plaintext: Buffer.from(res.access_token),
  })

  if (!encrypted.CiphertextBlob) {
    console.error("Failed to encrypt access token")
    return {
      headers: {
        ...responseHeaders,
      },
      statusCode: 500,
    }
  }

  const encoded = Buffer.from(encrypted.CiphertextBlob).toString("base64")
  const cookieString = authCookieAttributes
    ? `${authCookieName}=${encoded}; ${authCookieAttributes}`
    : `${authCookieName}=${encoded}`

  return {
    statusCode: 302,
    headers: {
      ...responseHeaders,
      Location: redirectUrl,
      "Set-Cookie": cookieString,
    },
    body: JSON.stringify({}),
  } as lambdaTypes.APIGatewayProxyResult
}
