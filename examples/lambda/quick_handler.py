import json
import uuid
import boto3
import os
from datetime import datetime, timezone
from typing import Dict, Any
from botocore.exceptions import ClientError

from utils.s3_cloudfront import json_dumps_decimal
from utils.hash import calculate_hash

# The quick handler is the synchronous API Lambda. It should do minimal work:
# dedupe requests, create a job record, enqueue SQS work, or return job status.

# Initialize AWS clients
# Clients/resources are initialized at import time so warm Lambda invocations can
# reuse connections instead of recreating them for every request.
dynamodb = boto3.resource('dynamodb')
sqs = boto3.client('sqs')

# Environment variables
# CDK injects these values from the created DynamoDB table and SQS queue.
JOBS_TABLE_NAME = os.environ['JOBS_TABLE_NAME']
JOB_QUEUE_URL = os.environ['JOB_QUEUE_URL']

# DynamoDB table
# This table is the API-visible source of truth for async job status.
jobs_table = dynamodb.Table(JOBS_TABLE_NAME)


def create_response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """Create a standardized API Gateway response."""
    # Centralizing response shape keeps CORS and JSON serialization consistent
    # across success and error paths.
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        'body': json_dumps_decimal(body)
    }

def handle_post_process(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle POST /process requests - check existing job by cache_key first, then create new job and queue it."""
    try:
        # Parse request body
        # The raw body string is used for hashing so identical requests map to
        # the same cache key.
        body = event.get('body', '{}')

        cache_key = calculate_hash(body)
        
        # Check if a job already exists with this cache_key using GSI
        # This avoids duplicate processing when clients retry or submit the same
        # resume/JD payload more than once.
        try:
            response = jobs_table.query(
                IndexName='cache-key-index',
                KeyConditionExpression='cache_key = :cache_key',
                ExpressionAttributeValues={':cache_key': cache_key},
                Limit=1  # We only need to know if one exists
            )
            
            if response['Items']:
                # Job already exists with this cache_key
                existing_job = response['Items'][0]
                return create_response(200, {
                    'message': 'Job already exists for this request',
                    'data': {
                        "job": existing_job,
                    }
                })
                
        except ClientError as e:
            print(f"DynamoDB GSI query error: {str(e)}")
            # Continue with creating new job if query fails
        
        # Generate unique job ID
        # The job_id is the client-facing polling key for GET /jobs/{job_id}.
        job_id = str(uuid.uuid4())
        
        # Create job record in DynamoDB
        # Store the raw payload so the worker can process exactly what was
        # submitted after it receives the SQS message.
        job = {
            'job_id': job_id,
            'status': 'PENDING',
            'payload': body,
            'cache_key': cache_key,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'updated_at': datetime.now(timezone.utc).isoformat()
        }
        
        # Store job in DynamoDB
        # The record is written before SQS enqueue so polling can find it
        # immediately after the 202 response.
        jobs_table.put_item(Item=job)
        
        # Send message to SQS queue
        # Only the job_id is sent; the worker loads the full payload from
        # DynamoDB to keep SQS messages small.
        sqs.send_message(
            QueueUrl=JOB_QUEUE_URL,
            MessageBody=json.dumps({
                'job_id': job_id
            })
        )
        
        return create_response(202, {
            'message': 'Job created and queued for processing',
            'data': {
                "job": job
            }
        })
        
    except json.JSONDecodeError:
        return create_response(400, {
            'message': 'Invalid JSON in request body'
        })
    except Exception as e:
        print(f"Error processing job: {str(e)}")
        return create_response(500, {
            'message': 'Internal server error',
            'error': str(e)
        })

def handle_get_job_status(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle GET /jobs/{job_id} requests - return job status."""
    try:
        # Extract job_id from path parameters
        # API Gateway supplies path variables under pathParameters for Lambda
        # proxy integrations.
        path_parameters = event.get('pathParameters', {})
        job_id = path_parameters.get('job_id')
        
        if not job_id:
            return create_response(400, {
                'message': 'Missing job_id in path parameters'
            })
        
        # Get job from DynamoDB
        # The full job document is returned so callers can see status, result,
        # or failure details.
        try:
            response = jobs_table.get_item(Key={'job_id': job_id})
            
            if 'Item' not in response:
                return create_response(404, {
                    'message': 'Job not found'
                })
            
            job = response['Item']
            
            # Return job status
            return create_response(200, {
                "message": "Job status retrieved",
                "data": {
                    "job": job
                }
            })
            
        except ClientError as e:
            print(f"DynamoDB error: {str(e)}")
            return create_response(500, {
                'message': 'Database error',
                'error': str(e),
            })
            
    except Exception as e:
        print(f"Error getting job status: {str(e)}")
        return create_response(500, {
            'message': 'Internal server error',
            'error': str(e),
        })

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler function for quick processing."""
    print(f"Received event: {json.dumps(event)}")
    
    # Handle different HTTP methods and paths
    # This keeps API Gateway simple: both routes point to one Lambda and Python
    # dispatches based on method/path.
    http_method = event.get('httpMethod', 'GET')
    path = event.get('path', '/')
    
    try:
        if http_method == 'POST' and path == '/process':
            return handle_post_process(event)
        elif http_method == 'GET' and path.startswith('/jobs/'):
            return handle_get_job_status(event)
        else:
            return create_response(405, {
                'message': 'Method not allowed',
                'error': f'HTTP method {http_method} on path {path} is not supported'
            })
            
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        return create_response(500, {
            'message': 'Internal server error',
            'error': str(e)
        })
