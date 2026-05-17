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

// Prefer a service-specific key, but allow OPENAI_API_KEY so deploy commands can
// source the starter repo's .env without duplicating secrets in infra files.
const openAiApiKey =
  env.JD_RESUME_MATCHER_OPENAI_API_KEY ?? env.OPENAI_API_KEY;

// Runtime configuration for the Python workflow. These values are passed to the
// Lambdas by CloudFormation instead of copying local .env files into the bundle.
const lambdaEnvironment: Record<string, string> = {
  LLM_USE_CACHE:
    env.JD_RESUME_MATCHER_LLM_USE_CACHE ?? env.LLM_USE_CACHE ?? "false",
  LLM_MODEL:
    env.JD_RESUME_MATCHER_LLM_MODEL ?? env.LLM_MODEL ?? "gpt-4.1-mini",
  LLM_TEMPERATURE:
    env.JD_RESUME_MATCHER_LLM_TEMPERATURE ?? env.LLM_TEMPERATURE ?? "0",
  LLM_EMBEDDING_MODEL:
    env.JD_RESUME_MATCHER_LLM_EMBEDDING_MODEL ??
    env.LLM_EMBEDDING_MODEL ??
    "text-embedding-3-small",
  MATCH_THRESHOLD:
    env.JD_RESUME_MATCHER_MATCH_THRESHOLD ?? env.MATCH_THRESHOLD ?? "0.5",
};

if (openAiApiKey) {
  // Do not log the actual key. The config logger below masks it as <set>.
  lambdaEnvironment.OPENAI_API_KEY = openAiApiKey;
}

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
    lambdaEnvironment: {
      ...lambdaEnvironment,
      OPENAI_API_KEY: openAiApiKey ? "<set>" : "<missing>",
    },
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
  lambdaEnvironment,
  env: {
    account,
    region,
  },
});
