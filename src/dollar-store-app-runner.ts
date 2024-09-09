import * as cdk from "aws-cdk-lib"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2"
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations"
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as route53Targets from "aws-cdk-lib/aws-route53-targets"
import * as cm from "aws-cdk-lib/aws-certificatemanager"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import * as logs from "aws-cdk-lib/aws-logs"
import * as aas from "aws-cdk-lib/aws-applicationautoscaling"
import * as constructs from "constructs"

export interface DollarStoreAppRunnerProps {
  /**
   * The container image to use for the default container in the ECS service
   */
  image: ecs.ContainerImage

  /**
   * The port number that the default container listens on
   */
  port: number

  /**
   * The maximum duration the ECS service can run without receiving any requests before it is automatically stopped.
   *
   * This helps optimize costs by shutting down idle containers.
   *
   * @default cdk.Duration.minutes(30)
   */
  maxIdleTime?: cdk.Duration

  /**
   * Determines whether to assign a public IP address to the ECS service.
   *
   * @default - false if a VPC is provided, true otherwise
   */
  assignPublicIp?: boolean

  /**
   * An existing ECS cluster to use for deploying the ECS service.
   * If provided, it must have container insights enabled for proper metrics and scaling.
   *
   * @default - a new cluster is created with container insights enabled
   */
  cluster?: ecs.ICluster

  /**
   * An existing VPC to use for deploying the ECS service and associated network resources.
   *
   * @default - a new VPC without any NAT gateways is created
   */
  vpc?: ec2.IVpc

  /**
   * Additional configuration options for the default container.
   */
  containerOverrides?: Partial<ecs.ContainerDefinitionOptions>

  /**
   * Additional configuration options for the task definition used by
   * the ECS service.
   */
  taskDefinitionOverrides?: Partial<ecs.FargateTaskDefinition>
}

/**
 * A construct that makes your container available on the internet in a cost-effective manner.
 *
 * This construct sets up an Amazon API Gateway HTTP API that routes requests to an ECS service using a VPC Link and Cloud Map.
 *
 * The ECS service runs on AWS Fargate Spot and is automatically scaled up and down
 * based on incoming requests. If no requests have been made for a given period of time,
 * the ECS service scales down to zero.
 *
 * ... in other words, a Dollar Store App Runner.
 *
 * NOTE: This construct isn't battle-tested, and due to this and the abrupt stops from
 * scaling and Fargate Spot, it is as such more suited for cost-effective hobby
 * projects and experiments than mission-critical workloads.
 */
export class DollarStoreAppRunner extends constructs.Construct {
  /**
   * The ECS service
   */
  public readonly service: ecs.FargateService
  /**
   * The ECS task definition
   */
  public readonly taskDefinition: ecs.FargateTaskDefinition
  /**
   * The security group for the ECS service
   */
  public readonly securityGroup: ec2.SecurityGroup
  /**
   * The HTTP API fronting the ECS service
   */
  public readonly api: apigwv2.HttpApi

  constructor(
    scope: constructs.Construct,
    id: string,
    props: DollarStoreAppRunnerProps,
  ) {
    super(scope, id)

    const vpc =
      props.vpc ||
      new ec2.Vpc(this, "Vpc", {
        natGateways: 0,
      })

    const cluster =
      props.cluster ||
      new ecs.Cluster(this, "Cluster", {
        vpc,
        containerInsights: true,
      })

    const assignPublicIp = props.assignPublicIp ?? !props.vpc

    const cloudMapNamespace = new servicediscovery.PrivateDnsNamespace(
      this,
      "CloudMapNamespace",
      {
        name: cdk.Stack.of(this).stackName,
        vpc,
      },
    )

    this.securityGroup = new ec2.SecurityGroup(this, "ServiceSecurityGroup", {
      vpc,
    })

    this.taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TaskDefinition",
      {
        memoryLimitMiB: 512,
        cpu: 256,
        ...props.taskDefinitionOverrides,
      },
    )

