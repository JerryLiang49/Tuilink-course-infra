import { Stack, Duration, CfnOutput, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Function, Runtime, Code, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { RestApi, Cors, LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import * as path from "path";
import { configureDomain } from "../utils/domain";

// Props are intentionally environment-driven so the same stack class can deploy
// either the sample Lambda or the real course-ai-auto-reply-starter dist bundle.
export interface AIAutoReplyStackProps extends StackProps {
  // Filesystem path, relative to this lib directory after path.join below, that
  // contains the Python handler source and requirements.txt.
  lambdaSourcePath: string;

  // Python handler string, for example ai_auto_reply.handler or handler.handler.
  lambdaHandler: string;

  // Optional API Gateway custom domain inputs.
  domainName?: string;
  domainCertificateArn?: string;

  // Optional dependency layer source. If omitted, dependencies are bundled
  // directly into the function asset.
  lambdaLayerSourcePath?: string;

  // Runtime environment variables for the Lambda, such as OPENAI_API_KEY and
  // model configuration. Secrets should come from ignored env files or AWS.
  lambdaEnvironment?: Record<string, string>;
}

export class AIAutoReplyStack extends Stack {
  constructor(scope: Construct, id: string, props: AIAutoReplyStackProps) {
    super(scope, id, props);

    // Pull props into local constants so the resource declarations below read
    // like a deployment recipe.
    const {
      lambdaSourcePath,
      lambdaHandler,
      domainName,
      domainCertificateArn,
      lambdaLayerSourcePath,
      lambdaEnvironment,
    } = props;

    // Optional Lambda Layer for Python dependencies
    // When a layer path is configured, CDK runs Docker bundling to install
    // Python packages into /asset-output/python, which Lambda mounts at
    // /opt/python at runtime.
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
    // This Lambda is the only compute resource for AI Auto Reply. API Gateway
    // forwards GET/POST /ai-reply requests to this handler.
    const lambda = new Function(this, "Lambda", {
      runtime: Runtime.PYTHON_3_12,
      code: Code.fromAsset(path.join(__dirname, lambdaSourcePath), {
        // If using a layer, only copy function source code; otherwise, bundle dependencies
        // The non-layer path installs requirements directly into the Lambda zip.
        // The layer path copies only source because dependencies are already in
        // dependenciesLayer.
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
      // In the real app deployment this is usually handler.handler from the
      // starter project's dist folder.
      handler: lambdaHandler,
      timeout: Duration.seconds(30),
      memorySize: 256,
      layers: dependenciesLayer ? [dependenciesLayer] : undefined,
      // Environment variables are set at deploy time, not copied from source,
      // so secrets are not embedded in the asset bundle.
      environment: lambdaEnvironment,
    });

    // API Gateway
    // RestApi creates the public HTTPS entrypoint and handles CORS preflight.
    const api = new RestApi(this, "RestApi", {
      restApiName: "AI Auto Reply API",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    // Create API resource and methods
    // Both methods use the same Lambda. GET is useful as a health check; POST
    // carries the workflow payload.
    const apiResource = api.root.addResource("ai-reply");
    const integration = new LambdaIntegration(lambda);
    apiResource.addMethod("GET", integration);
    apiResource.addMethod("POST", integration);

    // Output the API Gateway URL
    // CloudFormation outputs are how we discover the generated execute-api URL
    // after deployment.
    new CfnOutput(this, "ApiGatewayDefaultUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    if (dependenciesLayer) {
      // Output the layer ARN for debugging and to verify the layer was deployed.
      new CfnOutput(this, "DependenciesLayerArn", {
        value: dependenciesLayer.layerVersionArn,
        description: "ARN of the Python dependencies Lambda Layer",
      });
    }

    // Route53 Hosted Zone
    // Custom domain setup is opt-in because local/class deployments often use
    // the default execute-api URL.
    if (domainName && domainCertificateArn) {
      configureDomain(this, api, domainName, domainCertificateArn);
    }
  }
}
