import * as lambdaTypes from "aws-lambda"
import * as octokitTypes from "@octokit/types"
import KMS from "aws-sdk/clients/kms"
import SecretsManager from "aws-sdk/clients/secretsmanager"
import DynamoDB from "aws-sdk/clients/dynamodb"
import { getCookieValue, httpRequest } from "./lib"

const secretsManager = new SecretsManager({
  apiVersion: "2017-10-17",
})
const kms = new KMS({
  apiVersion: "2014-11-01",
})

const dynamodb = new DynamoDB.DocumentClient({
  apiVersion: "2012-08-10",
})

const getGitHubAppInstallationsForUser = async (
  token: string,
  gitHubAppId: string,
) => {
  const options = {
    host: "api.github.com",
    // We skip pagination here as it's highly unlikely that a
    // user has access to more than 100 installations
    path: `/user/installations?per_page=100`,
    port: 443,
    method: "GET",
    headers: {
      "User-Agent": gitHubAppId,
      Accept: "application/vnd.github+json",
      Authorization: `token ${token}`,
    },
  }
  return (await httpRequest(
    options,
  )) as octokitTypes.Endpoints["GET /user/installations"]["response"]["data"]
}

const getGitHubOrgsForUser = async (token: string, gitHubAppId: string) => {
  const options = {
    host: "api.github.com",
    path: `/user/orgs?per_page=100`,
    port: 443,
    method: "GET",
    headers: {
      "User-Agent": gitHubAppId,
      Accept: "application/vnd.github+json",
      Authorization: `token ${token}`,
    },
  }
  return (await httpRequest(
    options,
  )) as octokitTypes.Endpoints["GET /user/orgs"]["response"]["data"]
}

