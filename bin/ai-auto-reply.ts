#!/usr/bin/env node
import { env } from "process";
import { App } from "aws-cdk-lib";
import { AIAutoReplyStack } from "../lib/ai-auto-reply";
import { loadEnv } from "../utils/load-env";

const { camelCasedStage, account, region } = loadEnv();
const stackName = `AIAutoReply-${camelCasedStage}`;
const lambdaSourcePath = env.AI_AUTO_REPLY_LAMBDA_SOURCE_PATH ?? "";
const lambdaHandler = env.AI_AUTO_REPLY_LAMBDA_HANDLER ?? "";
const domainName = env.AI_AUTO_REPLY_DOMAIN_NAME;
const domainCertificateArn = env.AI_AUTO_REPLY_DOMAIN_CERTIFICATE_ARN;
const lambdaLayerSourcePath = env.AI_AUTO_REPLY_LAMBDA_LAYER_SOURCE_PATH;
const openAiApiKey = env.AI_AUTO_REPLY_OPENAI_API_KEY ?? env.OPENAI_API_KEY;
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
  lambdaEnvironment.OPENAI_API_KEY = openAiApiKey;
}

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
