import json
from typing import Any
from decimal import Decimal


class DecimalEncoder(json.JSONEncoder):
    """Custom JSON encoder to handle Decimal objects from DynamoDB."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            # Convert Decimal to int if it's a whole number, otherwise to float
            # DynamoDB returns numbers as Decimal, but API Gateway responses
            # need normal JSON numeric types.
            if obj % 1 == 0:
                return int(obj)
            else:
                return float(obj)
        return super(DecimalEncoder, self).default(obj)

def json_dumps_decimal(obj: Any) -> str:
    """JSON dumps with Decimal support."""
    # Use this for Lambda proxy response bodies whenever DynamoDB items may be
    # included in the payload.
    return json.dumps(obj, cls=DecimalEncoder, default=str)

def convert_floats_to_decimal(obj):
    """Recursively convert float values to Decimal for DynamoDB compatibility."""
    # boto3 rejects raw floats for DynamoDB writes; recursively converting keeps
    # nested result payloads safe to store.
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: convert_floats_to_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats_to_decimal(item) for item in obj]
    else:
        return obj
