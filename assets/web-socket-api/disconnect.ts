import { APIGatewayProxyEvent } from "aws-lambda"
import { DeleteCommandInput, DynamoDBDocument } from "@aws-sdk/lib-dynamodb"
import { DynamoDB } from "@aws-sdk/client-dynamodb"

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
  } catch (err) {
    console.error("Failed to delete item from DynamoDB")
    return {
      statusCode: 500,
    }
  }

  return { statusCode: 200 }
}
