# cdk-constructs
Experimental AWS Cloud Development Kit (CDK) construct library.

<!-- CONSTRUCT_DOCUMENTATION_START -->
## Constructs

### [`BasicAuthBucket`](src/basic-auth-bucket.ts)

Authenticate requests to S3 using CloudFront on a custom domain, Lambda@Edge and basic HTTP authentication.

### [`CloudFrontedHttpApi`](src/cloud-fronted-http-api.ts)

Route all traffic to an AWS API Gateway HTTP API through
Amazon CloudFront by utilizing a shared secret that CloudFront
adds to all requests, and which is then validated by API Gateway.

Putting a CloudFront distribution in front of your HTTP API can be especially
useful if you want to associate an AWS Web Application Firewall (WAF) with
your HTTP API - something that isn't supported out-of-the-box today.

### [`DollarStoreAppRunner`](src/dollar-store-app-runner.ts)

Make your container available on the internet in a cost-efficient manner.

This construct sets up an Amazon API Gateway HTTP API that routes requests to an ECS service using a VPC Link and Cloud Map.

The ECS service runs on AWS Fargate Spot and is automatically scaled up and down
between 0 and 1 containers based on incoming requests. If no requests have been
made for a given period of time, the ECS service scales down to zero.

... in other words, a dollar store (AWS) App Runner.

### [`GitHubCookieAuth`](src/github-cookie-auth.ts)

An API Gateway REST API that implements GitHub's
web application flow for generating a user access token,
stores the access token in an encrypted cookie, and a
Lambda authorizer that can use the cookie (and thus access
token) for authentication and authorization purposes.

### [`GitHubPushWebhookApi`](src/github-push-webhook-api.ts)

Lambda-backed API Gateway REST API for receiving webhook events from a GitHub App subscribed to push events and storing them in a DynamoDB table.

### [`GitHubWorkflowRunWebhookApi`](src/github-workflow-run-webhook-api.ts)

Lambda-backed API Gateway REST API for receiving webhook events from a GitHub App subscribed to workflow runs and storing them in a DynamoDB table.

### [`SfnProwlerTask`](src/sfn-prowler-task.ts)

Configures a Step Functions task that can be used in a
state machine to run the open-source security tool Prowler
as a Fargate task and send the results to AWS Security Hub
in one or multiple regions.

### [`WebSocketApi`](src/web-socket-api.ts)

API Gateway WebSocket API with a custom domain name,
connection table in DynamoDB and Lambda handlers for
the $connect and $disconnect routes.


<!-- CONSTRUCT_DOCUMENTATION_END -->
