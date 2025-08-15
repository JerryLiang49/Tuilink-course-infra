#!/usr/bin/env node
import { env } from "process";
import { App } from "aws-cdk-lib";
import { JdResumeMatcherStack } from "../lib/jd-resume-matcher";
import { loadEnv } from "../utils/load-env";

const { camelCasedStage, account, region } = loadEnv();
const stackName = `JdResumeMatcher-${camelCasedStage}`;
const lambdaSourcePath = env.JD_RESUME_MATCHER_LAMBDA_SOURCE_PATH ?? "";
const quickHandlerName = env.JD_RESUME_MATCHER_QUICK_HANDLER ?? "";
const workerHandlerName = env.JD_RESUME_MATCHER_WORKER_HANDLER ?? "";
const domainName = env.JD_RESUME_MATCHER_DOMAIN_NAME;
const domainCertificateArn = env.JD_RESUME_MATCHER_DOMAIN_CERTIFICATE_ARN;
const cloudFrontDomainName = env.JD_RESUME_MATCHER_CLOUDFRONT_DOMAIN_NAME;
const cloudFrontCertificateArn =
  env.JD_RESUME_MATCHER_CLOUDFRONT_CERTIFICATE_ARN;
const lambdaLayerSourcePath = env.JD_RESUME_MATCHER_LAMBDA_LAYER_SOURCE_PATH;

console.info(
  "Deploying with config",
  {
    stackName,
    lambdaSourcePath,
    quickHandlerName,
    workerHandlerName,
    domainName,
    domainCertificateArn,
    cloudFrontDomainName,
    cloudFrontCertificateArn,
    lambdaLayerSourcePath,
  },
  "\n"
);

const app = new App();
new JdResumeMatcherStack(app, stackName, {
  lambdaSourcePath,
  quickHandlerName,
  workerHandlerName,
  domainName,
  domainCertificateArn,
  cloudFrontDomainName,
  cloudFrontCertificateArn,
  lambdaLayerSourcePath,
  env: {
    account,
    region,
  },
});
