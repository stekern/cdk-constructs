import * as cdk from "aws-cdk-lib"
import * as constructs from "constructs"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as apigateway from "aws-cdk-lib/aws-apigateway"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as route53targets from "aws-cdk-lib/aws-route53-targets"
import * as sm from "aws-cdk-lib/aws-secretsmanager"
import * as cm from "aws-cdk-lib/aws-certificatemanager"
import * as logs from "aws-cdk-lib/aws-logs"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import * as path from "path"

type Props = {
  /**
   * The ID of the GitHub application.
   */
  gitHubAppId: string
  /**
   * A secret containing a token used to sign and validate requests.
   */
  gitHubWebhookSecret: sm.ISecret
  /**
   * A DynamoDB table to store received workflow runs in.
   *
   * NOTE: The table must be set up with a composite partition key
   * consisting of a string partition key `PK` and a string sort key `SK`.
   */
  table: dynamodb.ITable
  /**
   * The hosted zone to create the A record for the domain name in.
   */
  hostedZone: route53.IHostedZone
  /**
   * The domain name to use for the API Gateway REST API.
   */
  domainName: string
  /**
   * Whether to enable X-Ray tracing for the API Gateway REST API.
   *
   * @default false
   */
  tracingEnabled?: boolean
  /**
   * Certificate set up in us-east-1 to use with the API Gateway REST API.
   */
  certificate: cm.ICertificate
}

/**
 * Sets up an API Gateway REST API with a Lambda integration
 * for receiving webhook events from GitHub related to workflow runs.
 */
export class GitHubWorkflowRunWebhookApi extends constructs.Construct {
  public readonly webhookReceiverFn: lambda.IFunction
  public readonly webhookApi: apigateway.LambdaRestApi
  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)
    const webhookReceiverFn = new NodejsFunction(
      this,
      "WebhookReceiverLambda",
      {
        entry: path.join(
          __dirname,
          "../assets/github-workflow-run-webhook-receiver/index.ts",
        ),
        bundling: {
          nodeModules: [],
        },
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_16_X,
        timeout: cdk.Duration.seconds(10),
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment: {
          GITHUB_APP_ID: props.gitHubAppId,
          SECRET_NAME: props.gitHubWebhookSecret.secretName,
          TABLE_NAME: props.table.tableName,
        },
      },
    )
    props.gitHubWebhookSecret.grantRead(webhookReceiverFn)
    props.table.grantReadWriteData(webhookReceiverFn)
    this.webhookReceiverFn = webhookReceiverFn
    const api = new apigateway.LambdaRestApi(this, "WebhookApi", {
      domainName: {
        domainName: props.domainName,
        endpointType: apigateway.EndpointType.EDGE,
        certificate: props.certificate,
      },
      handler: webhookReceiverFn,
      endpointTypes: [apigateway.EndpointType.EDGE],
      disableExecuteApiEndpoint: true,
    })
    this.webhookApi = api

    if (props.tracingEnabled) {
      ;(
        api.deploymentStage.node.defaultChild as apigateway.CfnStage
      ).addPropertyOverride("TracingEnabled", true)
    }

    new route53.ARecord(this, "Record", {
      zone: props.hostedZone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new route53targets.ApiGateway(api),
      ),
    })
  }
}
