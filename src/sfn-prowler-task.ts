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
}

/**
 * Exposes a Step Functions task that can be used in a
 * state machine to run the open-source security tool Prowler
 * in the current region as a Fargate task and send the results
 * to AWS Security Hub.
 */
export class SfnProwlerTask extends constructs.Construct {
  public readonly sfnTask: tasks.EcsRunTask
  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)
    const account = cdk.Stack.of(this).account
    const region = cdk.Stack.of(this).region
    new cr.AwsCustomResource(this, "SecurityHubProwlerIntegration", {
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [`arn:aws:securityhub:${region}:${account}:hub/default`],
      }),
      onUpdate: {
        service: "SecurityHub",
        action: "enableImportFindingsForProduct",
        parameters: {
          ProductArn: `arn:aws:securityhub:${region}::product/prowler/prowler`,
        },
        physicalResourceId: cr.PhysicalResourceId.of(region),
      },
      onDelete: {
        service: "SecurityHub",
        action: "disableImportFindingsForProduct",
        parameters: {
          ProductSubscriptionArn: `arn:aws:securityhub:${region}::product-subscription/prowler/prowler`,
        },
      },
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
        "toniblyx/prowler:2.12.1@sha256:8eb496e6a20cbae9a0b5d705973bbca11257fd1111f1eb59e01b30a7c43eed43",
      ),
      command: [
        "-M",
        "json-asff",
        "-S", // send to security hub
        "-z", // successful exit code despite failures
        "-q", // only send failed checks
        "-r",
        region,
        "-f",
        region,
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
            actions: [
              "ds:ListAuthorizedApplications",
              "ec2:GetEbsEncryptionByDefault",
              "ecr:Describe*",
              "elasticfilesystem:DescribeBackupPolicy",
              "glue:GetConnections",
              "glue:GetSecurityConfiguration",
              "glue:SearchTables",
              "lambda:GetFunction",
              "s3:GetAccountPublicAccessBlock",
              "shield:DescribeProtection",
              "shield:GetSubscriptionState",
              "ssm:GetDocument",
              "support:Describe*",
              "tag:GetTagKeys",
            ],
            resources: ["*"],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "securityhub:BatchImportFindings",
              "securityhub:GetFindings",
            ],
            resources: [
              `arn:aws:securityhub:${region}::product/prowler/prowler`,
            ],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["securityhub:GetFindings"],
            resources: ["*"],
          }),
        ],
      }),
    )

    this.sfnTask = new tasks.EcsRunTask(this, "FargateTask", {
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      taskDefinition,
      cluster: props.cluster,
      launchTarget: new tasks.EcsFargateLaunchTarget(),
      assignPublicIp: true,
      ...(props.taskOverrides || {}),
    })
  }
}
