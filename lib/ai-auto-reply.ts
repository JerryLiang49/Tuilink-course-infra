import { Stack, Duration, CfnOutput, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { RestApi, Cors, LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import * as path from "path";
import { configureDomain } from "../utils/domain";

export interface AIAutoReplyStackProps extends StackProps {
  lambdaSourcePath: string;
  lambdaHandler: string;
  domainName?: string;
  domainCertificateArn?: string;
  lambdaLayerSourcePath?: string;
}

export class AIAutoReplyStack extends Stack {
  constructor(scope: Construct, id: string, props: AIAutoReplyStackProps) {
    super(scope, id, props);

    const {
      lambdaSourcePath,
      lambdaHandler,
      domainName,
      domainCertificateArn,
      lambdaLayerSourcePath,
    } = props;

    // Optional Lambda Layer for Python dependencies
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
        description: "Common Python dependencies for AI Auto Reply Lambda",
      });
    }

    // Lambda function
    const lambda = new Function(this, "Lambda", {
      runtime: Runtime.PYTHON_3_12,
      code: Code.fromAsset(path.join(__dirname, lambdaSourcePath), {
        // If using a layer, only copy function source code; otherwise, bundle dependencies
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
      // Use the `handler` method at `../examples/lambda/ai_auto_reply.py`
      handler: lambdaHandler,
      timeout: Duration.seconds(30),
      memorySize: 256,
      layers: dependenciesLayer ? [dependenciesLayer] : undefined,
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
    const integration = new LambdaIntegration(lambda);
    apiResource.addMethod("GET", integration);
    apiResource.addMethod("POST", integration);

    // Output the API Gateway URL
    new CfnOutput(this, "ApiGatewayDefaultUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    if (dependenciesLayer) {
      new CfnOutput(this, "DependenciesLayerArn", {
        value: dependenciesLayer.layerVersionArn,
        description: "ARN of the Python dependencies Lambda Layer",
      });
    }

    // Route53 Hosted Zone
    if (domainName && domainCertificateArn) {
      configureDomain(this, api, domainName, domainCertificateArn);
    }
  }
}
