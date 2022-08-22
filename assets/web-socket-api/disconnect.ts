import { APIGatewayProxyEvent } from "aws-lambda"
import DynamoDB from "aws-sdk/clients/dynamodb"

const dynamodb = new DynamoDB.DocumentClient({ apiVersion: "2012-08-10" })

export const handler = async (event: APIGatewayProxyEvent) => {
  const tableName = process.env.TABLE_NAME
  if (!tableName) {
    console.error("Missing required environment variable")
    return {
      statusCode: 500,
    }
  }
  const params: DynamoDB.DocumentClient.DeleteItemInput = {
    TableName: tableName,
    Key: {
      connectionId: event.requestContext.connectionId,
    },
  }

  try {
    await dynamodb.delete(params).promise()
  } catch (err) {
    console.error("Failed to delete item from DynamoDB")
    return {
      statusCode: 500,
    }
  }

  return { statusCode: 200 }
}
