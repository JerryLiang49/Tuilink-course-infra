import json
import datetime
import logging
import requests

# This sample Lambda is used when the infra project deploys ../examples/lambda/.
# The real homework app can replace this source path with the built starter app.

# Configure logging
# Lambda reuses execution environments, so configure the root logger once at
# import time instead of inside every request.
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    """
    Simple Lambda handler function that demonstrates dependencies are loaded
    """
    # Log the raw API Gateway event so deployment tests can verify routing,
    # headers, path, and request body reached the Lambda.
    logger.info(f'Event: {json.dumps(event, indent=2)}')
    
    # Test that requests is working
    # This is a dependency smoke test for Docker bundling or Lambda layers.
    try:
        # Just verify requests module is available
        requests_version = requests.__version__
        requests_status = f"requests {requests_version} loaded successfully"
        logger.info(f"requests version {requests_version} loaded successfully")
    except Exception as e:
        requests_status = f"requests error: {str(e)}"
        logger.error(f"requests error: {e}")
    
    # API Gateway expects Lambda proxy responses with statusCode, headers, and
    # body. The body must be a JSON string, not a Python dict.
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        },
        'body': json.dumps({
            'message': 'Hello from AI Auto Reply Lambda!',
            'timestamp': datetime.datetime.now().isoformat(),
            'dependencies': {
                'requests': requests_status
            },
            'event': event
        })
    }
