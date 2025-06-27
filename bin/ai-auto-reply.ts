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

console.info(
  "Deploying with config",
  {
    stackName,
    lambdaSourcePath,
    lambdaHandler,
    domainName,
    domainCertificateArn,
  },
  "\n"
);

const app = new App();
new AIAutoReplyStack(app, stackName, {
  lambdaSourcePath,
  lambdaHandler,
  domainName,
  domainCertificateArn,
  env: {
    account,
    region,
  },
});
