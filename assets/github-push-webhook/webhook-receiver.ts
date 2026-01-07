import { createHmac, timingSafeEqual } from "node:crypto"
import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { SecretsManager } from "@aws-sdk/client-secrets-manager"
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm"
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb"
import type * as lambdaTypes from "aws-lambda"
import type { DbPushEvent } from "./types"

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

const dynamodb = DynamoDBDocument.from(new DynamoDB())

const timingSafeStringComparison = (a: string, b: string) => {
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
  } catch {
    // Catch errors that may arise from trying to create buffer
    // from non-strings
    return false
  }
}

export const handler = async (event: lambdaTypes.APIGatewayProxyEvent) => {
  console.log("Triggered with event:", JSON.stringify(event, null, 2))

  const tableName = process.env.TABLE_NAME
  const secretName = process.env.SECRET_NAME
  const secretType = process.env.SECRET_TYPE || "secrets-manager"

  if (!tableName || !secretName) {
    console.error("Missing required environment variables")
    return {
      statusCode: 500,
    }
  }

  const signature = event.headers["X-Hub-Signature-256"] || null
  if (!signature) {
    console.warn("The request was missing a signature header")
    return {
      statusCode: 500,
    }
  }

  if (!event.body) {
    console.warn("The request body is missing")
    return {
      statusCode: 500,
    }
  }

  const secretToken = await getSecretValue(secretName, secretType)
  if (!secretToken) {
    console.error("Could not properly read secret")
    return {
      statusCode: 500,
    }
  }

  const expectedSignature = `sha256=${createHmac("sha256", secretToken).update(event.body).digest("hex")}`
  if (!timingSafeStringComparison(signature, expectedSignature)) {
    console.warn(
      `Signature '${signature}' did not match expected signature '${expectedSignature}'`,
    )
    return {
      statusCode: 500,
    }
  }

  const payload = JSON.parse(event.body) as DbPushEvent["payload"]

  // TODO: A more robust and scalable approach for runtime validation
  if (
    !(
      payload.ref &&
      payload.pusher &&
      payload.sender &&
      payload.head_commit &&
      payload.repository &&
      payload.repository.node_id &&
      payload.repository.full_name &&
      payload.repository.pushed_at
    )
  ) {
    console.warn("Payload is missing expected attributes")
    return {
      statusCode: 500,
    }
  }
  if (!payload.ref.startsWith("refs/heads/")) {
    console.debug("Webhook was not triggered by a push to a branch")
    return {
      statusCode: 200,
    }
  }
  const branch = payload.ref.split("refs/heads/").slice(-1)[0]
  const shortCommitHash = payload.head_commit.id.substring(0, 8)
  const defaultBranch = payload.repository.default_branch
  const isDefaultBranch = branch === defaultBranch
  const ddbItem: DbPushEvent = {
    PK: payload.repository.node_id,
    SK: `${branch}#${shortCommitHash}#${payload.repository.pushed_at}`,
    schemaVersion: "0.1",
    // NOTE: A hack to avoid issues I've experienced with
    // the DynamoDB marshalling
    payload: JSON.parse(JSON.stringify(payload)) as DbPushEvent["payload"],
    branch: branch,
    isDefaultBranch,
  }
  await dynamodb.put({
    TableName: tableName,
    Item: ddbItem,
  })

  return {
    statusCode: 200,
  }
}
