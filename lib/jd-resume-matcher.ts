import { Stack, Duration, CfnOutput, StackProps } from "aws-cdk-lib";
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
import * as path from "path";
import { configureDomain } from "../utils/domain";

export interface JdResumeMatcherStackProps extends StackProps {
  lambdaSourcePath: string;
  lambdaHandler: string;
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
      lambdaHandler,
      domainName,
      domainCertificateArn,
      cloudFrontDomainName,
      cloudFrontCertificateArn,
    } = props;

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

    // Lambda function
    const lambda = new Function(this, "Lambda", {
      runtime: Runtime.PYTHON_3_12,
      code: Code.fromAsset(path.join(__dirname, lambdaSourcePath), {
        // Bundle the Lambda function with the requirements.txt file with Docker
        bundling: {
          image: Runtime.PYTHON_3_12.bundlingImage,
          command: [
            "bash",
            "-c",
            "pip install -r requirements.txt -t /asset-output && cp . -r /asset-output",
          ],
        },
      }),
      // Use the `handler` method at `../examples/lambda/jd_resume_matcher.py`
      handler: lambdaHandler,
      timeout: Duration.seconds(30),
      memorySize: 512,
      // Environment variables for the Lambda function
      environment: {
        CACHE_BUCKET_NAME: bucket.bucketName,
        CLOUDFRONT_DOMAIN: distribution.distributionDomainName,
        CLOUDFRONT_URL: `https://${distribution.distributionDomainName}`,
      },
    });

    // Grant S3 read/write permissions to Lambda
    bucket.grantReadWrite(lambda);

    // Grant Lambda to create cache invalidation for CloudFront
    lambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["cloudfront:CreateInvalidation"],
        resources: [distribution.distributionArn],
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

    // Create API resource and methods
    const apiResource = api.root.addResource("match");
    const integration = new LambdaIntegration(lambda);
    apiResource.addMethod("GET", integration);
    apiResource.addMethod("POST", integration);

    // Output the API Gateway URL
    new CfnOutput(this, "ApiGatewayDefaultUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    // Route53 Hosted Zone for API Gateway
    if (domainName && domainCertificateArn) {
      configureDomain(this, api, domainName, domainCertificateArn);
    }
  }
}
