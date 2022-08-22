import { APIGatewayProxyEvent } from "aws-lambda"
import DynamoDB from "aws-sdk/clients/dynamodb"

const dynamodb = new DynamoDB.DocumentClient({ apiVersion: "2012-08-10" })

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
  const params: DynamoDB.DocumentClient.PutItemInput = {
    TableName: tableName,
    Item: {
      ...(storeAuthorizerProperties && event.requestContext.authorizer),
      connectionId: event.requestContext.connectionId,
    },
  }

  try {
    await dynamodb.put(params).promise()
  } catch (err) {
    console.error("Failed to store item in DynamoDB")
    return {
      statusCode: 500,
    }
  }

  return { statusCode: 200 }
}
