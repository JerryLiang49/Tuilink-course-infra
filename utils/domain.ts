import { Stack, CfnOutput } from "aws-cdk-lib";
import { RestApi, DomainName, EndpointType } from "aws-cdk-lib/aws-apigateway";
import { ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { ApiGatewayDomain } from "aws-cdk-lib/aws-route53-targets";
import { HostedZone } from "aws-cdk-lib/aws-route53";

// Shared helper for stacks that want to attach API Gateway to a real domain.
// Stacks can skip this entirely and keep the generated execute-api URL.
export const configureDomain = (
  cdkStack: Stack,
  api: RestApi,
  domainName: string,
  domainCertificateArn: string
) => {
  // Get the hosted zone for the domain
  // The domain must already have a Route53 hosted zone in the target account.
  const hostedZone = HostedZone.fromLookup(cdkStack, "ApiGatewayHostedZone", {
    domainName,
  });

  // Get the certificate for the domain
  // API Gateway regional custom domains need a certificate valid for domainName.
  const certificate = Certificate.fromCertificateArn(
    cdkStack,
    "ApiGatewayCertificate",
    domainCertificateArn
  );

  // Custom Domain for API Gateway
  // Regional endpoints keep the setup simple and avoid edge-optimized
  // certificate-region constraints.
  const customDomain = new DomainName(cdkStack, "ApiGatewayDomainName", {
    domainName,
    certificate,
    endpointType: EndpointType.REGIONAL,
  });

  // Add base path mapping
  // No base path is provided, so the custom domain root maps to the API stage.
  customDomain.addBasePathMapping(api);

  // Route53 A Record pointing to API Gateway
  // This creates the DNS alias that sends HTTPS traffic to the API Gateway
  // custom domain target.
  new ARecord(cdkStack, "ApiGatewayARecord", {
    recordName: domainName,
    zone: hostedZone,
    target: RecordTarget.fromAlias(new ApiGatewayDomain(customDomain)),
  });

  // Output the custom domain URL
  // CloudFormation outputs make the final public endpoint visible after deploy.
  new CfnOutput(cdkStack, "ApiGatewayCustomUrl", {
    value: `https://${domainName}`,
    description: "Custom domain URL for API Gateway",
  });
};
