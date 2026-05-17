import json
import time
import boto3
import os
import random
from datetime import datetime, timezone
from typing import Dict, Any
from botocore.exceptions import ClientError

from utils.hash import calculate_hash
from utils.s3_cloudfront import get_cached_data, store_in_s3, json_dumps_decimal
from utils.decimal import convert_floats_to_decimal

# The worker handler is the asynchronous processor. SQS invokes it after the
# quick handler creates a job, so API clients do not wait for long processing.

# Initialize AWS clients
# Initialize at module load for Lambda warm-start reuse.
dynamodb = boto3.resource('dynamodb')

# Environment variables
# CDK injects the table name from the stack.
JOBS_TABLE_NAME = os.environ['JOBS_TABLE_NAME']

# DynamoDB table
# Job records track status transitions and final results for polling clients.
jobs_table = dynamodb.Table(JOBS_TABLE_NAME)


def update_job_status(job_id: str, status: str, result: Dict[str, Any] = None, error: str = None) -> None:
    """Update job status in DynamoDB."""
    try:
        # Build one update expression so status, timestamps, result, and errors
        # are written atomically for a job.
        update_expression = "SET #status = :status, updated_at = :updated_at"
        expression_attribute_names = {"#status": "status"}
        expression_attribute_values = {
            ":status": status,
            ":updated_at": datetime.now(timezone.utc).isoformat()
        }
        
        if result:
            # DynamoDB stores numbers as Decimal, so convert Python floats before
            # writing nested result data.
            update_expression += ", #result = :result"
            expression_attribute_names["#result"] = "result"
            expression_attribute_values[":result"] = convert_floats_to_decimal(result)
        
        if error:
            update_expression += ", #error = :error"
            expression_attribute_names["#error"] = "error"
            expression_attribute_values[":error"] = error
        
        jobs_table.update_item(
            Key={'job_id': job_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values
        )
        
    except ClientError as e:
        print(f"Error updating job {job_id}: {str(e)}")
        raise

def get_job_payload(job_id: str) -> Dict[str, Any]:
    """Get job payload from DynamoDB."""
    try:
        # SQS messages contain only job_id; the payload is loaded here from the
        # authoritative DynamoDB job record.
        response = jobs_table.get_item(Key={'job_id': job_id})
        
        if 'Item' not in response:
            raise ValueError(f"Job {job_id} not found")
        
        return response['Item']['payload']
        
    except ClientError as e:
        print(f"Error getting job {job_id}: {str(e)}")
        raise

def process_job(job_id: str, payload: str) -> Dict[str, Any]:
    """Process the job with simulated long-running work and S3/CloudFront caching."""
    print(f"Processing job {job_id} with payload: {payload}")
    
    # Calculate hash from payload for caching
    # The hash becomes the stable object key for cached output.
    cache_key = calculate_hash(payload)
    print(f"Cache key for job {job_id}: {cache_key}")
    
    # Check if result already exists in CloudFront cache
    # Cache hits avoid repeating expensive matching logic for identical inputs.
    existing_cache_data = get_cached_data(cache_key)
    if existing_cache_data:
        print(f"Job {job_id} result found in cache, skipping processing")
        
        # Return the cached result directly to maintain same structure as cache miss
        # This ensures API responses are identical for both cache hit and miss
        update_job_status(job_id, "SUCCEEDED", result=existing_cache_data)
        print(f"Job {job_id} completed from cache")
        return existing_cache_data
    
    # Update job status to PROCESSING
    # Polling clients can use this transition to show progress.
    update_job_status(job_id, "PROCESSING")
    
    # Simulate long-running work
    # In a real scenario, this would be actual job processing
    # This sample sleeps to demonstrate the async architecture without requiring
    # real resume matching logic.
    processing_time = random.uniform(10, 60)  # Random processing time between 10-60 seconds
    print(f"Simulating {processing_time:.2f} seconds of processing...")
    
    # Break the sleep into smaller chunks to show progress
    # Chunking produces CloudWatch logs during the simulated wait.
    chunks = int(processing_time / 5)  # 5-second chunks
    remaining_time = processing_time
    
    for i in range(chunks):
        time.sleep(min(5, remaining_time))
        remaining_time -= 5
        print(f"Processing... {((i+1)/chunks)*100:.1f}% complete")
    
    # Sleep any remaining time
    if remaining_time > 0:
        time.sleep(remaining_time)
    
    # Process and cache result (removed random failure for testing)
    # Replace this sample payload with real JD/resume matching output in the
    # production starter implementation.
    processed_result = {
        'cache_key': cache_key,
        'source': 'processor',
        'input_data': payload,
        'output_data': {
            'message': 'Job completed successfully',
            'word_count': len(str(payload).split()) if payload else 0,
            'character_count': len(str(payload)) if payload else 0,
        },
        'processed_at': datetime.now(timezone.utc).isoformat(),
        'processing_time_seconds': processing_time,
    }
    
    # Store result in S3 and get CloudFront URL
    # The DynamoDB result includes the CDN URL so clients can fetch cached output
    # directly when needed.
    try:
        cloudfront_url = store_in_s3(cache_key, processed_result)
        processed_result['cloudfront_url'] = cloudfront_url
        print(f"Job {job_id} result stored in S3 with CloudFront URL: {cloudfront_url}")
    except Exception as e:
        print(f"Warning: Could not store result in S3 for job {job_id}: {e}")
    
    update_job_status(job_id, "SUCCEEDED", result=processed_result)
    print(f"Job {job_id} completed successfully")
    return processed_result

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler function for worker processing."""
    print(f"Worker received event: {json.dumps(event)}")
    
    # Process SQS messages
    # Each record corresponds to one queued job. The CDK event source maps only
    # one message per batch to keep failures isolated.
    records = event.get('Records', [])
    
    for record in records:
        try:
            # Parse SQS message
            # The quick handler sends {"job_id": "..."} as the message body.
            message_body = json.loads(record['body'])
            job_id = message_body.get('job_id')
            
            if not job_id:
                print(f"No job_id found in message: {message_body}")
                continue
            
            print(f"Processing job: {job_id}")
            
            # Get job payload from DynamoDB
            # Missing jobs are skipped because there is no payload to process.
            try:
                payload = get_job_payload(job_id)
            except ValueError as e:
                print(f"Job not found: {str(e)}")
                continue
            except Exception as e:
                print(f"Error getting job payload: {str(e)}")
                update_job_status(job_id, "FAILED", error=f"Error retrieving job: {str(e)}")
                continue
            
            # Process the job
            # Any processing exception is captured into the job record instead
            # of crashing the entire batch.
            try:
                result = process_job(job_id, payload)
                print(f"Job {job_id} processed successfully")
                
            except Exception as e:
                print(f"Error processing job {job_id}: {str(e)}")
                update_job_status(job_id, "FAILED", error=str(e))
                
        except json.JSONDecodeError as e:
            print(f"Error parsing SQS message: {str(e)}")
            continue
        except Exception as e:
            print(f"Unexpected error processing record: {str(e)}")
            continue
    
    return {
        'statusCode': 200,
        'body': json_dumps_decimal({
            'message': f'Processed {len(records)} records',
            "data": {
                "records_processed": len(records)
            }
        })
    }
