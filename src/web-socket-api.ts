import * as cdk from "aws-cdk-lib"
import * as constructs from "constructs"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as route53targets from "aws-cdk-lib/aws-route53-targets"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2"
import * as apigwv2alpha from "@aws-cdk/aws-apigatewayv2-alpha"
import * as apigwv2Integrations from "@aws-cdk/aws-apigatewayv2-integrations-alpha"
import * as apigwv2Authorizers from "@aws-cdk/aws-apigatewayv2-authorizers-alpha"
import * as cm from "aws-cdk-lib/aws-certificatemanager"
import * as logs from "aws-cdk-lib/aws-logs"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import * as path from "path"

type Props = {
  /**
   * An optional authorizer that will be used for
   * the intial WebSocket handshake.
   */
  authorizer?: apigwv2Authorizers.WebSocketLambdaAuthorizer
  /**
   * The hosted zone to create the A record
   * for the domain name
   */
  hostedZone: route53.IHostedZone
  /**
   * The domain name to use for the WebSocket API.
   */
  domainName: string
  /**
   * A certificate for the domain name. The certificate has to have
   * been created in the current region.
   */
  certificate: cm.ICertificate
  /**
   * Whether to store the properties under `$context.authorizer` together
   * with the connection ID in DynamoDB.
   */
  storeAuthorizerProperties?: boolean
}

/**
 * Sets up an API Gateway WebSocket API with
 * a custom domain name, connection table in DynamoDB
 * and Lambda handlers for the $connect and $disconnect routes
 */
export class WebSocketApi extends constructs.Construct {
  public readonly connectionTable
  public readonly domainName
  public readonly api
  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)
    this.connectionTable = new dynamodb.Table(this, "ConnectionTable", {
      partitionKey: {
        name: "connectionId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const connectFn = new NodejsFunction(this, "ConnectLambda", {
      entry: path.join(__dirname, "../assets/web-socket-api/connect.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_16_X,
      timeout: cdk.Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        TABLE_NAME: this.connectionTable.tableName,
        STORE_AUTHORIZER_PROPERTIES: props.storeAuthorizerProperties
          ? "true"
          : "false",
      },
    })
    const disconnectFn = new NodejsFunction(this, "DisconnectLambda", {
      entry: path.join(__dirname, "../assets/web-socket-api/disconnect.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_16_X,
      timeout: cdk.Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        TABLE_NAME: this.connectionTable.tableName,
      },
    })
    this.connectionTable.grantReadWriteData(connectFn)
    this.connectionTable.grantReadWriteData(disconnectFn)

    this.api = new apigwv2alpha.WebSocketApi(this, "WebSocketApi", {
      connectRouteOptions: {
        authorizer: props.authorizer,
        integration: new apigwv2Integrations.WebSocketLambdaIntegration(
          "ConnectIntegration",
          connectFn,
        ),
      },
      disconnectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration(
          "DisconnectIntegration",
          disconnectFn,
        ),
      },
    })
    ;(this.api.node.defaultChild as apigwv2.CfnApi).addPropertyOverride(
      "DisableExecuteApiEndpoint",
      true,
    )
    const stage = new apigwv2alpha.WebSocketStage(this, "Stage", {
      webSocketApi: this.api,
      stageName: "prod",
      autoDeploy: true,
    })
    this.domainName = new apigwv2alpha.DomainName(this, "DomainName", {
      certificate: props.certificate,
      domainName: props.domainName,
    })
    const apiMapping = new apigwv2alpha.ApiMapping(this, "ApiMapping", {
      api: this.api,
      domainName: this.domainName,
      stage: stage,
    })
    new route53.ARecord(this, "Record", {
      recordName: props.domainName,
      zone: props.hostedZone,
      target: route53.RecordTarget.fromAlias(
        new route53targets.ApiGatewayv2DomainProperties(
          this.domainName.regionalDomainName,
          this.domainName.regionalHostedZoneId,
        ),
      ),
    })
  }
}
