#!/usr/bin/env node
import { env } from "process";
import { App } from "aws-cdk-lib";
import { JdResumeMatcherStack } from "../lib/jd-resume-matcher";
import { loadEnv } from "../utils/load-env";

const { camelCasedStage, account, region } = loadEnv();
const stackName = `JdResumeMatcher-${camelCasedStage}`;
const domainName = env.JD_RESUME_MATCHER_DOMAIN_NAME;
const domainCertificateArn = env.JD_RESUME_MATCHER_DOMAIN_CERTIFICATE_ARN;
const cloudFrontDomainName = env.JD_RESUME_MATCHER_CLOUDFRONT_DOMAIN_NAME;
const cloudFrontCertificateArn =
  env.JD_RESUME_MATCHER_CLOUDFRONT_CERTIFICATE_ARN;

console.info(
  "Deploying with config",
  {
    stackName,
    domainName,
    domainCertificateArn,
    cloudFrontDomainName,
    cloudFrontCertificateArn,
  },
  "\n"
);

const app = new App();
new JdResumeMatcherStack(app, stackName, {
  domainName,
  domainCertificateArn,
  cloudFrontDomainName,
  cloudFrontCertificateArn,
  env: {
    account,
    region,
  },
});
