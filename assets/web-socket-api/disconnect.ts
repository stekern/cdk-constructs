import { DynamoDB } from "@aws-sdk/client-dynamodb"
import {
  type DeleteCommandInput,
  DynamoDBDocument,
} from "@aws-sdk/lib-dynamodb"
import type { APIGatewayProxyEvent } from "aws-lambda"

const dynamodb = DynamoDBDocument.from(new DynamoDB())

export const handler = async (event: APIGatewayProxyEvent) => {
  const tableName = process.env.TABLE_NAME
  if (!tableName) {
    console.error("Missing required environment variable")
    return {
      statusCode: 500,
    }
  }
  const params: DeleteCommandInput = {
    TableName: tableName,
    Key: {
      connectionId: event.requestContext.connectionId,
    },
  }

  try {
    await dynamodb.delete(params)
  } catch (_err) {
    console.error("Failed to delete item from DynamoDB")
    return {
      statusCode: 500,
    }
  }

  return { statusCode: 200 }
}