    this.taskDefinition.addContainer("main", {
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "ecs",
        logRetention: logs.RetentionDays.TWO_WEEKS,
      }),
      // TODO: Add health check
      stopTimeout: cdk.Duration.minutes(2),
      image: props.image,
      portMappings: [{ containerPort: props.port }],
      ...props.containerOverrides,
    })

    this.service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: this.taskDefinition,
      desiredCount: 0,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      capacityProviderStrategies: [
        { capacityProvider: "FARGATE_SPOT", weight: 1 },
      ],
      securityGroups: [this.securityGroup],
      cloudMapOptions: {
        cloudMapNamespace: cloudMapNamespace,
        dnsRecordType: servicediscovery.DnsRecordType.SRV,
      },
      assignPublicIp,
    })

    const vpcLinkSecurityGroup = new ec2.SecurityGroup(
      this,
      "VpcLinkSecurityGroup",
      {
        vpc,
      },
    )

    this.securityGroup.connections.allowFrom(
      vpcLinkSecurityGroup,
      ec2.Port.tcp(props.port),
    )

    const vpcLink = new apigwv2.VpcLink(this, "VpcLink", {
      vpc,
      securityGroups: [vpcLinkSecurityGroup],
      ...(assignPublicIp && {
        subnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
      }),
    })

    this.api = new apigwv2.HttpApi(this, "Api", {
      description: `Created in stack '${cdk.Stack.of(this).stackName}'`,
    })

    const integration = new integrations.HttpServiceDiscoveryIntegration(
      "ServiceDiscoveryIntegration",
      this.service.cloudMapService!,
      {
        vpcLink: vpcLink,
      },
    )

    this.api.addRoutes({
      path: "/{proxy+}",
      methods: [apigwv2.HttpMethod.ANY],
      integration,
    })

    const scalableTarget = new aas.ScalableTarget(this, "ScalableTarget", {
      serviceNamespace: aas.ServiceNamespace.ECS,
      maxCapacity: 1,
      minCapacity: 0,
      resourceId: `service/${cluster.clusterName}/${this.service.serviceName}`,
      scalableDimension: "ecs:service:DesiredCount",
    })

    new aas.StepScalingPolicy(this, "ScaleOutPolicy", {
      scalingTarget: scalableTarget,
      adjustmentType: aas.AdjustmentType.CHANGE_IN_CAPACITY,
      metricAggregationType: aas.MetricAggregationType.MAXIMUM,
      metric: new cloudwatch.MathExpression({
        expression: "IF(FILL(requests, 0) > 0 && FILL(tasks, 0) == 0, 1, 0)",
        period: cdk.Duration.minutes(1),
        usingMetrics: {
          requests: this.api.metricCount(),
          tasks: new cloudwatch.Metric({
            namespace: "ECS/ContainerInsights",
            metricName: "RunningTaskCount",
            dimensionsMap: {
              ClusterName: cluster.clusterName,
              ServiceName: this.service.serviceName,
            },
            statistic: "Maximum",
          }),
        },
      }),
      scalingSteps: [
        { lower: 0, upper: 1, change: 0 },
        { lower: 1, change: 1 },
      ],
    })

    new aas.StepScalingPolicy(this, "ScaleInPolicy", {
      scalingTarget: scalableTarget,
      adjustmentType: aas.AdjustmentType.CHANGE_IN_CAPACITY,
      metricAggregationType: aas.MetricAggregationType.MAXIMUM,
      metric: new cloudwatch.MathExpression({
        expression: "IF(FILL(requests, 0) == 0 && FILL(tasks, 0) == 1, 1, 0)",
        period: props.maxIdleTime || cdk.Duration.minutes(30),
        usingMetrics: {
          requests: this.api.metricCount(),
          tasks: new cloudwatch.Metric({
            namespace: "ECS/ContainerInsights",
            metricName: "RunningTaskCount",
            dimensionsMap: {
              ClusterName: cluster.clusterName,
              ServiceName: this.service.serviceName,
            },
            statistic: "Maximum",
          }),
        },
      }),
      scalingSteps: [
        { lower: 0, upper: 1, change: 0 },
        { lower: 1, change: -1 },
      ],
    })
  }

  /**
   * Add a custom domain that can be used to reach your container
   * instead of the automatically generated domain from API Gateway
   */
  addDomain(props: {
    /**
     * The domain name to use
     */
    domainName: string
    /**
     * The TLS certificate for the domain
     */
    certificate: cm.ICertificate
    /**
     * The Route 53 hosted zone for the domain
     */
    hostedZone: route53.IHostedZone
  }) {
    const domainName = new apigwv2.DomainName(this, "CustomDomainName", {
      domainName: props.domainName,
      certificate: props.certificate,
    })

    new apigwv2.ApiMapping(this, "ApiMapping", {
      api: this.api,
      domainName,
    })

    new route53.ARecord(this, "Record", {
      recordName: `${domainName.name}.`,
      zone: props.hostedZone,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.ApiGatewayv2DomainProperties(
          domainName.regionalDomainName,
          domainName.regionalHostedZoneId,
        ),
      ),
    })
    ;(this.api.node.defaultChild as apigwv2.CfnApi).addPropertyOverride(
      "DisableExecuteApiEndpoint",
      true,
    )
  }
}
