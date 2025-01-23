import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocument, type PutCommandInput } from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEvent } from "aws-lambda"

const dynamodb = DynamoDBDocument.from(new DynamoDB())

export const handler = async (event: APIGatewayProxyEvent) => {
  const tableName = process.env.TABLE_NAME
  const storeAuthorizerProperties =
    (process.env.STORE_AUTHORIZER_PROPERTIES || "false") === "true"
  if (!tableName) {
    console.error("Missing required environment variable")
    return {
      statusCode: 500,
    }
  }
  const params: PutCommandInput = {
    TableName: tableName,
    Item: {
      ...(storeAuthorizerProperties && event.requestContext.authorizer),
      connectionId: event.requestContext.connectionId,
    },
  }

  try {
    await dynamodb.put(params)
  } catch (_err) {
    console.error("Failed to store item in DynamoDB")
    return {
      statusCode: 500,
    }
  }

  return { statusCode: 200 }
}
