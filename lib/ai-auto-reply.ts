import { Stack, Duration, CfnOutput, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { RestApi, Cors, LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import * as path from "path";
import { configureDomain } from "../utils/domain";

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
        // Bundle the Lambda function with the requirements.txt file with Docker
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
      // Use the `handler` method at `../examples/lambda/ai_auto_reply.py`
      handler: "ai_auto_reply.handler",
      timeout: Duration.seconds(30),
      memorySize: 256,
    });

    // API Gateway
    const api = new RestApi(this, "RestApi", {
      restApiName: "AI Auto Reply API",
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
    new CfnOutput(this, "ApiGatewayDefaultUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    // Route53 Hosted Zone
    if (domainName && domainCertificateArn) {
      configureDomain(this, api, domainName, domainCertificateArn);
    }
  }
}
