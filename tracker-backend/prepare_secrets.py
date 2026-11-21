"""Muestra cómo subir las credenciales locales a GitHub Secrets sin imprimir su contenido.

Antes imprimía el principio y el final de cada valor en base64, que ni servía para copiarlo
ni era seguro dejarlo en la consola. Ahora solo comprueba que existen los ficheros y da el
comando que lee cada uno directamente, para que el valor no pase nunca por la pantalla.
"""
import os

files = {
    "GMAIL_CREDENTIALS_BASE64": "credentials.json",
    "GMAIL_TOKEN_BASE64": "token.json",
    "FIREBASE_SERVICE_ACCOUNT_BASE64": "serviceAccountKey.json",
}

print("=== SUBE ESTOS SECRETOS A GITHUB (con la CLI gh, desde esta carpeta) ===\n")

for secret_name, filename in files.items():
    if os.path.exists(filename):
        print(f"base64 -w0 {filename} | gh secret set {secret_name}")
    else:
        print(f"ERROR: Archivo {filename} no encontrado.")
