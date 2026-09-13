import requests

# Session authentication
ACCESS_TOKEN = "demo-access-token-ABC123"
AUTH_TOKEN = "demo-auth-token-XYZ789"

# Application signing secret
SECRET_KEY = "demo-signing-secret-456"

headers = {
    "Authorization": f"Bearer {ACCESS_TOKEN}"
}

response = requests.get(
    "https://api.example.com/profile",
    headers=headers
)

print(response.json())