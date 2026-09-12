import os
import re

from flask import Flask, request, jsonify
from flask_cors import CORS


app = Flask(__name__)
CORS(app)


def keyshield(code):
    lines = code.splitlines()
    output = []
    env_variables = []

    # Detect API keys, passwords, and database credentials
    pattern = re.compile(
        r'(?i)(api[\s_-]*key|password|passwd|pwd|'
        r'(?:db|database)[\s_-]*password|'
        r'(?:db|database)[\s_-]*url)'
        r'\s*=\s*(["\'])(.*?)\2'
    )

    for line in lines:
        match = pattern.search(line)

        if match:
            original_name = match.group(1)

            # Convert detected name into a standard environment variable
            name_lower = original_name.lower()

            if re.fullmatch(r'api[\s_-]*key', name_lower):
                env_name = "API_KEY"

            elif re.fullmatch(r'password|passwd|pwd', name_lower):
                env_name = "PASSWORD"

            elif re.fullmatch(r'(db|database)[\s_-]*password', name_lower):
                env_name = "DB_PASSWORD"

            elif re.fullmatch(r'(db|database)[\s_-]*url', name_lower):
                env_name = "DATABASE_URL"

            else:
                env_name = original_name.upper()

            if env_name not in env_variables:
                env_variables.append(env_name)

            # Replace the hardcoded secret
            line = pattern.sub(
                lambda m: (
                    f'{m.group(1)} = '
                    f'os.getenv("{env_name}")'
                ),
                line
            )

        output.append(line)

    result = "\n".join(output)

    # Add os import if needed
    if env_variables and not re.search(
        r'^\s*import\s+os\s*$',
        result,
        re.MULTILINE
    ):
        result = "import os\n\n" + result

    return result, env_variables


# ============================================================
# FLASK API
# ============================================================

@app.route("/scan", methods=["POST"])
def scan():
    data = request.get_json()

    if not data or "code" not in data:
        return jsonify({
            "error": "No code provided"
        }), 400

    code = data["code"]

    # Use the exact same KeyShield regex engine
    secured_code, env_variables = keyshield(code)

    return jsonify({
        "secured_code": secured_code,
        "secrets_detected": env_variables
    })


# ============================================================
# ORIGINAL FILE-BASED VERSION
# ============================================================

def main():
    filename = input("Enter the input filename: ").strip()

    if not os.path.exists(filename):
        print(f"Error: File '{filename}' not found.")
        return

    if not filename.endswith(".py"):
        print("Error: V1 currently supports Python files only.")
        return

    # Read the source file
    with open(filename, "r", encoding="utf-8") as file:
        code = file.read()

    # Run KeyShield
    secured_code, env_variables = keyshield(code)

    # Get the folder containing the original file
    source_folder = os.path.dirname(filename)

    # Get original filename without extension
    filename_only = os.path.basename(filename)
    name, extension = os.path.splitext(filename_only)

    # Create secured folder next to original file
    output_folder = os.path.join(
        source_folder,
        f"{name}_secured"
    )

    os.makedirs(output_folder, exist_ok=True)

    # Output secured Python file
    output_filename = os.path.join(
        output_folder,
        f"{name}_secured{extension}"
    )

    with open(output_filename, "w", encoding="utf-8") as file:
        file.write(secured_code)

    # Output .env.example
    env_filename = os.path.join(
        output_folder,
        ".env.example"
    )

    with open(env_filename, "w", encoding="utf-8") as file:
        for variable in env_variables:
            file.write(f"{variable}=your_secret_here\n")

    print("\n--- KeyShield Complete ---")

    if env_variables:
        print(f"Secrets detected: {len(env_variables)}")

        for variable in env_variables:
            print(f"  - {variable}")

        print(f"\nSecured code: {output_filename}")
        print(f"Environment template: {env_filename}")

    else:
        print("No secrets detected.")
        print(f"Output: {output_filename}")


# ============================================================
# START FLASK
# ============================================================

if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )