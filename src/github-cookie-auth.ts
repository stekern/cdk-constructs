import * as cdk from "aws-cdk-lib"
import * as constructs from "constructs"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as kms from "aws-cdk-lib/aws-kms"
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
   * The amount of time to cache responses from
   * the Lambda authorizer
   */
  authorizerResponseTtl: cdk.Duration
  /**
   * The ID of the GitHub application.
   */
  gitHubAppId: string
  /**
   * A Secrets Manager secret containing the client credentials
   * for the GitHub App in JSON format:
   * {
   *   "clientId": "<client-id>",
   *   "clientSecret": "<client-secret>"
   * }
   */
  clientCredentials: sm.ISecret
  authCookieConfiguration: {
    /**
     * A KMS key that will be used to encrypt the access token
     * stored in the cookie.
     */
    encryptionKey: kms.IKey
    /**
     * The name of the cookie to store the encrypted GitHub access token in.
     * @default token
     */
    name?: string
    attributes?: {
      /**
       * @default true
       */
      secure?: boolean
      /**
       * @default true
       */
      httpOnly?: boolean
      /**
       * @default null
       */
      domain?: string
      /**
       * @default Strict
       */
      sameSite?: "Strict" | "Lax" | "None"
    }
  }
  nonceCookieConfiguration: {
    /**
     * The name of the cookie to store the nonce in.
     * @default nonce
     */
    name?: string
    attributes?: {
      /**
       * @default true
       */
      secure?: boolean
      /**
       * @default true
       */
      httpOnly?: boolean
      /**
       * @default null
       */
      domain?: string
      /**
       * NOTE: This needs to be Lax in order for the nonce
       * cookie to be sent when GitHub redirects the client to
       * our callback
       *
       * @default Lax
       */
      sameSite?: "Strict" | "Lax" | "None"
    }
  }
  /**
   * The access control to use in the Lambda authorizer.
   */
  accessControl: {
    /**
     * The type of access control to perform, either
     * based on username or the user's organization membership.
     *
     * NOTE: `ORG_MEMBERSHIP` requires that the associated GitHub
     * application has been installed in the respective organization(s)
     */
    type: "USERNAME" | "ORG_MEMBERSHIP"
    /**
     * A list of GitHub usernames or GitHub organization names that will
     * be granted access.
     */
    whitelist: string[]
  }
  /**
   * Configuration for a Lambda-backed API Gateway that
   * is used to exchange temporary codes for GitHub
   * access tokens using GitHub's web application flow
   * and ultimately stores these in encrypted cookies.
   */
  apiConfiguration: {
    /**
     * The hosted zone to create the A record
     * for the domain name
     */
    hostedZone: route53.IHostedZone
    /**
     * The domain name to use for the API.
     */
    domainName: string
    /**
     * Certificate set up in us-east-1 to use with the proxy API
     */
    certificate: cm.ICertificate
    /**
     * The origin that is allowed to communicate with the API.
     * This is sent as part of the CORS preflight response, and
     * also verified in the Lambda authorizer to prevent CSRF
     * (especially important if the authorizer is used for a
     * WebSocket API).
     *
     * NOTE: This can't be a wildcard as it is not compatible with
     * the Access-Control-Allow-Credentials header.
     */
    allowedOrigin: string
    /**
     * The URL to redirect the client to after an access token
     * has been obtained from GitHub.
     */
    redirectUrl: string
  }
}

/**
 * An API Gateway REST API that implements GitHub's
 * web application flow for generating a user access token,
 * stores the access token in an encrypted cookie, and a
 * Lambda authorizer that can use the cookie (and thus access
 * token) for authentication and authorization purposes.
 */
