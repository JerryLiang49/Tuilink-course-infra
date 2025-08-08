import {
  Stack,
  Duration,
  CfnOutput,
  StackProps,
  RemovalPolicy,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
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

export interface JdResumeMatcherStackProps extends StackProps {
  lambdaSourcePath: string;
  quickHandlerName: string;
  workerHandlerName: string;
  domainName?: string;
  domainCertificateArn?: string;
  cloudFrontDomainName?: string;
  cloudFrontCertificateArn?: string;
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
    } = props;

    // DynamoDB table for storing jobs
    const jobsTable = new Table(this, "JobsTable", {
      partitionKey: { name: "job_id", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Add GSI for cache_key to support querying by cache key
    jobsTable.addGlobalSecondaryIndex({
      indexName: "cache-key-index",
      partitionKey: { name: "cache_key", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL, // Project all attributes to the GSI
    });

    // SQS queue for job processing
    const jobQueue = new Queue(this, "JobQueue", {
      queueName: "jd-resume-matcher-jobs",
      visibilityTimeout: Duration.minutes(15), // Max Lambda execution time
      // Add dead letter queue for failed jobs
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: new Queue(this, "JobDeadLetterQueue", {
          queueName: "jd-resume-matcher-jobs-dlq",
        }),
      },
    });

    // S3 Bucket for storing cached data
    const bucket = new Bucket(this, "Bucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      accessControl: BucketAccessControl.PRIVATE,
      enforceSSL: true,
    });

    // Props for the CloudFront CDN distribution
    let distributionProps: DistributionProps = {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      priceClass: PriceClass.PRICE_CLASS_ALL,
    };

    // If custom domain is provided, add it to the distribution
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
    const distribution = new Distribution(
      this,
      "Distribution",
      distributionProps
    );

    // Output the S3 Bucket name
    new CfnOutput(this, "BucketName", {
      value: bucket.bucketName,
      description: "S3 Cache Bucket Name",
    });

    // Output the CloudFront URL
    new CfnOutput(this, "CloudFrontDefaultUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "CloudFront Distribution Default URL",
    });

    // If custom domain is provided, route to the CloudFront distribution
    if (cloudFrontDomainName && cloudFrontCertificateArn) {
      // Hosted Zone for the website custom domain
      const hostedZone = HostedZone.fromLookup(this, "CloudFrontHostedZone", {
        domainName: cloudFrontDomainName,
      });

      // Route53 A record for the CloudFront distribution
      new ARecord(this, "CloudFrontARecord", {
        recordName: cloudFrontDomainName,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        zone: hostedZone,
      });

      // Route53 AAA record for the CloudFront distribution
      new AaaaRecord(this, "CloudFrontAAAARecord", {
        recordName: cloudFrontDomainName,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        zone: hostedZone,
      });

      // Output the CloudFront URL
      new CfnOutput(this, "CloudFrontCustomUrl", {
        value: `https://${cloudFrontDomainName}`,
        description: "CloudFront Distribution Custom URL",
      });
    }

    // Quick handler Lambda function (for API Gateway)
    const quickHandler = new Function(this, "QuickHandler", {
      runtime: Runtime.PYTHON_3_12,
      code: Code.fromAsset(path.join(__dirname, lambdaSourcePath), {
        // Bundle the Lambda function with the requirements.txt file with Docker
        bundling: {
          image: Runtime.PYTHON_3_12.bundlingImage,
          platform: "linux/amd64",
          command: [
            "bash",
            "-c",
            "pip install -r requirements.txt -t /asset-output && cp . -r /asset-output",
          ],
        },
      }),
      handler: quickHandlerName,
      timeout: Duration.seconds(30),
      memorySize: 512,
      // Environment variables for the Lambda function
      environment: {
        JOBS_TABLE_NAME: jobsTable.tableName,
        JOB_QUEUE_URL: jobQueue.queueUrl,
        CACHE_BUCKET_NAME: bucket.bucketName,
        CLOUDFRONT_DOMAIN: distribution.distributionDomainName,
        CLOUDFRONT_URL: `https://${distribution.distributionDomainName}`,
      },
    });

    // Worker handler Lambda function (for SQS processing)
    const workerHandler = new Function(this, "WorkerHandler", {
      runtime: Runtime.PYTHON_3_12,
      code: Code.fromAsset(path.join(__dirname, lambdaSourcePath), {
        // Bundle the Lambda function with the requirements.txt file with Docker
        bundling: {
          image: Runtime.PYTHON_3_12.bundlingImage,
          platform: "linux/amd64",
          command: [
            "bash",
            "-c",
            "pip install -r requirements.txt -t /asset-output && cp . -r /asset-output",
          ],
        },
      }),
      handler: workerHandlerName,
      timeout: Duration.minutes(15), // Max timeout for long-running jobs
      memorySize: 1024,
      // Environment variables for the Lambda function
      environment: {
        JOBS_TABLE_NAME: jobsTable.tableName,
        CACHE_BUCKET_NAME: bucket.bucketName,
        CLOUDFRONT_DOMAIN: distribution.distributionDomainName,
        CLOUDFRONT_URL: `https://${distribution.distributionDomainName}`,
      },
    });

    // Grant permissions to quick handler
    jobsTable.grantReadWriteData(quickHandler);
    jobQueue.grantSendMessages(quickHandler);
    bucket.grantReadWrite(quickHandler);

    // Grant permissions to worker handler
    jobsTable.grantReadWriteData(workerHandler);
    bucket.grantReadWrite(workerHandler);

    // Grant CloudFront invalidation permissions to both handlers
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
    workerHandler.addEventSource(
      new SqsEventSource(jobQueue, {
        batchSize: 1, // Process one job at a time
        maxBatchingWindow: Duration.seconds(0),
      })
    );

    // API Gateway
    const api = new RestApi(this, "RestApi", {
      restApiName: "JD Resume Matcher API",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    // Create API resources and methods
    const quickHandlerIntegration = new LambdaIntegration(quickHandler);

    // POST /process endpoint
    const processResource = api.root.addResource("process");
    processResource.addMethod("POST", quickHandlerIntegration);

    // GET /jobs/{job_id} endpoint for polling
    const jobsResource = api.root.addResource("jobs");
    const jobResource = jobsResource.addResource("{job_id}");
    jobResource.addMethod("GET", quickHandlerIntegration);

    // Output the API Gateway URL
    new CfnOutput(this, "ApiGatewayDefaultUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    // Output DynamoDB table name
    new CfnOutput(this, "JobsTableName", {
      value: jobsTable.tableName,
      description: "DynamoDB Jobs Table Name",
    });

    // Output SQS queue URL
    new CfnOutput(this, "JobQueueUrl", {
      value: jobQueue.queueUrl,
      description: "SQS Job Queue URL",
    });

    // Route53 Hosted Zone for API Gateway
    if (domainName && domainCertificateArn) {
      configureDomain(this, api, domainName, domainCertificateArn);
    }
  }
}
