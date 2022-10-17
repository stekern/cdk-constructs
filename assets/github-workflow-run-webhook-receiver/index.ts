import * as lambdaTypes from "aws-lambda"
import * as octokitWebhooksTypes from "@octokit/webhooks-types"
import { createHmac } from "crypto"
import SecretsManager from "aws-sdk/clients/secretsmanager"
import DynamoDB from "aws-sdk/clients/dynamodb"
import { AWSError } from "aws-sdk"
import { timingSafeEqual } from "crypto"

const secretsManager = new SecretsManager({
  apiVersion: "2017-10-17",
})
const dynamodb = new DynamoDB.DocumentClient({
  apiVersion: "2012-08-10",
})

export const timingSafeStringComparison = (a: string, b: string) => {
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
  } catch {
    // Catch errors that may arise from trying to create buffer
    // from non-strings
    return false
  }
}

export const isAWSError = (arg: unknown): arg is AWSError => {
  return (
    arg !== null &&
    typeof arg === "object" &&
    typeof (arg as Record<string, unknown>).code === "string" &&
    typeof (arg as Record<string, unknown>).message === "string"
  )
}

export const handler = async (event: lambdaTypes.APIGatewayProxyEvent) => {
  const tableName = process.env.TABLE_NAME
  const secretName = process.env.SECRET_NAME
  const gitHubAppId = process.env.GITHUB_APP_ID

  if (!tableName || !secretName || !gitHubAppId) {
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

  const secret = await secretsManager
    .getSecretValue({
      SecretId: secretName,
    })
    .promise()

  const secretToken = secret.SecretString || null
  if (!secretToken) {
    console.error("Could not properly read secret from Secrets Manager")
    return {
      statusCode: 500,
    }
  }

  const expectedSignature =
    "sha256=" +
    createHmac("sha256", secretToken).update(event.body).digest("hex")
  if (!timingSafeStringComparison(signature, expectedSignature)) {
    console.warn(
      `Signature '${signature}' did not match expected signature '${expectedSignature}'`,
    )
    return {
      statusCode: 500,
    }
  }
  const body = event.body
    ? (JSON.parse(event.body) as Record<string, unknown>)
    : {}
  if (
    !body.installation ||
    !body.workflow_run ||
    !body.action ||
    !body.workflow ||
    !body.repository ||
    !body.sender
  ) {
    console.warn("Received an event that were missing expected fields")
    return {
      statusCode: 200,
    }
  }

  const webhook = body as unknown as octokitWebhooksTypes.WorkflowRunEvent

  if (webhook.repository.default_branch === webhook.workflow_run.head_branch) {
    try {
      await dynamodb
        .put({
          TableName: tableName,
          Item: {
            PK: `${webhook.installation!.id}`,
            SK: webhook.workflow.node_id,
            repository: JSON.parse(
              JSON.stringify(webhook.repository),
            ) as Record<string, unknown>,
            installationId: `${webhook.installation!.id}`,
            workflow: JSON.parse(JSON.stringify(webhook.workflow)) as Record<
              string,
              unknown
            >,
            action: webhook.action,
            workflowRun: JSON.parse(
              JSON.stringify(webhook.workflow_run),
            ) as Record<string, unknown>,
          },
          ExpressionAttributeNames: {
            "#pk": "PK",
            "#sk": "SK",
            "#workflowRun": "workflowRun",
            "#started": "run_started_at",
            "#updated": "updated_at",
            "#action": "action",
          },
          ExpressionAttributeValues: {
            ":pk": `${webhook.installation!.id}`,
            ":sk": webhook.workflow.node_id,
            ":action": webhook.action,
            ":actionRequested": "requested",
            ":actionInProgress": "in_progress",
            ":actionCompleted": "completed",
            ":started": webhook.workflow_run.run_started_at,
            ":updated": webhook.workflow_run.updated_at,
          },
          ConditionExpression: `
          (attribute_not_exists(#pk) AND attribute_not_exists(#sk)) OR (
            #pk = :pk AND #sk = :sk AND (
              attribute_not_exists(#workflowRun) OR (
                #workflowRun.#started < :started OR (
                  #workflowRun.#started = :started AND
                  (
                    #workflowRun.#updated < :updated OR
                    (
                      #workflowRun.#updated = :updated AND (
                        (
                          #action = :actionRequested AND :action = :actionInProgress
                        ) OR (
                          #action = :actionInProgress AND :action = :actionCompleted
                        )
                      )
                    )
                  )
                )
              )
            )
          )`,
        })
        .promise()
    } catch (e) {
      if (isAWSError(e)) {
        if (e.code !== "ConditionalCheckFailedException") {
          throw e
        }
      } else {
        throw e
      }
    }
  }

  return {
    statusCode: 200,
  }
}
