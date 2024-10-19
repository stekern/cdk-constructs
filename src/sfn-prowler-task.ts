import * as cdk from "aws-cdk-lib"
import * as constructs from "constructs"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as iam from "aws-cdk-lib/aws-iam"
import * as sfn from "aws-cdk-lib/aws-stepfunctions"
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks"
import * as cr from "aws-cdk-lib/custom-resources"

type Props = {
  /**
   * The ECS cluster to run the task in.
   */
  cluster: ecs.ICluster
  /**
   * An optional set of task parameter overrides.
   */
  taskOverrides?: Partial<tasks.EcsRunTaskProps>
  /**
   * The regions that Prowler should scan
   *
   * @remarks
   * Security Hub needs to be enabled in each of these regions.
   *
   * You likely also want to configure one of the regions as
   * an aggregation region to have a single pane of glass
   * for all findings from Prowler.
   *
   * @default - Prowler scans the current AWS region
   */
  regions?: [string, ...string[]]
  /**
   * Whether Prowler should return a non-zero exit code
   * if any of its findings fails a check (a "rule")
   *
   * @default false
   */
  exitCode?: boolean
}

/**
 * Configures a Step Functions task that can be used in a
 * state machine to run the open-source security tool Prowler
 * as a Fargate task and send the results to AWS Security Hub
 * in one or multiple regions.
 */
export class SfnProwlerTask extends constructs.Construct {
  public readonly sfnTask: tasks.EcsRunTask
  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)
    const account = cdk.Stack.of(this).account
    const currentRegion = cdk.Stack.of(this).region
    const regions = props.regions || [currentRegion]
    regions.forEach((region) => {
      if (cdk.Token.isUnresolved(region)) {
        throw new Error("Prowler regions can not contain unresolved CDK tokens")
      }
      new cr.AwsCustomResource(this, `SecurityHubProwlerIntegration${region}`, {
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: [`arn:aws:securityhub:${region}:${account}:hub/default`],
        }),
        onCreate: {
          region,
          service: "SecurityHub",
          action: "enableImportFindingsForProduct",
          // Continue if the integration already has been enabled
          ignoreErrorCodesMatching: "ResourceConflictException",
          parameters: {
            ProductArn: `arn:aws:securityhub:${region}::product/prowler/prowler`,
          },
          physicalResourceId: cr.PhysicalResourceId.of(region),
        },
      })
    })

    const taskDefinition = new ecs.TaskDefinition(this, "TaskDefinition", {
      compatibility: ecs.Compatibility.FARGATE,
      cpu: "1024",
      memoryMiB: "2048",
    })

    taskDefinition.addContainer("main", {
      logging: new ecs.AwsLogDriver({
        streamPrefix: "prefix",
        logRetention: 14,
      }),
      image: ecs.ContainerImage.fromRegistry(
        // renovate: datasource=docker depName=toniblyx/prowler
        "toniblyx/prowler:4.4.1@sha256:8eb645cd54310aaade13b0a83a14df966de856cd509722b50e1e5d42e1a1c150",
      ),
      command: [
        "aws",
        ...((props.exitCode ?? false) ? [] : ["-z"]),
        "--output-modes",
        "json-asff",
        "--region",
        ...regions,
        // Enable security hub
        "--security-hub",
        // Only send failed checks
        "--status",
        "FAIL",
      ],
    })
    taskDefinition.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("SecurityAudit"),
    )
    taskDefinition.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("job-function/ViewOnlyAccess"),
    )
    taskDefinition.taskRole.attachInlinePolicy(
      new iam.Policy(this, "ProwlerAdditionalPolicy", {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["securityhub:BatchImportFindings"],
            resources: regions.map(
              (region) =>
                `arn:aws:securityhub:${region}::product/prowler/prowler`,
            ),
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["securityhub:GetFindings"],
            resources: ["*"],
          }),
          // Based on https://github.com/prowler-cloud/prowler/blob/master/permissions/prowler-additions-policy.json
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "account:Get*",
              "appstream:Describe*",
              "appstream:List*",
              "backup:List*",
              "cloudtrail:GetInsightSelectors",
              "codeartifact:List*",
              "codebuild:BatchGet*",
              "cognito-idp:GetUserPoolMfaConfig",
              "dlm:Get*",
              "drs:Describe*",
              "ds:Describe*",
              "ds:Get*",
              "ds:List*",
              "dynamodb:GetResourcePolicy",
              "ec2:GetEbsEncryptionByDefault",
              "ec2:GetInstanceMetadataDefaults",
              "ec2:GetSnapshotBlockPublicAccessState",
              "ecr:Describe*",
              "ecr:GetRegistryScanningConfiguration",
              "elasticfilesystem:DescribeBackupPolicy",
              "glue:GetConnections",
              "glue:GetSecurityConfiguration*",
              "glue:SearchTables",
              "lambda:GetFunction*",
              "lightsail:GetRelationalDatabases",
              "logs:FilterLogEvents",
              "macie2:GetMacieSession",
              "s3:GetAccountPublicAccessBlock",
              "shield:DescribeProtection",
              "shield:GetSubscriptionState",
              "ssm-incidents:List*",
              "ssm:GetDocument",
              "support:Describe*",
              "tag:GetTagKeys",
              "wellarchitected:List*",
            ],
            resources: ["*"],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["apigateway:GET"],
            resources: [
              "arn:aws:apigateway:*::/restapis/*",
              "arn:aws:apigateway:*::/apis/*",
            ],
          }),
        ],
      }),
    )

    this.sfnTask = new tasks.EcsRunTask(this, "FargateTask", {
      stateName: "ProwlerScan",
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      taskDefinition,
      cluster: props.cluster,
      launchTarget: new tasks.EcsFargateLaunchTarget(),
      assignPublicIp: true,
      ...(props.taskOverrides || {}),
    })
  }
}
