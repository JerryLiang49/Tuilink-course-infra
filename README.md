# Tuilink Project Infrastructure

This CDK project manages the infrastructure for Tuilink serverless backend services.

## Prerequisites

- AWS account
- AWS CLI configured with staging and prod profiles
- AWS CDK installed and bootstrapped
- Node.js 18+ and Yarn installed

## Installation

```bash
# Install dependencies
yarn install
```

## AWS Setup

### AWS CLI Configuration

1. Go to AWS IAM Console, and create the access key and secret for your account

2. Install AWS CLI ([Reference](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html#getting-started-install-instructions))

3. Configure appropriate credentials with `Long-term credentials` for profile `staging` and `prod` ([Reference](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-quickstart.html#getting-started-quickstart-new)):
   ```
   aws configure --profile staging
   ```
   and
   ```
   aws configure --profile prod
   ```

After configuration, your AWS credentials file (`~/.aws/credentials`) should contains:

```ini
[staging]
aws_access_key_id = ...
aws_secret_access_key = ...

[prod]
aws_access_key_id = ...
aws_secret_access_key = ...
```

### AWS CDK Setup

1. Install AWS CDK globally:

   ```bash
   npm install -g aws-cdk
   ```

2. Bootstrap CDK in both staging and production accounts:

   ```bash
   # Bootstrap staging environment
   cdk bootstrap --profile staging

   # Bootstrap production environment
   cdk bootstrap --profile prod
   ```

## Configuration

### Environment Setup

The project uses environment-specific configuration files. Create the following files:

1. Create environment files for your stages:

```bash
# For staging environment
cp .env.example .env.staging

# For production environment
cp .env.example .env.prod
```

2. Edit the environment files with your configuration:

```bash
# .env.staging or .env.prod
AWS_ACCOUNT=123456789012
AWS_REGION=us-east-1
DOMAIN_NAME=api-staging.yourdomain.com
DOMAIN_CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/your-cert-id
```

### Environment Variables

| Variable                 | Description                    | Required | Default |
| ------------------------ | ------------------------------ | -------- | ------- |
| `AWS_ACCOUNT`            | AWS account ID                 | Yes      | -       |
| `AWS_REGION`             | AWS region for deployment      | Yes      | -       |
| `DOMAIN_NAME`            | Your custom domain name        | No       | -       |
| `DOMAIN_CERTIFICATE_ARN` | ACM certificate ARN for domain | No       | -       |

## Deployment

### Available Scripts

The project includes pre-configured deployment scripts:

```bash
# Deploy to staging environment with your staging AWS profile
yarn deploy-ai-auto-reply:staging

# Deploy to production environment with your prod AWS profile
yarn deploy-ai-auto-reply:prod
```

## API Endpoints

After deployment, you'll have access to:

- **Default API Gateway URL**: `https://[api-id].execute-api.[region].amazonaws.com/prod/ai-reply`
- **Custom Domain URL**: `https://[your-domain]/ai-reply` (if configured)

### Available Methods

- `GET /ai-reply` - Returns a simple response with timestamp
- `POST /ai-reply` - Accepts POST requests and returns JSON response

## Outputs

The stack will output:

- `ApiUrl`: The default API Gateway URL
- `CustomDomainUrl`: Your custom domain URL (if configured)

## Domain Configuration

When providing a custom domain:

1. Ensure you have a Route53 hosted zone for your domain
2. Create an ACM certificate for your domain
3. Set `DOMAIN_NAME` and `DOMAIN_CERTIFICATE_ARN` in your environment file
4. The stack will automatically:
   - Look up the hosted zone
   - Use the provided certificate
   - Create a custom domain for API Gateway
   - Add an A record pointing to the API Gateway

## Security Considerations

- The Lambda function has minimal IAM permissions
- CORS is configured but should be restricted in production
- SSL/TLS certificate is managed externally (you provide the ARN)
- Consider adding API Gateway throttling and usage plans for production
- Environment files are gitignored to prevent committing sensitive data

### Deployment Issues

If deployment fails:

1. Check your AWS credentials and profile configuration for staging and prod
2. Verify the AWS account and region in your environment file
3. Ensure you have the necessary permissions for all AWS services
4. Check the CDK bootstrap status in your account/region

## Project Structure

```
tuilink-project-infra/
├── bin/                    # CDK app entry points
│   └── ai-auto-reply.ts   # AI Auto Reply stack entry
├── lib/                    # CDK stack definitions
│   └── ai-auto-reply.ts   # AI Auto Reply stack
├── examples/               # Example implementations
│   └── lambda/            # Lambda function code
│       └── ai_auto_reply.py
├── utils/                  # Utility functions
│   └── load-env.ts        # Environment loading
├── config/                 # Configuration files
├── package.json           # Dependencies and scripts
├── cdk.json              # CDK configuration
└── tsconfig.json         # TypeScript configuration
```
