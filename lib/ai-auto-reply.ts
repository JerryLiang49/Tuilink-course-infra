import { Stack, Duration, CfnOutput, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import {
  RestApi,
  Cors,
  LambdaIntegration,
  DomainName,
  EndpointType,
} from "aws-cdk-lib/aws-apigateway";
import { ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { ApiGatewayDomain } from "aws-cdk-lib/aws-route53-targets";
import { HostedZone } from "aws-cdk-lib/aws-route53";
import * as path from "path";

export interface AIAutoReplyStackProps extends StackProps {
  domainName?: string;
  domainCertificateArn?: string;
}

export class AIAutoReplyStack extends Stack {
  constructor(scope: Construct, id: string, props?: AIAutoReplyStackProps) {
    super(scope, id, props);

    const { domainName, domainCertificateArn } = props ?? {};

    // Lambda function
    const handler = new Function(this, "Lambda", {
      runtime: Runtime.PYTHON_3_12,
      code: Code.fromAsset(path.join(__dirname, "../examples/lambda"), {
        bundling: {
          image: Runtime.PYTHON_3_12.bundlingImage,
          command: [
            "bash",
            "-c",
            // The content at /asset-output (reserved by AWS) will be zipped and used as the final asset.
            "pip install -r requirements.txt -t /asset-output && cp . -r /asset-output",
          ],
        },
      }),
      handler: "ai_auto_reply.handler",
      timeout: Duration.seconds(30),
      memorySize: 256,
    });

    // API Gateway
    const api = new RestApi(this, "RestApi", {
      restApiName: "AI Auto Reply API",
      description: "API for AI Auto Reply service",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    // Create API resource and methods
    const apiResource = api.root.addResource("ai-reply");
    const integration = new LambdaIntegration(handler);
    apiResource.addMethod("GET", integration);
    apiResource.addMethod("POST", integration);

    // Output the API Gateway URL
    new CfnOutput(this, "ApiUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    // Route53 Hosted Zone
    if (domainName && domainCertificateArn) {
      // Get the hosted zone for the domain
      const hostedZone = HostedZone.fromLookup(this, "HostedZone", {
        domainName,
      });

      // Get the certificate for the domain
      const certificate = Certificate.fromCertificateArn(
        this,
        "Certificate",
        domainCertificateArn
      );

      // Custom Domain for API Gateway
      const customDomain = new DomainName(this, "DomainName", {
        domainName,
        certificate,
        endpointType: EndpointType.REGIONAL,
      });

      // Add base path mapping
      customDomain.addBasePathMapping(api);

      // Route53 A Record pointing to API Gateway
      new ARecord(this, "ARecord", {
        recordName: domainName,
        zone: hostedZone,
        target: RecordTarget.fromAlias(new ApiGatewayDomain(customDomain)),
      });

      // Output the custom domain URL
      new CfnOutput(this, "CustomDomainUrl", {
        value: `https://${domainName}`,
        description: "Custom domain URL",
      });
    }
  }
}
