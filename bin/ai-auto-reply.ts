#!/usr/bin/env node
import { env } from "process";
import { App } from "aws-cdk-lib";
import { AIAutoReplyStack } from "../lib/ai-auto-reply";
import { loadEnv } from "../utils/load-env";

// The CDK entrypoint is intentionally thin: it loads environment-specific
// configuration, logs the effective deployment settings, and instantiates one
// stack. All AWS resources are declared in lib/ai-auto-reply.ts.
const { camelCasedStage, account, region } = loadEnv();

// Stack names include the stage so staging/prod deployments can coexist in the
// same AWS account without CloudFormation name collisions.
const stackName = `AIAutoReply-${camelCasedStage}`;

// These values come from .env.staging or .env.prod. The source path points to
// the Python Lambda package, and handler is the Python module/function string.
const lambdaSourcePath = env.AI_AUTO_REPLY_LAMBDA_SOURCE_PATH ?? "";
const lambdaHandler = env.AI_AUTO_REPLY_LAMBDA_HANDLER ?? "";

// Domain settings are optional. When both are present, the stack configures an
// API Gateway custom domain and Route53 record.
const domainName = env.AI_AUTO_REPLY_DOMAIN_NAME;
const domainCertificateArn = env.AI_AUTO_REPLY_DOMAIN_CERTIFICATE_ARN;

// The layer path is optional. If supplied, Python dependencies are packaged
// separately from application code to reduce function asset size.
const lambdaLayerSourcePath = env.AI_AUTO_REPLY_LAMBDA_LAYER_SOURCE_PATH;

// Prefer a service-specific key name, but allow OPENAI_API_KEY so local deploys
// can source the app repo's .env without duplicating config.
const openAiApiKey = env.AI_AUTO_REPLY_OPENAI_API_KEY ?? env.OPENAI_API_KEY;

// Runtime configuration is injected into Lambda environment variables. This is
// safer than copying a .env file into the Lambda bundle and keeps deployment
// behavior explicit.
const lambdaEnvironment: Record<string, string> = {
  // Keep deployment behavior explicit and avoid local filesystem cache writes in Lambda.
  LLM_USE_CACHE: env.AI_AUTO_REPLY_LLM_USE_CACHE ?? env.LLM_USE_CACHE ?? "false",
  LLM_INCLUDE_DEBUG_FIELDS:
    env.AI_AUTO_REPLY_LLM_INCLUDE_DEBUG_FIELDS ??
    env.LLM_INCLUDE_DEBUG_FIELDS ??
    "false",
  LLM_MODEL: env.AI_AUTO_REPLY_LLM_MODEL ?? env.LLM_MODEL ?? "gpt-4.1-mini",
  LLM_TEMPERATURE:
    env.AI_AUTO_REPLY_LLM_TEMPERATURE ?? env.LLM_TEMPERATURE ?? "0",
};

if (openAiApiKey) {
  // Do not log the actual key. The config logger below masks it as <set>.
  lambdaEnvironment.OPENAI_API_KEY = openAiApiKey;
}

// Logging the resolved config helps catch common mistakes such as deploying the
// sample Lambda path instead of the real app dist folder.
console.info(
  "Deploying with config",
  {
    stackName,
    lambdaSourcePath,
    lambdaHandler,
    domainName,
    domainCertificateArn,
    lambdaLayerSourcePath,
    lambdaEnvironment: {
      ...lambdaEnvironment,
      OPENAI_API_KEY: openAiApiKey ? "<set>" : "<missing>",
    },
  },
  "\n"
);

// CDK apps can contain multiple stacks, but this entrypoint creates only the AI
// Auto Reply stack for the selected environment.
const app = new App();
new AIAutoReplyStack(app, stackName, {
  lambdaSourcePath,
  lambdaHandler,
  domainName,
  domainCertificateArn,
  lambdaLayerSourcePath,
  lambdaEnvironment,
  env: {
    account,
    region,
  },
});
