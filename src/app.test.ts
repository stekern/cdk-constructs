import * as cdk from "aws-cdk-lib"
import * as assertions from "aws-cdk-lib/assertions"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as cm from "aws-cdk-lib/aws-certificatemanager"
import * as sm from "aws-cdk-lib/aws-secretsmanager"
import * as kms from "aws-cdk-lib/aws-kms"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as apigw from "aws-cdk-lib/aws-apigateway"
import * as customconstructs from "."

describe("SfnProwlerTask", () => {
  test("should match snapshot", () => {
    const app = new cdk.App()
    const stack = new cdk.Stack(app, "Stack")
    const cluster = new ecs.Cluster(stack, "Cluster")
    new customconstructs.SfnProwlerTask(stack, "ProwlerTask", {
      cluster,
    })
    expect(assertions.Template.fromStack(stack).toJSON()).toMatchSnapshot()
  })
})
describe("GitHubPushWebhookApi", () => {
  test("should match snapshot", () => {
    const app = new cdk.App()
    const stack = new cdk.Stack(app, "Stack")
    const domainName = "example.com"
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      stack,
      "HostedZone",
      {
        zoneName: domainName,
        hostedZoneId: "/hostedzone/ABCDEF12345678",
      },
    )
    const certificate = new cm.Certificate(stack, "Certificate", {
      domainName: `*.${domainName}`,
      validation: cm.CertificateValidation.fromDns(hostedZone),
    })
    const gitHubWebhookSecret = new sm.Secret(stack, "Secret", {
      description:
        "Secret token used for validating webhook requests from GitHub",
    })
    new customconstructs.GitHubPushWebhookApi(stack, "GitHubPushWebhookApi", {
      domainName,
      hostedZone,
      certificate,
      gitHubWebhookSecret,
    })
    expect(assertions.Template.fromStack(stack).toJSON()).toMatchSnapshot()
  })
})
describe("GitHubCookieAuth", () => {
  test("should match snapshot", () => {
    const app = new cdk.App()
    const stack = new cdk.Stack(app, "Stack")
    const domainName = "example.com"
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      stack,
      "HostedZone",
      {
        zoneName: domainName,
        hostedZoneId: "/hostedzone/ABCDEF12345678",
      },
    )
    const certificate = new cm.Certificate(stack, "Certificate", {
      domainName: `*.${domainName}`,
      validation: cm.CertificateValidation.fromDns(hostedZone),
    })
    const clientCredentials = new sm.Secret(stack, "ClientCredentials")
    const key = new kms.Key(stack, "Key")
    const gitHubCookieAuth = new customconstructs.GitHubCookieAuth(
      stack,
      "GitHubCookieAuth",
      {
        gitHubAppId: "123456",
        authorizerResponseTtl: cdk.Duration.minutes(15),
        clientCredentials,
        authCookieConfiguration: {
          encryptionKey: key,
          attributes: {
            domain: domainName,
          },
        },
        nonceCookieConfiguration: {
          name: "nonce",
        },
        accessControl: {
          type: "USERNAME",
          whitelist: ["user"],
        },
        apiConfiguration: {
          certificate,
          domainName: `auth.${domainName}`,
          hostedZone,
          allowedOrigin: `https://app.${domainName}`,
          redirectUrl: `https://app.${domainName}`,
        },
      },
    )

    // NOTE: An authorizer needs to be attached to a REST API, so we need to attach it to a dummy API for the test to work
    new apigw.RestApi(stack, "Api", {
      defaultMethodOptions: {
        authorizer: gitHubCookieAuth.authorizer,
      },
    }).root.addMethod("GET")
    expect(assertions.Template.fromStack(stack).toJSON()).toMatchSnapshot()
  })
})
describe("WebSocketApi", () => {
  test("should match snapshot", () => {
    const app = new cdk.App()
    const stack = new cdk.Stack(app, "Stack")
    const domainName = "example.com"
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      stack,
      "HostedZone",
      {
        zoneName: domainName,
        hostedZoneId: "/hostedzone/ABCDEF12345678",
      },
    )
    const certificate = new cm.Certificate(stack, "Certificate", {
      domainName: `*.${domainName}`,
      validation: cm.CertificateValidation.fromDns(hostedZone),
    })
    new customconstructs.WebSocketApi(stack, "WebSocketApi", {
      domainName: `socket.${domainName}`,
      hostedZone,
      certificate,
    })
    expect(assertions.Template.fromStack(stack).toJSON()).toMatchSnapshot()
  })
})
describe("GitHubWorkflowRunWebhookApi", () => {
  test("should match snapshot", () => {
    const app = new cdk.App()
    const stack = new cdk.Stack(app, "Stack")
    const domainName = "example.com"
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      stack,
      "HostedZone",
      {
        zoneName: domainName,
        hostedZoneId: "/hostedzone/ABCDEF12345678",
      },
    )
    const certificate = new cm.Certificate(stack, "Certificate", {
      domainName: `*.${domainName}`,
      validation: cm.CertificateValidation.fromDns(hostedZone),
    })
    const gitHubWebhookSecret = new sm.Secret(stack, "WebhookTokenSecret", {
      description:
        "Secret token used for validating webhook requests from GitHub",
    })
    const table = new dynamodb.Table(stack, "Table", {
      partitionKey: {
        name: "PK",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "SK",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    })
    new customconstructs.GitHubWorkflowRunWebhookApi(stack, "WebhookApi", {
      gitHubAppId: "123456",
      gitHubWebhookSecret,
      domainName: `hooks.${domainName}`,
      table,
      hostedZone,
      certificate,
    })
    expect(assertions.Template.fromStack(stack).toJSON()).toMatchSnapshot()
  })
})