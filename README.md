# Tuilink Project Infrastructure

This CDK project manages the infrastructure for Tuilink serverless backend services.

## Prerequisites

- AWS account
- AWS CLI configured with staging and prod profiles
- AWS CDK installed and bootstrapped
- Node.js 18+ and Yarn installed
- Docker (for Lambda bundling)

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
   yarn bootstrap:staging

   # Bootstrap production environment
   yarn bootstrap:prod
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

# AI Auto Reply configuration
AI_AUTO_REPLY_LAMBDA_SOURCE_PATH=../examples/lambda/
AI_AUTO_REPLY_LAMBDA_HANDLER=ai_auto_reply.handler
# Optionally provide a separate Lambda Layer containing Python deps (expects a requirements.txt under that path)
# AI_AUTO_REPLY_LAMBDA_LAYER_SOURCE_PATH=../examples/lambda/
# AI_AUTO_REPLY_DOMAIN_NAME=api-staging.yourdomain.com
# AI_AUTO_REPLY_DOMAIN_CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/your-api-cert-id

# JD Resume Matcher configuration
JD_RESUME_MATCHER_LAMBDA_SOURCE_PATH=../examples/lambda/
JD_RESUME_MATCHER_QUICK_HANDLER=quick_handler.handler
JD_RESUME_MATCHER_WORKER_HANDLER=worker_handler.handler
# Optionally provide a separate Lambda Layer containing Python deps (expects a requirements.txt under that path)
# JD_RESUME_MATCHER_LAMBDA_LAYER_SOURCE_PATH=../examples/lambda/
# JD_RESUME_MATCHER_DOMAIN_NAME=api-staging.yourdomain.com
# JD_RESUME_MATCHER_DOMAIN_CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/your-api-cert-id
# JD_RESUME_MATCHER_CLOUDFRONT_DOMAIN_NAME=cache-staging.yourdomain.com
# JD_RESUME_MATCHER_CLOUDFRONT_CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/your-cloudfront-cert-id
```

### Environment Variables

| Variable                                       | Description                                                                    | Required | Default                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------ | -------- | ------------------------ |
| `AWS_ACCOUNT`                                  | AWS account ID                                                                 | Yes      | -                        |
| `AWS_REGION`                                   | AWS region for deployment                                                      | Yes      | -                        |
| `AI_AUTO_REPLY_LAMBDA_SOURCE_PATH`             | Path to AI Auto Reply Lambda source code                                       | Yes      | `../examples/lambda/`    |
| `AI_AUTO_REPLY_LAMBDA_HANDLER`                 | AI Auto Reply Lambda handler function                                          | Yes      | `ai_auto_reply.handler`  |
| `AI_AUTO_REPLY_LAMBDA_LAYER_SOURCE_PATH`       | Optional path for a Python Lambda Layer with dependencies (`requirements.txt`) | No       | -                        |
| `AI_AUTO_REPLY_DOMAIN_NAME`                    | Custom domain name for AI Auto Reply API                                       | No       | -                        |
| `AI_AUTO_REPLY_DOMAIN_CERTIFICATE_ARN`         | ACM certificate ARN for AI Auto Reply domain                                   | No       | -                        |
| `JD_RESUME_MATCHER_LAMBDA_SOURCE_PATH`         | Path to JD Resume Matcher Lambda source code                                   | Yes      | `../examples/lambda/`    |
| `JD_RESUME_MATCHER_QUICK_HANDLER`              | JD Resume Matcher quick response Lambda handler function                       | Yes      | `quick_handler.handler`  |
| `JD_RESUME_MATCHER_WORKER_HANDLER`             | JD Resume Matcher background worker Lambda handler function                    | Yes      | `worker_handler.handler` |
| `JD_RESUME_MATCHER_LAMBDA_LAYER_SOURCE_PATH`   | Optional path for a Python Lambda Layer with dependencies (`requirements.txt`) | No       | -                        |
| `JD_RESUME_MATCHER_DOMAIN_NAME`                | Custom domain name for JD Resume Matcher API                                   | No       | -                        |
| `JD_RESUME_MATCHER_DOMAIN_CERTIFICATE_ARN`     | ACM certificate ARN for JD Resume Matcher domain                               | No       | -                        |
| `JD_RESUME_MATCHER_CLOUDFRONT_DOMAIN_NAME`     | Custom domain for JD Resume Matcher CloudFront                                 | No       | -                        |
| `JD_RESUME_MATCHER_CLOUDFRONT_CERTIFICATE_ARN` | ACM certificate ARN for CloudFront domain                                      | No       | -                        |

## Deployment

### Available Scripts

The project includes pre-configured deployment scripts for both services with automatic environment detection:

#### AI Auto Reply Service

```bash
# Deploy to staging environment with your staging AWS profile
yarn deploy-ai-auto-reply:staging

# Deploy to production environment with your prod AWS profile
yarn deploy-ai-auto-reply:prod
```

#### JD Resume Matcher Service

```bash
# Deploy to staging environment with your staging AWS profile
yarn deploy-jd-resume-matcher:staging

# Deploy to production environment with your prod AWS profile
yarn deploy-jd-resume-matcher:prod
```

## Services

### AI Auto Reply Service

A simple API Gateway + Lambda service for AI auto-reply functionality.

#### Features

- **Python 3.12 Runtime**: Latest Python runtime for optimal performance
- **Docker Bundling**: Automatic dependency installation and packaging
- **CORS Support**: Pre-configured CORS for web applications
- **Custom Domain Support**: Optional custom domain configuration
- **Route53 Integration**: Automatic DNS record creation

#### API Endpoints

- **Default API Gateway URL**: `https://[api-id].execute-api.[region].amazonaws.com/prod`
- **Custom Domain URL**: `https://[your-domain]` (if configured)

