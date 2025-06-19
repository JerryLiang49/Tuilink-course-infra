#!/usr/bin/env node
import { env } from "process";
import { App } from "aws-cdk-lib";
import { AIAutoReplyStack } from "../lib/ai-auto-reply";
import { loadEnv } from "../utils/load-env";

const { camelCasedStage, account, region } = loadEnv();
const stackName = `AIAutoReply-${camelCasedStage}`;
const domainName = env.DOMAIN_NAME;
const domainCertificateArn = env.DOMAIN_CERTIFICATE_ARN;

console.info(
  "Deploying with config",
  {
    stackName,
    domainName,
    domainCertificateArn,
  },
  "\n"
);

const app = new App();
new AIAutoReplyStack(app, stackName, {
  domainName,
  domainCertificateArn,
  env: {
    account,
    region,
  },
});
