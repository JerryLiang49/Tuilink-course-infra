import json
import datetime
import logging
import requests

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    """
    Simple Lambda handler function that demonstrates dependencies are loaded
    """
    logger.info(f'Event: {json.dumps(event, indent=2)}')
    
    # Test that requests is working
    try:
        # Just verify requests module is available
        requests_version = requests.__version__
        requests_status = f"requests {requests_version} loaded successfully"
        logger.info(f"requests version {requests_version} loaded successfully")
    except Exception as e:
        requests_status = f"requests error: {str(e)}"
        logger.error(f"requests error: {e}")
    
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