import * as cdk from "aws-cdk-lib"
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as origins from "aws-cdk-lib/aws-cloudfront-origins"
import * as targets from "aws-cdk-lib/aws-route53-targets"
import * as cloudfront from "aws-cdk-lib/aws-cloudfront"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as cm from "aws-cdk-lib/aws-certificatemanager"
import * as sm from "aws-cdk-lib/aws-secretsmanager"
import * as iam from "aws-cdk-lib/aws-iam"
import * as constructs from "constructs"

export interface CloudFrontedHttpApiProps {
  /**
   * An optional existing HTTP API to put CloudFront in front of
   * Note that the default API endpoint is used when configuring
   * the CloudFront origin, so make sure this endpoint is not disabled.
   *
   * @default - a new HTTP API is created
   */
  api?: apigwv2.IHttpApi
  /**
   * Overrides for the CloudFront distribution properties
   */
  distributionOverrides?: Partial<cloudfront.DistributionProps>
  /** Overrides for the CloudFront distribution default
   * behavior options
   */
  distributionBehaviorOverrides?: Partial<cloudfront.BehaviorOptions>
  /**
   * Configuration for a custom domain to associate with the
   * CloudFront distribution
   */
  customDomain?: {
    /**
     * A custom domain name to configure the CloudFront distribution to use
     */
    domainName: string
    /**
     * The hosted zone to use when creating the A record
     * for the custom domain name
     */
    hostedZone: route53.IHostedZone
    /**
     * A certificate set up in the us-east-1 region to associate with the
     * CloudFront distribution
     */
    certificate: cm.ICertificate
  }
}

/**
 * Route all traffic to an AWS API Gateway HTTP API through
 * Amazon CloudFront by utilizing a shared secret that CloudFront
 * adds to all requests, and which is then validated by API Gateway.
 *
 * Putting a CloudFront distribution in front of your HTTP API can be especially
 * useful if you want to associate an AWS Web Application Firewall (WAF) with
 * your HTTP API - something that isn't supported out-of-the-box today.
 *
 * @remarks
 * For cost-efficiency purposes the secret is stored as
 * a part of a HTTP header name, not a HTTP header value.
 * This is because API Gateway won't invoke our Lambda authorizer
 * (or charge for API requests, as far as I know) unless the required header
 * is included in the request.
 *
 * Furthermore, the token will be available in cleartext for anyone with read
 * access to your AWS account. This is not ideal, but it's difficult
 * circumvent due to limitations in AWS. AWS's articles and guides on
 * the same topic suffer from the same issue... (e.g., http://web.archive.org/web/20240225081539/https://aws.amazon.com/blogs/networking-and-content-delivery/restricting-access-http-api-gateway-lambda-authorizer/)
 */
export class CloudFrontedHttpApi extends constructs.Construct {
  /** The HTTP API */
  public readonly api: apigwv2.IHttpApi
  /** The CloudFront distribution fronting the HTTP API */
  public readonly distribution: cloudfront.Distribution
  /** The authorizer for the HTTP API */
  public readonly authorizer: apigwv2.HttpAuthorizer

  constructor(
    scope: constructs.Construct,
    id: string,
    props?: CloudFrontedHttpApiProps,
  ) {
    super(scope, id)
    const { account, region } = cdk.Stack.of(this)
    const secret = new sm.Secret(this, "TokenSecret", {
      generateSecretString: {
        includeSpace: false,
        excludeNumbers: false,
        passwordLength: 64,
        excludeLowercase: false,
        excludeUppercase: true,
        excludePunctuation: true,
      },
    })

    const secretHeaderName = `x-cftoken-${secret.secretValue.unsafeUnwrap()}`

    const authorizerFn = new lambda.Function(this, "AuthorizerLambda", {
      handler: "index.handler",
      code: lambda.Code.fromInline(
        // NOTE: We always return true because if the Lambda authorizer has been called,
        // API Gateway has already verified the existence of the HTTP header - which is
        // where our secet actually is stored
        `exports.handler = async () => ({ isAuthorized: true })`,
      ),
      runtime: lambda.Runtime.NODEJS_20_X,
    })
    this.api = props?.api || new apigwv2.HttpApi(this, "Api")
    this.authorizer = new apigwv2.HttpAuthorizer(this, "Authorizer", {
      type: apigwv2.HttpAuthorizerType.LAMBDA,
      resultsCacheTtl: cdk.Duration.hours(1),
      identitySource: [`$request.header.${secretHeaderName}`],
      httpApi: this.api,
      authorizerUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${authorizerFn.functionArn}/invocations`,
      enableSimpleResponses: true,
    })

    authorizerFn.addPermission("GrantInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      sourceArn: `arn:aws:execute-api:${region}:${account}:${this.api.apiId}/authorizers/${this.authorizer.authorizerId}`,
    })

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      ...(props?.customDomain && {
        certificate: props.customDomain.certificate,
        domainNames: [props.customDomain.domainName],
      }),
      defaultBehavior: {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        originRequestPolicy:
          cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        origin: new origins.HttpOrigin(
          `${this.api.apiId}.execute-api.${region}.amazonaws.com`,
          {
            customHeaders: {
              // NOTE: The header value doesn't really matter, it just
              // needs to be a non-empty string
              [secretHeaderName]: "ok",
            },
          },
        ),
        ...props?.distributionBehaviorOverrides,
      },
      ...props?.distributionOverrides,
    })

    if (props?.customDomain) {
      new route53.ARecord(this, "ARecord", {
        recordName: props.customDomain.domainName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(this.distribution),
        ),
        zone: props.customDomain.hostedZone,
      })
    }
  }
}
