import hashlib


def calculate_hash(data: str) -> str:
    """Calculate SHA-256 hash of the input data."""
    # Stable hashes let the quick handler dedupe jobs and let the worker reuse
    # cached S3/CloudFront results for identical request bodies.
    return hashlib.sha256(data.encode('utf-8')).hexdigest()
