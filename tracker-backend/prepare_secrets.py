import base64
import os

files = {
    "GMAIL_CREDENTIALS_BASE64": "credentials.json",
    "GMAIL_TOKEN_BASE64": "token.json",
    "FIREBASE_SERVICE_ACCOUNT_BASE64": "serviceAccountKey.json"
}

print("=== COPIA ESTOS VALORES A GITHUB SECRETS ===\n")

for secret_name, filename in files.items():
    if os.path.exists(filename):
        with open(filename, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("utf-8")
            print(f"NOMBRE: {secret_name}")
            print(f"VALOR: {encoded}\n")
            print("-" * 40)
    else:
        print(f"ERROR: Archivo {filename} no encontrado.\n")
