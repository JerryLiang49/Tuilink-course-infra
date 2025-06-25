import { Stack, CfnOutput } from "aws-cdk-lib";
import { RestApi, DomainName, EndpointType } from "aws-cdk-lib/aws-apigateway";
import { ARecord, RecordTarget } from "aws-cdk-lib/aws-route53";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { ApiGatewayDomain } from "aws-cdk-lib/aws-route53-targets";
import { HostedZone } from "aws-cdk-lib/aws-route53";

export const configureDomain = (
  cdkStack: Stack,
  api: RestApi,
  domainName: string,
  domainCertificateArn: string
) => {
  // Get the hosted zone for the domain
  const hostedZone = HostedZone.fromLookup(cdkStack, "ApiGatewayHostedZone", {
    domainName,
  });

  // Get the certificate for the domain
  const certificate = Certificate.fromCertificateArn(
    cdkStack,
    "ApiGatewayCertificate",
    domainCertificateArn
  );

  // Custom Domain for API Gateway
  const customDomain = new DomainName(cdkStack, "ApiGatewayDomainName", {
    domainName,
    certificate,
    endpointType: EndpointType.REGIONAL,
  });

  // Add base path mapping
  customDomain.addBasePathMapping(api);

  // Route53 A Record pointing to API Gateway
  new ARecord(cdkStack, "ApiGatewayARecord", {
    recordName: domainName,
    zone: hostedZone,
    target: RecordTarget.fromAlias(new ApiGatewayDomain(customDomain)),
  });

  // Output the custom domain URL
  new CfnOutput(cdkStack, "ApiGatewayCustomUrl", {
    value: `https://${domainName}`,
    description: "Custom domain URL for API Gateway",
  });
};