#### Available Methods

- `GET /ai-reply` - Returns a simple response with timestamp
- `POST /ai-reply` - Accepts POST requests and returns JSON response

### JD Resume Matcher Service

A sophisticated caching service that uses API Gateway + Lambda + S3 + CloudFront to provide intelligent caching based on request body hash.

#### Features

- **Hash-based Caching**: Calculates SHA-256 hash from request body for cache key generation
- **S3 Storage**: Stores processed data in S3 with hash-based file naming
- **CloudFront Distribution**: Serves cached content through CloudFront for fast global access
- **Cache Hit/Miss Logic**: Checks S3 before processing, returns cached data if available
- **Automatic Invalidation**: Creates CloudFront invalidations when new data is stored
- **Custom Domain Support**: Optional custom domains for both API Gateway and CloudFront
- **Route53 Integration**: Automatic DNS record creation for both services
- **Security**: Private S3 bucket with Origin Access Control for CloudFront
- **Python 3.12 Runtime**: Latest Python runtime with optimized memory allocation (512MB)

#### API Endpoints

- **Default API Gateway URL**: `https://[api-id].execute-api.[region].amazonaws.com/prod`
- **Custom Domain URL**: `https://[your-domain]` (if configured)
- **CloudFront URL**: `https://[cloudfront-domain]/[hash-key].json`

#### Available Methods

- `POST /process` - Create a new job with the provided request body and return the job ID
- `GET /jobs/{job_id}` - Get the status and result of a job

#### Cache Behavior

1. **First Request**:

   - Calculates hash from request body
   - Processes the data
   - Stores result in S3 with hash as filename
   - Creates CloudFront invalidation for the new file
   - Returns processed data with cache miss indicator

2. **Subsequent Requests with Same Body**:
   - Calculates same hash from request body
   - Finds existing file in S3
   - Returns cached data with cache hit indicator
   - No processing required

#### Response Headers

- `X-Cache`: Indicates cache status (`HIT` or `MISS`)
- `X-Cache-Key`: The hash key used for caching
- `X-CloudFront-URL`: Direct CloudFront URL for the cached content

## Outputs

### AI Auto Reply Stack

- `ApiGatewayDefaultUrl`: The default API Gateway URL
- `ApiGatewayCustomUrl`: Your custom domain URL (if configured)

### JD Resume Matcher Stack

- `ApiGatewayDefaultUrl`: The default API Gateway URL
- `ApiGatewayCustomUrl`: Your custom domain URL (if configured)
- `CloudFrontDefaultUrl`: The CloudFront distribution default URL
- `CloudFrontCustomUrl`: Your custom CloudFront domain URL (if configured)
- `BucketName`: The S3 bucket name for cache storage

## Domain Configuration

When providing custom domains:

1. Ensure you have a Route53 hosted zone for your domain
2. Create ACM certificates for your domains (API Gateway and CloudFront)
3. Set the domain variables in your environment file
4. The stack will automatically:
   - Look up the hosted zone
   - Use the provided certificates
   - Create custom domains for API Gateway and CloudFront
   - Add A record (and AAAA record if applicable) pointing to the services

### Domain Configuration for JD Resume Matcher

The JD Resume Matcher service supports two separate custom domains:

- **API Gateway Domain**: For the main API endpoint
- **CloudFront Domain**: For direct cache access

This allows you to have different domains for API access and cache serving, providing better separation of concerns and flexibility in DNS management.

## Security Considerations

- Lambda functions have minimal IAM permissions
- S3 bucket has block public access enabled with private access control
- CloudFront uses Origin Access Control for secure S3 access
- CORS is configured but should be restricted in production
- SSL/TLS certificates are managed externally (you provide the ARNs)
- Consider adding API Gateway throttling and usage plans for production
- Environment files are gitignored to prevent committing sensitive data
- Lambda functions use Python 3.12 runtime with optimized memory allocation

## Troubleshooting

### Deployment Issues

If deployment fails:

1. Check your AWS credentials and profile configuration for staging and prod
2. Verify the AWS account and region in your environment file
3. Ensure you have the necessary permissions for all AWS services
4. Check the CDK bootstrap status in your account/region
5. Ensure Docker is running (required for Lambda bundling)

### Common Issues

- **Docker not running**: Lambda bundling requires Docker to be running
- **Certificate not found**: Ensure ACM certificates exist in the specified region
- **Hosted zone not found**: Verify Route53 hosted zone exists for your domain
- **Insufficient permissions**: Check IAM permissions for CDK deployment

## Project Structure

```
tuilink-project-infra/
├── bin/                         # CDK app entry points
│   ├── ai-auto-reply.ts         # AI Auto Reply stack entry
│   └── jd-resume-matcher.ts     # JD Resume Matcher stack entry
├── lib/                         # CDK stack definitions
│   ├── ai-auto-reply.ts         # AI Auto Reply stack
│   └── jd-resume-matcher.ts     # JD Resume Matcher stack
├── examples/                    # Example implementations
│   └── lambda/                  # Lambda function code
│       ├── utils/               # Utility functions
│       ├── ai_auto_reply.py     # AI Auto Reply Lambda function
│       ├── quick_handler.py     # JD Resume Matcher Quick Handler Lambda function
│       ├── worker_handler.py    # JD Resume Matcher Worker Handler Lambda function
│       └── requirements.txt     # Shared dependencies for Lambda functions
├── utils/                       # Utility functions
│   ├── domain.ts                # Domain configuration utilities
│   └── load-env.ts              # Environment loading
├── package.json                 # Dependencies and scripts
├── cdk.json                     # CDK configuration
└── tsconfig.json                # TypeScript configuration
```
