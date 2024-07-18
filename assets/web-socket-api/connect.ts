import { APIGatewayProxyEvent } from "aws-lambda"
import { DynamoDBDocument, PutCommandInput } from "@aws-sdk/lib-dynamodb"
import { DynamoDB } from "@aws-sdk/client-dynamodb"

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
  } catch (err) {
    console.error("Failed to store item in DynamoDB")
    return {
      statusCode: 500,
    }
  }

  return { statusCode: 200 }
}
