
import sys
import os

path = 'main.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Try to find the block regardless of exact spaces (using regex)
import re
pattern = re.compile(r'full_input\s*=\s*\(\s*f"\{prompt_content\}\\n\\n"\s*f"MANDATORY\s*JSON\s*SCHEMA:\\n\{schema_content\}\\n\\n"\s*f"FECHA\s*DE\s*ENVÍO\s*DEL\s*CORREO:\s*\{email_date\}\\n\\n"\s*f"\[INICIO\s*DEL\s*CORREO\]\\n\{email_body\}\\n\[FIN\s*DEL\s*CORREO\]"\s*\)', re.MULTILINE)

new_code = """        # Clean HTML from email body to reduce noise/tokens
        soup = BeautifulSoup(email_body, "html.parser")
        for script_or_style in soup(["script", "style"]):
            script_or_style.decompose()
        clean_body = soup.get_text(separator=' ')
        clean_body = " ".join(clean_body.split())

        full_input = (
            f"{prompt_content}\\n\\n"
            f"MANDATORY JSON SCHEMA:\\n{schema_content}\\n\\n"
            f"FECHA DE ENVÍO DEL CORREO: {email_date}\\n\\n"
            f"[INICIO DEL CORREO]\\n{clean_body}\\n[FIN DEL CORREO]"
        )"""

if pattern.search(content):
    new_content = pattern.sub(new_code, content)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("SUCCESS")
else:
    print("PATTERN NOT FOUND")

# Also update timeout
content = open(path, 'r', encoding='utf-8').read()
new_content = content.replace('timeout_seconds = int(os.getenv("GEMINI_TIMEOUT_SECONDS", "120"))', 'timeout_seconds = int(os.getenv("GEMINI_TIMEOUT_SECONDS", "180"))')
with open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)
print("TIMEOUT UPDATED")