export const handler = async (
  event: lambdaTypes.APIGatewayRequestAuthorizerEvent,
) => {
  const [
    accessControl,
    allowedOrigin,
    secretName,
    authCookieEncryptionKeyArn,
    authCookieName,
    gitHubAppId,
    authorizerCacheTableName,
    authorizerCacheTtl,
  ] = [
    process.env.ACCESS_CONTROL
      ? (JSON.parse(process.env.ACCESS_CONTROL) as {
          type: "USERNAME" | "ORG_MEMBERSHIP"
          whitelist: string[]
        })
      : undefined,
    process.env.ALLOWED_ORIGIN,
    process.env.SECRET_NAME,
    process.env.AUTH_COOKIE_ENCRYPTION_KEY_ARN,
    process.env.AUTH_COOKIE_NAME,
    process.env.GITHUB_APP_ID,
    process.env.AUTHORIZER_CACHE_TABLE_NAME,
    process.env.AUTHORIZER_CACHE_TTL,
  ]
  if (
    !accessControl ||
    !authCookieEncryptionKeyArn ||
    !secretName ||
    !authCookieName ||
    !allowedOrigin ||
    !gitHubAppId
  ) {
    console.error("Missing required environment variables")
    throw new Error("Unauthenticated")
  }
  const useCache = authorizerCacheTableName && authorizerCacheTtl
  // CSRF protection for the WebSocket upgrade request
  const origin = event.headers?.Origin || event.headers?.origin
  if (allowedOrigin && origin && origin !== allowedOrigin) {
    console.error(`Origin ${origin} is not allowed to connect`)
    throw new Error("Unauthenticated")
  }
  const cookieHeader = event.headers?.Cookie
  if (!cookieHeader) {
    console.warn("Required cookie header is not set")
    throw new Error("Unauthenticated")
  }
  const value = getCookieValue(cookieHeader, authCookieName)
  if (!value) {
    // Missing cookie value
    console.warn("Required cookie is not set")
    throw new Error("Unauthenticated")
  }

  const decoded = Buffer.from(value, "base64")
  const isBase64Encoded = decoded.toString("base64") === value
  if (!isBase64Encoded) {
    console.warn("The cookie value is not base64-encoded")
    throw new Error("Unauthenticated")
  }

  // Some simple caching because WebSocket APIs do not
  // currently support cached responses from Lambda
  if (useCache) {
    const cachedResponse = await dynamodb
      .get({
        Key: {
          PK: value,
          SK: event.methodArn,
        },
        TableName: authorizerCacheTableName,
      })
      .promise()
    if (cachedResponse.Item && cachedResponse.Item.cachedResponse) {
      // TODO: Manually check ttl attribute in case there are delays in DynamoDB
      console.log("Using cached authorizer response")
      return cachedResponse.Item
        .cachedResponse as lambdaTypes.APIGatewayAuthorizerResult
    }
  }

  const decrypted = await kms
    .decrypt({
      KeyId: authCookieEncryptionKeyArn,
      CiphertextBlob: decoded,
    })
    .promise()

  const accessToken = decrypted.Plaintext?.toString()
  if (!accessToken) {
    console.error("Received empty value when decrypting")
    throw new Error("Unauthenticated")
  }

  const secret = await secretsManager
    .getSecretValue({
      SecretId: secretName,
    })
    .promise()

  const secrets = secret.SecretString
    ? (JSON.parse(secret.SecretString) as {
        clientId: string
        clientSecret: string
      })
    : null

  if (!secrets || !secrets.clientId || !secrets.clientSecret) {
    console.error("Could not properly read secrets from Secrets Manager")
    throw new Error("Unauthenticated")
  }

  // Check validity of access token through GitHub API
  const payload = JSON.stringify({
    access_token: accessToken,
  })

  const options = {
    hostname: "api.github.com",
    port: 443,
    path: `/applications/${secrets.clientId}/token`,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": gitHubAppId,
      Authorization:
        "Basic " +
        Buffer.from(`${secrets.clientId}:${secrets.clientSecret}`).toString(
          "base64",
        ),
      "Content-Length": payload.length,
    },
  }

  let username = undefined
  try {
    const res = (await httpRequest(options, payload)) as {
      user?: {
        login?: string
        type?: string
      }
    }
    const userLogin = res?.user?.login
    const userType = res.user?.type
    if (!userLogin || !userType || userType !== "User") {
      console.warn("No valid user found in response from GitHub")
      throw new Error("Unauthenticated")
    }
    username = userLogin
  } catch (e) {
    throw new Error("Unauthenticated")
  }

  let authenticated = false
  let organizationNames: string[] = []
  if (accessControl.type === "USERNAME") {
    authenticated = accessControl.whitelist.includes(username.toLowerCase())
  } else if (accessControl.type === "ORG_MEMBERSHIP") {
    const organizationResponse = await getGitHubOrgsForUser(
      accessToken,
      gitHubAppId,
    )
    organizationNames = organizationResponse.map((o) => o.login.toLowerCase())
    authenticated = accessControl.whitelist.some((whitelistedOrg) =>
      organizationNames.includes(whitelistedOrg.toLowerCase()),
    )
  }

  if (authenticated) {
    const userInstallations = await getGitHubAppInstallationsForUser(
      accessToken,
      gitHubAppId,
    )
    const installationIds = userInstallations.installations.map(
      (installation) => `${installation.id}`,
    )
    const context = {
      ...(installationIds.length > 0 && {
        installationIds: JSON.stringify(installationIds),
      }),
      ...(organizationNames.length > 0 && {
        organizationNames: JSON.stringify(organizationNames),
      }),
    }
    const authReponse: lambdaTypes.APIGatewayAuthorizerResult = {
      ...(Object.keys(context).length > 0 && {
        context,
      }),
      principalId: username,
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Allow",
            Resource: event.methodArn,
          },
        ],
      },
    }

    if (useCache) {
      await dynamodb
        .put({
          Item: {
            PK: value,
            SK: event.methodArn,
            ttl: Math.floor(
              Date.now() / 1000 + parseInt(authorizerCacheTtl, 10),
            ),
            cachedResponse: authReponse,
          },
          TableName: authorizerCacheTableName,
        })
        .promise()
    }
    return authReponse
  }
  throw new Error("Unauthenticated")
}
