import { createHash } from "node:crypto"
import { KMS } from "@aws-sdk/client-kms"
import { SecretsManager } from "@aws-sdk/client-secrets-manager"
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm"
import type * as lambdaTypes from "aws-lambda"
import { getCookieValue, httpRequest } from "./lib"

const secretsManager = new SecretsManager()
const ssmClient = new SSMClient({})
const kms = new KMS()

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

export const handler = async (event: lambdaTypes.APIGatewayProxyEvent) => {
  const [
    nonceCookieName,
    authCookieName,
    authCookieAttributes,
    authCookieEncryptionKeyArn,
    responseHeaders,
    secretName,
    secretType,
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
    process.env.SECRET_TYPE || "secrets-manager",
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
