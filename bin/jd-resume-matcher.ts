#!/usr/bin/env node
import { env } from "process";
import { App } from "aws-cdk-lib";
import { JdResumeMatcherStack } from "../lib/jd-resume-matcher";
import { loadEnv } from "../utils/load-env";

// This entrypoint converts .env stage configuration into strongly named stack
// props. The actual AWS resources are declared in lib/jd-resume-matcher.ts.
const { camelCasedStage, account, region } = loadEnv();

// Stage-specific stack naming keeps staging/prod CloudFormation stacks separate.
const stackName = `JdResumeMatcher-${camelCasedStage}`;

// The same Lambda source bundle contains both quick_handler.py and
// worker_handler.py. The handler strings decide which function each Lambda runs.
const lambdaSourcePath = env.JD_RESUME_MATCHER_LAMBDA_SOURCE_PATH ?? "";
const quickHandlerName = env.JD_RESUME_MATCHER_QUICK_HANDLER ?? "";
const workerHandlerName = env.JD_RESUME_MATCHER_WORKER_HANDLER ?? "";

// Optional API Gateway custom domain settings.
const domainName = env.JD_RESUME_MATCHER_DOMAIN_NAME;
const domainCertificateArn = env.JD_RESUME_MATCHER_DOMAIN_CERTIFICATE_ARN;

// Optional CloudFront custom domain settings for cached result files.
const cloudFrontDomainName = env.JD_RESUME_MATCHER_CLOUDFRONT_DOMAIN_NAME;
const cloudFrontCertificateArn =
  env.JD_RESUME_MATCHER_CLOUDFRONT_CERTIFICATE_ARN;

// Optional shared dependency layer source path. When set, application code and
// Python dependencies are packaged separately.
const lambdaLayerSourcePath = env.JD_RESUME_MATCHER_LAMBDA_LAYER_SOURCE_PATH;

// Print non-secret deployment settings before synthesis. This is useful because
// most deployment failures here are path/profile/config mistakes.
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

// Build a CDK app containing exactly the JD Resume Matcher stack for this run.
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
