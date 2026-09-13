import boto3

# Cloud credentials
AWS_ACCESS_KEY_ID = "AKIADEMO123456789"
AWS_SECRET_ACCESS_KEY = "demoSecretKey987654321"

s3 = boto3.client(
    "s3",
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY
)

print("Connected to S3")