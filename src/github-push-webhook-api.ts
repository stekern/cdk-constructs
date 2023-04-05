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
import * as sources from "aws-cdk-lib/aws-lambda-event-sources"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import * as path from "path"
import { ForwardingRule } from "../assets/github-push-webhook/types"

type Props = {
  /**
   * A secret containing a token used to sign and validate requests from GitHub.
   */
  gitHubWebhookSecret: sm.ISecret
  /**
   * Overrides for the DynamoDB table used for storing GitHub push events.
   *
   * NOTE: `partitionKey` and `sortKey` can't be overridden.
   */
  tableOverrides?: Partial<dynamodb.TableProps>
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
   * Certificate set up in the current region to use with the API Gateway REST API.
   */
  certificate: cm.ICertificate
}

/**
 * Creates a Lambda-backed API Gateway REST API for receiving GitHub webhook push events
 * and persisting them in a DynamoDB table.
 */
export class GitHubPushWebhookApi extends constructs.Construct {
  public readonly webhookReceiverFn: lambda.IFunction
  public readonly webhookApi: apigateway.LambdaRestApi
  public readonly table: dynamodb.ITable
  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)
    this.table = new dynamodb.Table(this, "GitHubPushTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      ...props.tableOverrides,
      partitionKey: {
        name: "PK",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "SK",
        type: dynamodb.AttributeType.STRING,
      },
    })
    const webhookReceiverFn = new NodejsFunction(
      this,
      "WebhookReceiverLambda",
      {
        entry: path.join(
          __dirname,
          "../assets/github-push-webhook/webhook-receiver.ts",
        ),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_16_X,
        timeout: cdk.Duration.seconds(10),
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment: {
          SECRET_NAME: props.gitHubWebhookSecret.secretName,
          TABLE_NAME: this.table.tableName,
        },
      },
    )

    props.gitHubWebhookSecret.grantRead(webhookReceiverFn)
    this.table.grantReadWriteData(webhookReceiverFn)
    this.webhookReceiverFn = webhookReceiverFn
    const api = new apigateway.LambdaRestApi(this, "WebhookApi", {
      domainName: {
        domainName: props.domainName,
        endpointType: apigateway.EndpointType.REGIONAL,
        certificate: props.certificate,
      },
      handler: webhookReceiverFn,
      proxy: false,
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      disableExecuteApiEndpoint: true,
    })
    api.root.addMethod("POST")
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

  /**
   * Forward GitHub push events to a repository's default
   * branch to Slack.
   */
  public addSlackForwarder(
    slackWebhookUrl: string,
    forwardingRules: ForwardingRule[],
  ) {
    /*
     * Forward DynamoDB stream event to Slack
     */
    const streamFn = new NodejsFunction(this, "StreamFn", {
      entry: path.join(
        __dirname,
        "../assets/github-push-webhook/slack-forwarder.ts",
      ),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_16_X,
      timeout: cdk.Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        SLACK_WEBHOOK_URL: slackWebhookUrl,
        FORWARDING_RULES: JSON.stringify(forwardingRules),
      },
    })
    this.table.grantStreamRead(streamFn)
    streamFn.addEventSource(
      new sources.DynamoEventSource(this.table, {
        startingPosition: lambda.StartingPosition.LATEST,
        maxRecordAge: cdk.Duration.minutes(2),
        bisectBatchOnError: true,
        batchSize: 5,
        filters: [
          lambda.FilterCriteria.filter({
            eventName: ["INSERT"],
            dynamodb: {
              NewImage: {
                isDefaultBranch: {
                  BOOL: [true],
                },
              },
            },
          }),
        ],
      }),
    )
  }
}