export class GitHubCookieAuth extends constructs.Construct {
  public readonly authorizer
  public readonly authorizerFn
  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)
    const responseHeaders = {
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": apigateway.Cors.ALL_METHODS.join(","),
      "Access-Control-Allow-Origin": props.apiConfiguration.allowedOrigin,
    }

    /*
     * Table for caching Lambda authorizer responses
     * There is built-in support for this in REST APIs, but not for WebSocket APIs
     */
    const cacheTable = new dynamodb.Table(this, "CacheTable", {
      partitionKey: {
        name: "PK",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "SK",
        type: dynamodb.AttributeType.STRING,
      },
      timeToLiveAttribute: "ttl",
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    // Set default values
    const authCookieName = props.authCookieConfiguration.name || "token"
    const authCookieAttributes: Props["authCookieConfiguration"]["attributes"] =
      {
        secure: true,
        httpOnly: true,
        sameSite: "Strict",
        ...props.authCookieConfiguration.attributes,
      }

    const nonceCookieName = props.nonceCookieConfiguration.name || "nonce"
    const nonceCookieAttributes: Props["nonceCookieConfiguration"]["attributes"] =
      {
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
        ...props.nonceCookieConfiguration.attributes,
      }

    this.authorizerFn = new NodejsFunction(this, "AuthorizerLambda", {
      entry: path.join(__dirname, "../assets/github-cookie-auth/authorizer.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        ALLOWED_ORIGIN: props.apiConfiguration.allowedOrigin,
        SECRET_NAME: props.clientCredentials.secretName,
        AUTH_COOKIE_NAME: authCookieName,
        AUTH_COOKIE_ENCRYPTION_KEY_ARN:
          props.authCookieConfiguration.encryptionKey.keyArn,
        ACCESS_CONTROL: JSON.stringify({
          ...props.accessControl,
          whitelist: props.accessControl.whitelist.map((item) =>
            item.toLowerCase(),
          ),
        }),
        GITHUB_APP_ID: props.gitHubAppId,
        AUTHORIZER_CACHE_TABLE_NAME: cacheTable.tableName,
        AUTHORIZER_CACHE_TTL: `${props.authorizerResponseTtl.toSeconds()}`,
      },
      tracing: lambda.Tracing.ACTIVE,
    })
    cacheTable.grantReadWriteData(this.authorizerFn)
    props.clientCredentials.grantRead(this.authorizerFn)
    props.authCookieConfiguration.encryptionKey.grantDecrypt(this.authorizerFn)

    this.authorizer = new apigateway.RequestAuthorizer(this, "Authorizer", {
      handler: this.authorizerFn,
      resultsCacheTtl: props.authorizerResponseTtl,
      identitySources: [apigateway.IdentitySource.header("Cookie")],
    })

    const requestFn = new NodejsFunction(this, "RequestLambda", {
      entry: path.join(
        __dirname,
        "../assets/github-cookie-auth/oauth-flow-request.ts",
      ),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_MONTH,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        RESPONSE_HEADERS: JSON.stringify(responseHeaders),
        NONCE_COOKIE_NAME: nonceCookieName,
        SECRET_NAME: props.clientCredentials.secretName,
        CALLBACK_URL: `https://${props.apiConfiguration.domainName}/callback`,
        NONCE_COOKIE_ATTRIBUTES: Object.entries(nonceCookieAttributes)
          .map(([attribute, value]) => {
            const capitalized =
              attribute.charAt(0).toUpperCase() + attribute.slice(1)
            return typeof value === "boolean"
              ? value
                ? capitalized
                : undefined
              : `${capitalized}=${value}`
          })
          .filter((v) => v)
          .join("; "),
      },
    })
    props.clientCredentials.grantRead(requestFn)

    const callbackFn = new NodejsFunction(this, "CallbackFn", {
      entry: path.join(
        __dirname,
        "../assets/github-cookie-auth/oauth-flow-callback.ts",
      ),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_MONTH,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        REDIRECT_URL: props.apiConfiguration.redirectUrl,
        NONCE_COOKIE_NAME: nonceCookieName,
        SECRET_NAME: props.clientCredentials.secretName,
        RESPONSE_HEADERS: JSON.stringify(responseHeaders),
        AUTH_COOKIE_NAME: authCookieName,
        AUTH_COOKIE_ENCRYPTION_KEY_ARN:
          props.authCookieConfiguration.encryptionKey.keyArn,
        AUTH_COOKIE_ATTRIBUTES: Object.entries(authCookieAttributes)
          .map(([attribute, value]) => {
            const capitalized =
              attribute.charAt(0).toUpperCase() + attribute.slice(1)
            return typeof value === "boolean"
              ? value
                ? capitalized
                : undefined
              : `${capitalized}=${value}`
          })
          .filter((v) => v)
          .join("; "),
      },
    })
    props.clientCredentials.grantRead(callbackFn)
    props.authCookieConfiguration.encryptionKey.grantEncrypt(callbackFn)

    const authProxyApi = new apigateway.RestApi(this, "ProxyApi", {
      defaultMethodOptions: {
        authorizationType: apigateway.AuthorizationType.NONE,
      },
      endpointTypes: [apigateway.EndpointType.EDGE],
      domainName: {
        domainName: props.apiConfiguration.domainName,
        endpointType: apigateway.EndpointType.EDGE,
        certificate: props.apiConfiguration.certificate,
      },
      defaultCorsPreflightOptions: {
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowCredentials: true,
        allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
        allowOrigins: props.apiConfiguration.allowedOrigin
          ? [props.apiConfiguration.allowedOrigin]
          : [],
      },
      disableExecuteApiEndpoint: true,
    })

    authProxyApi.root
      .addResource("request")
      .addMethod("GET", new apigateway.LambdaIntegration(requestFn))
    authProxyApi.root
      .addResource("callback")
      .addMethod("GET", new apigateway.LambdaIntegration(callbackFn))

    // Enable tracing
    ;(
      authProxyApi.deploymentStage.node.defaultChild as apigateway.CfnStage
    ).addPropertyOverride("TracingEnabled", true)

    new route53.ARecord(this, "Record", {
      zone: props.apiConfiguration.hostedZone,
      recordName: props.apiConfiguration.domainName,
      target: route53.RecordTarget.fromAlias(
        new route53targets.ApiGateway(authProxyApi),
      ),
    })
  }
}
