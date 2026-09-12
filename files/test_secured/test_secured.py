import os

import requests

api_key = os.getenv("API_KEY")
password = os.getenv("PASSWORD")
db_password = os.getenv("DB_PASSWORD")
database_url = os.getenv("DATABASE_URL")

print(api_key)