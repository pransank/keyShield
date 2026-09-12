import os
import re

from flask import Flask, request, jsonify
from flask_cors import CORS


app = Flask(__name__)
CORS(app)


# Ordered (pattern, ENV_NAME) pairs. Order matters: more specific patterns
# must come before generic ones, or e.g. "db_password" would get eaten by
# the plain "password" rule and mislabeled.
SECRET_PATTERNS = [
    (r'aws[\s_-]*secret[\s_-]*(?:access[\s_-]*)?key', "AWS_SECRET_ACCESS_KEY"),
    (r'aws[\s_-]*access[\s_-]*key(?:[\s_-]*id)?', "AWS_ACCESS_KEY_ID"),
    (r'(?:db|database)[\s_-]*password', "DB_PASSWORD"),
    (r'(?:db|database)[\s_-]*url', "DATABASE_URL"),
    (r'api[\s_-]*key', "API_KEY"),
    (r'secret[\s_-]*key', "SECRET_KEY"),
    (r'access[\s_-]*token', "ACCESS_TOKEN"),
    (r'auth[\s_-]*token', "AUTH_TOKEN"),
    (r'password|passwd|pwd', "PASSWORD"),
    (r'token', "TOKEN"),
    (r'secret', "SECRET"),
]

_NAME_ALTERNATION = "|".join(f"(?:{p})" for p, _ in SECRET_PATTERNS)
SECRET_LINE_RE = re.compile(
    rf'(?i)\b({_NAME_ALTERNATION})\b\s*=\s*(["\'])(.*?)\2'
)

# Which severity bucket each detected env var falls into. Raw credentials
# and tokens are the ones that grant direct account/API access if leaked —
# those are "serious". Passwords are "moderate" (still bad, usually scoped
# to one system). Connection strings are "low" by default since this is a
# rough heuristic, not a real risk model — call this out if anyone asks.
SEVERITY_MAP = {
    "AWS_SECRET_ACCESS_KEY": "serious",
    "AWS_ACCESS_KEY_ID": "serious",
    "API_KEY": "serious",
    "SECRET_KEY": "serious",
    "AUTH_TOKEN": "serious",
    "ACCESS_TOKEN": "serious",
    "TOKEN": "serious",
    "SECRET": "serious",
    "PASSWORD": "moderate",
    "DB_PASSWORD": "moderate",
    "DATABASE_URL": "low",
}


def severity_counts_for(env_variables):
    counts = {"serious": 0, "moderate": 0, "low": 0}
    for name in env_variables:
        severity = SEVERITY_MAP.get(name, "low")
        counts[severity] += 1
    return counts


# Maps this codebase's internal three-tier severity naming ("serious" /
# "moderate" / "low") to the high/medium/low labels the heatmap frontend
# expects. Two separate vocabularies exist here on purpose — the /scan
# response format is already relied on by the extension, so it's left
# alone rather than renamed to match this new endpoint.
_SEVERITY_LABEL = {"serious": "high", "moderate": "medium", "low": "low"}


def keyshield_detailed(code):
    """Same detection logic as keyshield(), but returns per-finding detail
    (line number, severity, raw secret value, replacement) instead of just
    the secured code and a flat list of env var names."""
    lines = code.splitlines()
    findings = []

    def make_replacer(line_no):
        def replace_match(m):
            matched_name = m.group(1)
            secret_value = m.group(3)
            env_name = _env_name_for(matched_name)
            severity_label = _SEVERITY_LABEL[SEVERITY_MAP.get(env_name, "low")]
            replacement = f'os.getenv("{env_name}")'

            findings.append({
                "line": line_no,
                "severity": severity_label,
                "type": env_name.lower(),
                "original": secret_value,
                "replacement": replacement
            })

            return f'{matched_name} = {replacement}'
        return replace_match

    secured_lines = [
        SECRET_LINE_RE.sub(make_replacer(line_no), line)
        for line_no, line in enumerate(lines, start=1)
    ]
    secured_code = "\n".join(secured_lines)

    if findings and not re.search(
        r'^\s*import\s+os\s*$', secured_code, re.MULTILINE
    ):
        secured_code = "import os\n\n" + secured_code

    return {
        "original_code": code,
        "secured_code": secured_code,
        "findings": findings
    }


@app.route("/scan_detailed", methods=["POST"])
def scan_detailed():
    data = request.get_json()

    if not data or "code" not in data:
        return jsonify({"error": "No code provided"}), 400

    return jsonify(keyshield_detailed(data["code"]))


def _env_name_for(matched_name):
    """Map the identifier text that was actually matched to a canonical
    env var name, checking the same ordered list used to build the regex
    so behavior stays in sync with detection."""
    normalized = matched_name.lower()
    for pattern, env_name in SECRET_PATTERNS:
        if re.fullmatch(pattern, normalized, re.IGNORECASE):
            return env_name
    return re.sub(r'\W+', '_', matched_name).upper()


def keyshield(code):
    env_variables = []

    def replace_match(m):
        matched_name = m.group(1)
        # Looked up per-match (not captured once outside the loop), so two
        # different secrets on the same line each get their own correct
        # env name instead of both inheriting whichever matched first.
        env_name = _env_name_for(matched_name)
        if env_name not in env_variables:
            env_variables.append(env_name)
        return f'{matched_name} = os.getenv("{env_name}")'

    result = SECRET_LINE_RE.sub(replace_match, code)

    if env_variables and not re.search(
        r'^\s*import\s+os\s*$', result, re.MULTILINE
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

    secured_code, env_variables = keyshield(code)

    return jsonify({
        "secured_code": secured_code,
        "secrets_detected": env_variables,
        "severity_counts": severity_counts_for(env_variables)
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

    with open(filename, "r", encoding="utf-8") as file:
        code = file.read()

    secured_code, env_variables = keyshield(code)

    source_folder = os.path.dirname(filename)
    filename_only = os.path.basename(filename)
    name, extension = os.path.splitext(filename_only)

    output_folder = os.path.join(source_folder, f"{name}_secured")
    os.makedirs(output_folder, exist_ok=True)

    output_filename = os.path.join(output_folder, f"{name}_secured{extension}")
    with open(output_filename, "w", encoding="utf-8") as file:
        file.write(secured_code)

    env_filename = os.path.join(output_folder, ".env.example")
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