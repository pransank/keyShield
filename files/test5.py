import os
import requests

API_KEY = os.getenv("API_KEY")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DATABASE_URL = os.getenv("DATABASE_URL")

response = requests.get(
    "https://api.example.com/users",
    headers={"Authorization": API_KEY}
)

print(response.status_code)