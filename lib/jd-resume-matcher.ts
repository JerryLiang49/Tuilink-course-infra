import {
  Stack,
  Duration,
  CfnOutput,
  StackProps,
  RemovalPolicy,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { RestApi, Cors, LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { AaaaRecord, ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { HostedZone } from "aws-cdk-lib/aws-route53";
import {
  Bucket,
  BlockPublicAccess,
  BucketAccessControl,
} from "aws-cdk-lib/aws-s3";
import {
  Distribution,
  ViewerProtocolPolicy,
  DistributionProps,
  PriceClass,
  SecurityPolicyProtocol,
  SSLMethod,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import { Queue } from "aws-cdk-lib/aws-sqs";
import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
} from "aws-cdk-lib/aws-dynamodb";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as path from "path";
import { configureDomain } from "../utils/domain";

// Stack props are fed by bin/jd-resume-matcher.ts from .env.staging/.env.prod.
// Keeping these inputs explicit makes it clear which values differ by stage.
export interface JdResumeMatcherStackProps extends StackProps {
  // Folder containing both quick_handler.py and worker_handler.py plus
  // requirements.txt. CDK bundles this folder into Lambda assets.
  lambdaSourcePath: string;

  // Python handler strings for the API-facing Lambda and the background worker.
  quickHandlerName: string;
  workerHandlerName: string;

  // Optional API Gateway custom domain settings.
  domainName?: string;
  domainCertificateArn?: string;

  // Optional CloudFront custom domain settings for cached result files.
  cloudFrontDomainName?: string;
  cloudFrontCertificateArn?: string;

  // Optional Lambda layer source path for shared Python dependencies.
  lambdaLayerSourcePath?: string;

  // Runtime environment variables for the Python workflow, such as OPENAI_API_KEY,
  // model settings, cache settings, and matcher threshold.
  lambdaEnvironment?: Record<string, string>;
}

export class JdResumeMatcherStack extends Stack {
  constructor(scope: Construct, id: string, props: JdResumeMatcherStackProps) {
    super(scope, id, props);

    const {
      lambdaSourcePath,
      quickHandlerName,
      workerHandlerName,
      domainName,
      domainCertificateArn,
      cloudFrontDomainName,
      cloudFrontCertificateArn,
      lambdaLayerSourcePath,
      lambdaEnvironment,
    } = props;

    // Optional Lambda Layer for Python dependencies
    // When configured, dependencies are installed once into a layer. The two
    // Lambda functions can then copy only source code into their own assets.
    let dependenciesLayer: LayerVersion | undefined;
    if (lambdaLayerSourcePath) {
      dependenciesLayer = new LayerVersion(this, "PythonDependenciesLayer", {
        compatibleRuntimes: [Runtime.PYTHON_3_12],
        code: Code.fromAsset(path.join(__dirname, lambdaLayerSourcePath), {
          bundling: {
            image: Runtime.PYTHON_3_12.bundlingImage,
            platform: "linux/amd64",
            command: [
              "bash",
              "-c",
              // Install dependencies into the layer under /asset-output/python (maps to /opt/python in Lambda)
              "pip install -r requirements.txt -t /asset-output/python && cp -r . /asset-output/python",
            ],
          },
        }),
        description: "Common Python dependencies for JD Resume Matcher Lambdas",
      });
    }

    // DynamoDB table for storing jobs
    // The quick handler writes PENDING jobs here and the worker updates them to
    // PROCESSING, SUCCEEDED, or FAILED as async work moves forward.
    const jobsTable = new Table(this, "JobsTable", {
      partitionKey: { name: "job_id", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Add GSI for cache_key to support querying by cache key
    // This lets POST /process dedupe identical requests before enqueueing more
    // background work.
    jobsTable.addGlobalSecondaryIndex({
      indexName: "cache-key-index",
      partitionKey: { name: "cache_key", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL, // Project all attributes to the GSI
    });

    // SQS queue for job processing
    // API Gateway should return quickly, so larger matching work is pushed to
    // SQS and processed by the worker Lambda outside the request path.
    const jobQueue = new Queue(this, "JobQueue", {
      queueName: "jd-resume-matcher-jobs",
      visibilityTimeout: Duration.minutes(15), // Max Lambda execution time
      // Add dead letter queue for failed jobs
      // Failed messages move here after retries so bad payloads do not block the
      // main queue forever.
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: new Queue(this, "JobDeadLetterQueue", {
          queueName: "jd-resume-matcher-jobs-dlq",
        }),
      },
    });

    // S3 Bucket for storing cached data
    // Worker output is written to private S3 and served through CloudFront, so
    // public reads never go directly against the bucket.
    const bucket = new Bucket(this, "Bucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      accessControl: BucketAccessControl.PRIVATE,
      enforceSSL: true,
    });

    // Props for the CloudFront CDN distribution
    // The distribution fronts the private S3 bucket and gives cached result JSON
    // a stable HTTPS URL.
    let distributionProps: DistributionProps = {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      priceClass: PriceClass.PRICE_CLASS_ALL,
    };

    // If custom domain is provided, add it to the distribution
    // CloudFront certificates must be valid for the provided domain. The stack
    // only attaches the custom domain when both values are present.
    if (cloudFrontDomainName && cloudFrontCertificateArn) {
      distributionProps = {
        ...distributionProps,
        certificate: Certificate.fromCertificateArn(
          this,
          "CloudFrontCertificate",
          cloudFrontCertificateArn
        ),
        domainNames: [cloudFrontDomainName],
        sslSupportMethod: SSLMethod.SNI,
        minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2019,
      };
    }

    // CloudFront distribution that caches and serves bucket content with custom domain
    // Origin Access Control keeps S3 private while allowing CloudFront to fetch
    // objects on behalf of clients.
    const distribution = new Distribution(
      this,
      "Distribution",
      distributionProps
    );

    // Output the S3 Bucket name
    // This is useful when manually checking cached objects from the AWS console.
    new CfnOutput(this, "BucketName", {
      value: bucket.bucketName,
      description: "S3 Cache Bucket Name",
    });

    // Output the CloudFront URL
    // The worker stores this URL in job results after writing cache objects.
    new CfnOutput(this, "CloudFrontDefaultUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "CloudFront Distribution Default URL",
    });

    // If custom domain is provided, route to the CloudFront distribution
    // Route53 records are created only for custom-domain deployments; class
    // deployments can use the default CloudFront domain.
    if (cloudFrontDomainName && cloudFrontCertificateArn) {
      // Hosted Zone for the website custom domain
      // HostedZone.fromLookup requires the AWS account to have a matching hosted
      // zone available during synthesis.
      const hostedZone = HostedZone.fromLookup(this, "CloudFrontHostedZone", {
        domainName: cloudFrontDomainName,
      });

      // Route53 A record for the CloudFront distribution
      // ARecord covers IPv4 clients.
      new ARecord(this, "CloudFrontARecord", {
        recordName: cloudFrontDomainName,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        zone: hostedZone,
      });

      // Route53 AAA record for the CloudFront distribution
      // AaaaRecord covers IPv6 clients.
      new AaaaRecord(this, "CloudFrontAAAARecord", {
        recordName: cloudFrontDomainName,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        zone: hostedZone,
      });

      // Output the CloudFront URL
      // This is the human-friendly CDN URL when a custom domain is configured.
      new CfnOutput(this, "CloudFrontCustomUrl", {
        value: `https://${cloudFrontDomainName}`,
        description: "CloudFront Distribution Custom URL",
      });
    }

    // Quick handler Lambda function (for API Gateway)
    // The quick handler owns the synchronous API surface: create/find jobs and
    // return job status without doing long-running matching work inline.
    const quickHandler = new Function(this, "QuickHandler", {
      runtime: Runtime.PYTHON_3_12,
      code: Code.fromAsset(path.join(__dirname, lambdaSourcePath), {
        // If using a layer, only copy function source code; otherwise, bundle dependencies
        // Docker bundling makes the Lambda artifact Linux-compatible even when
        // deploying from macOS.
        bundling: {
          image: Runtime.PYTHON_3_12.bundlingImage,
          platform: "linux/amd64",
          command: [
            "bash",
            "-c",
            dependenciesLayer
              ? "cp . -r /asset-output"
              : "pip install -r requirements.txt -t /asset-output && cp . -r /asset-output",
          ],
        },
      }),
      handler: quickHandlerName,
      timeout: Duration.seconds(30),
      memorySize: 512,
      layers: dependenciesLayer ? [dependenciesLayer] : undefined,
      // Environment variables for the Lambda function
      // Resource names and URLs are injected so the Python handler does not need
      // hardcoded AWS identifiers.
      environment: {
        ...lambdaEnvironment,
        JOBS_TABLE_NAME: jobsTable.tableName,
        JOB_QUEUE_URL: jobQueue.queueUrl,
        CACHE_BUCKET_NAME: bucket.bucketName,
        CLOUDFRONT_DOMAIN: distribution.distributionDomainName,
        CLOUDFRONT_URL: `https://${distribution.distributionDomainName}`,
        CLOUDFRONT_DISTRIBUTION_ID: distribution.distributionId,
      },
    });

    // Worker handler Lambda function (for SQS processing)
    // The worker is triggered by SQS, performs the slow processing, writes cache
    // data, and updates the DynamoDB job record for polling clients.
    const workerHandler = new Function(this, "WorkerHandler", {
      runtime: Runtime.PYTHON_3_12,
      code: Code.fromAsset(path.join(__dirname, lambdaSourcePath), {
        // If using a layer, only copy function source code; otherwise, bundle dependencies
        // It uses the same source directory as the quick handler but a different
        // handler string and runtime environment.
        bundling: {
          image: Runtime.PYTHON_3_12.bundlingImage,
          platform: "linux/amd64",
          command: [
            "bash",
            "-c",
            dependenciesLayer
              ? "cp . -r /asset-output"
              : "pip install -r requirements.txt -t /asset-output && cp . -r /asset-output",
          ],
        },
      }),
      handler: workerHandlerName,
      timeout: Duration.minutes(15), // Max timeout for long-running jobs
      memorySize: 1024,
      layers: dependenciesLayer ? [dependenciesLayer] : undefined,
      // Environment variables for the Lambda function
      // The worker does not need JOB_QUEUE_URL because SQS invokes it directly.
      environment: {
        ...lambdaEnvironment,
        JOBS_TABLE_NAME: jobsTable.tableName,
        CACHE_BUCKET_NAME: bucket.bucketName,
        CLOUDFRONT_DOMAIN: distribution.distributionDomainName,
        CLOUDFRONT_URL: `https://${distribution.distributionDomainName}`,
        CLOUDFRONT_DISTRIBUTION_ID: distribution.distributionId,
      },
    });

    // Grant permissions to quick handler
    // The API Lambda can read/write job metadata, enqueue new jobs, and interact
    // with cached artifacts.
    jobsTable.grantReadWriteData(quickHandler);
    jobQueue.grantSendMessages(quickHandler);
    bucket.grantReadWrite(quickHandler);

    // Grant permissions to worker handler
    // The worker needs the same data/cache permissions, minus enqueue access.
    jobsTable.grantReadWriteData(workerHandler);
    bucket.grantReadWrite(workerHandler);

    // Grant CloudFront invalidation permissions to both handlers
    // Invalidation lets handlers force CDN refreshes after writing a new cached
    // JSON result.
    quickHandler.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["cloudfront:CreateInvalidation"],
        resources: [distribution.distributionArn],
      })
    );

    workerHandler.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["cloudfront:CreateInvalidation"],
        resources: [distribution.distributionArn],
      })
    );

    // Add SQS event source to worker handler
    // Batch size is one because each matching job can be expensive and should
    // fail/retry independently.
    workerHandler.addEventSource(
      new SqsEventSource(jobQueue, {
        batchSize: 1, // Process one job at a time
        maxBatchingWindow: Duration.seconds(0),
      })
    );

    // API Gateway
    // The REST API exposes the quick handler as the public control plane for job
    // creation and status polling.
    const api = new RestApi(this, "RestApi", {
      restApiName: "JD Resume Matcher API",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    // Create API resources and methods
    // Both resources use the same LambdaIntegration so routing stays inside the
    // Python quick handler.
    const quickHandlerIntegration = new LambdaIntegration(quickHandler);

    // POST /process endpoint
    // Starts or dedupes an async resume matching job.
    const processResource = api.root.addResource("process");
    processResource.addMethod("POST", quickHandlerIntegration);

    // GET /jobs/{job_id} endpoint for polling
    // Clients poll this after POST /process returns a job id.
    const jobsResource = api.root.addResource("jobs");
    const jobResource = jobsResource.addResource("{job_id}");
    jobResource.addMethod("GET", quickHandlerIntegration);

    // Output the API Gateway URL
    // This generated execute-api URL is the easiest endpoint to test after
    // deployment.
    new CfnOutput(this, "ApiGatewayDefaultUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    if (dependenciesLayer) {
      // Output the layer ARN for troubleshooting dependency packaging.
      new CfnOutput(this, "DependenciesLayerArn", {
        value: dependenciesLayer.layerVersionArn,
        description: "ARN of the Python dependencies Lambda Layer",
      });
    }

    // Output DynamoDB table name
    // Useful for manual AWS console checks and one-off CLI debugging.
    new CfnOutput(this, "JobsTableName", {
      value: jobsTable.tableName,
      description: "DynamoDB Jobs Table Name",
    });

    // Output SQS queue URL
    // Useful when inspecting queued messages or DLQ behavior.
    new CfnOutput(this, "JobQueueUrl", {
      value: jobQueue.queueUrl,
      description: "SQS Job Queue URL",
    });

    // Route53 Hosted Zone for API Gateway
    // API custom domains are optional and handled by the shared domain helper.
    if (domainName && domainCertificateArn) {
      configureDomain(this, api, domainName, domainCertificateArn);
    }
  }
}
