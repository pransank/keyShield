import psycopg2

# Production database
DB_PASSWORD = "DemoDBPassword789!"

DATABASE_URL = "postgresql://admin:DemoDBPassword789@db.example.com:5432/users"

connection = psycopg2.connect(
    DATABASE_URL
)

print("Database connected")