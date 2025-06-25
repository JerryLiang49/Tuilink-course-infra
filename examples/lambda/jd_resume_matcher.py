import json
import hashlib
import boto3
import os
import time
import datetime
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError

# Initialize AWS clients
s3_client = boto3.client('s3')
cloudfront_client = boto3.client('cloudfront')

# Environment variables
CACHE_BUCKET_NAME = os.environ['CACHE_BUCKET_NAME']
CLOUDFRONT_DOMAIN = os.environ['CLOUDFRONT_DOMAIN']
CLOUDFRONT_URL = os.environ['CLOUDFRONT_URL']

def calculate_hash(data: str) -> str:
    """Calculate SHA-256 hash of the input data."""
    return hashlib.sha256(data.encode('utf-8')).hexdigest()

def check_s3_exists(hash_key: str) -> Optional[Dict[str, Any]]:
    """Check if data exists in S3 and return it if found."""
    try:
        response = s3_client.get_object(
            Bucket=CACHE_BUCKET_NAME,
            Key=f"{hash_key}.json"
        )
        data = json.loads(response['Body'].read().decode('utf-8'))
        return data
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            return None
        raise

def store_in_s3(hash_key: str, data: Dict[str, Any]) -> str:
    """Store data in S3 and return the CloudFront URL."""
    s3_key = f"{hash_key}.json"
    
    # Store in S3
    s3_client.put_object(
        Bucket=CACHE_BUCKET_NAME,
        Key=s3_key,
        Body=json.dumps(data, default=str),
        ContentType='application/json'
    )
    
    # Create CloudFront invalidation to ensure fresh content
    try:
        cloudfront_client.create_invalidation(
            DistributionId=os.environ.get('CLOUDFRONT_DISTRIBUTION_ID', ''),
            InvalidationBatch={
                'Paths': {
                    'Quantity': 1,
                    'Items': [f'/{s3_key}']
                },
                'CallerReference': f"jd-resume-matcher-{hash_key}-{int(time.time())}"
            }
        )
    except Exception as e:
        print(f"Warning: Could not create CloudFront invalidation: {e}")
    
    # Return CloudFront URL
    return f"{CLOUDFRONT_URL}/{s3_key}"

def process_request(event: Dict[str, Any]) -> Dict[str, Any]:
    """Process the request and implement caching logic."""
    try:
        # Extract request body
        body = event.get('body', '{}')
        if isinstance(body, str):
            body = json.loads(body)
        
        # Calculate hash from request body
        body_str = json.dumps(body, sort_keys=True)
        hash_key = calculate_hash(body_str)
        
        # Check if data already exists in S3
        existing_data = check_s3_exists(hash_key)
        
        if existing_data:
            # Data exists, return from cache
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'X-Cache': 'HIT',
                    'X-Cache-Key': hash_key
                },
                'body': json.dumps({
                    'message': 'Data retrieved from cache',
                    'data': existing_data,
                    'cache_key': hash_key,
                    'source': 'cloudfront'
                })
            }
        else:
            # Data doesn't exist, process and store
            # For this example, we'll just echo back the input data
            # In a real scenario, you would process the data here
            processed_data = {
                'input': body,
                'processed_at': str(datetime.datetime.utcnow()),
                'cache_key': hash_key
            }
            
            # Store in S3
            cloudfront_url = store_in_s3(hash_key, processed_data)
            
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'X-Cache': 'MISS',
                    'X-Cache-Key': hash_key
                },
                'body': json.dumps({
                    'message': 'Data processed and cached',
                    'data': processed_data,
                    'cache_key': hash_key,
                    'cloudfront_url': cloudfront_url,
                    'source': 'lambda'
                })
            }
            
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler function."""
    print(f"Received event: {json.dumps(event)}")
    
    # Handle different HTTP methods
    http_method = event.get('httpMethod', 'GET')
    
    if http_method == 'GET':
        # For GET requests, you might want to check query parameters
        # or return a different response
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'message': 'JD Resume Matcher service is running',
                'method': 'GET',
                'cloudfront_domain': CLOUDFRONT_DOMAIN
            })
        }
    elif http_method == 'POST':
        # Process POST requests with caching logic
        return process_request(event)
    else:
        return {
            'statusCode': 405,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Method not allowed',
                'message': f'HTTP method {http_method} is not supported'
            })
        } 