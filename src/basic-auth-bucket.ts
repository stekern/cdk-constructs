import * as cdk from "aws-cdk-lib"
import * as constructs from "constructs"
import * as iam from "aws-cdk-lib/aws-iam"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as cm from "aws-cdk-lib/aws-certificatemanager"
import * as sm from "aws-cdk-lib/aws-secretsmanager"
import * as cloudfront from "aws-cdk-lib/aws-cloudfront"
import * as njs from "aws-cdk-lib/aws-lambda-nodejs"
import * as origins from "aws-cdk-lib/aws-cloudfront-origins"
import * as logs from "aws-cdk-lib/aws-logs"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as route53targets from "aws-cdk-lib/aws-route53-targets"
import * as crypto from "crypto"
import * as path from "path"

interface Props extends cdk.StackProps {
  /**
   * The domain name to configure the CloudFront distribution to use
   */
  domainName: string
  /**
   * The hosted zone to use for creating the A record
   * for the domain name
   */
  hostedZone: route53.IHostedZone
  /**
   * Certificate set up in us-east-1 to associate with the CloudFront distribution
   */
  certificate: cm.ICertificate
  /**
   * Secret set up in us-east-1 containing basic auth credentials.
   *
   * NOTE: The secret is expected to be in the following format:
   *
   * {
   *   "username": "<username>",
   *   "password:" "<password>"
   * }
   */
  secret: sm.ISecret
}

/**
 * Sets up an S3 bucket, CloudFront distribution and Lambda@Edge function to serve the contents of the bucket through a dedicated domain and authenticate requests using basic HTTP authentication.
 */
export class BasicAuthBucket extends constructs.Construct {
  public readonly protectedBucket: s3.IBucket

  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)
    if (cdk.Stack.of(this).region !== "us-east-1") {
      throw new Error(
        "The construct needs to be set up in a stack in us-east-1",
      )
    }
    const environmentVariables: { [key: string]: string } = {
      SECRET_NAME: props.secret.secretName,
    }
    Object.entries(environmentVariables).forEach(([key, val]) => {
      if (cdk.Token.isUnresolved(val)) {
        throw new Error(
          `Environment variables for Lambda@Edge can only contain values known at synth-time, but value of ${key} is an unresolved CDK token`,
        )
      }
    })
    const fn = new njs.NodejsFunction(this, "Fn", {
      entry: path.join(__dirname, "../assets/basic-auth-bucket/index.ts"),
      bundling: {
        // We use esbuild to replace static values during transpilation.
        // NOTE: This will not work for CDK Tokens (i.e., values that are not known at synth-time)
        define: Object.fromEntries(
          Object.entries(environmentVariables).map(([key, val]) => [
            `process.env.${key}`,
            `"${val}"`,
          ]),
        ),
      },
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(5),
      logRetention: logs.RetentionDays.ONE_MONTH,
    })
    props.secret.grantRead(fn)
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: ["arn:aws:logs:*:*:log-group:/aws/lambda/us-east-1.*"],
      }),
    )
    fn.role?.grantAssumeRole(
      new iam.ServicePrincipal("edgelambda.amazonaws.com"),
    )

    const protectedBucket = new s3.Bucket(this, "ProtectedBucket", {
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      accessControl: s3.BucketAccessControl.PRIVATE,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
    })

    const cloudfrontIdentity = new cloudfront.OriginAccessIdentity(
      this,
      "CloudFrontOriginAccessIdentity",
    )

    protectedBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [protectedBucket.arnForObjects("*")],
        principals: [
          new iam.CanonicalUserPrincipal(
            cloudfrontIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId,
          ),
        ],
      }),
    )
    // NOTE: We override the logical ID to include a sha256 hash of
    // the original logical ID to make the value easier to replace in
    // snapshot tests.
    const fnVersion = fn.currentVersion.node.defaultChild as lambda.CfnVersion
    fnVersion.overrideLogicalId(
      "LambdaCurrentVersion" +
        crypto
          .createHash("sha256")
          .update(cdk.Stack.of(this).getLogicalId(fnVersion))
          .digest("hex"),
    )
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      certificate: props.certificate,
      domainNames: [props.domainName],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        edgeLambdas: [
          {
            eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
            includeBody: false,
            functionVersion: fn.currentVersion,
          },
        ],
        origin: new origins.S3Origin(protectedBucket, {
          originAccessIdentity: cloudfrontIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    })
    new route53.ARecord(this, "ARecord", {
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(distribution),
      ),
      zone: props.hostedZone,
    })

    this.protectedBucket = protectedBucket
  }
}
