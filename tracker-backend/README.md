# Flowt Backend

Sincronizador en Python que consulta notificaciones bancarias en Gmail, usa Gemini para extraer un movimiento estructurado y guarda el resultado en Firestore para el usuario configurado.

> [!WARNING]
> El backend procesa correos y datos financieros reales. Pruébalo primero con un proyecto aislado y datos no sensibles. Revisa los [hallazgos de seguridad abiertos](https://github.com/Isalvan/flowt/issues) antes de desplegarlo para terceros.

## Requisitos

- Python 3.10 o posterior.
- Un proyecto de Firebase con Authentication y Firestore.
- Una cuenta de servicio de Firebase con los permisos mínimos necesarios.
- Un cliente OAuth de escritorio con Gmail API y el alcance `gmail.readonly`.
- Una clave de API de Gemini.

## Instalación

Desde `tracker-backend/`:

```bash
python -m venv .venv
```

Activa el entorno:

```bash
# Linux/macOS
source .venv/bin/activate

# Windows PowerShell
.venv\Scripts\Activate.ps1
```

Instala las dependencias:

```bash
python -m pip install -r requirements.txt
```

En Windows también puedes usar `start.bat`, que prepara el entorno y ejecuta el sincronizador.

## 1. Firebase Admin

1. Crea o selecciona un proyecto en [Firebase Console](https://console.firebase.google.com/).
2. Habilita Authentication y Firestore.
3. Crea una cuenta de servicio dedicada con el menor conjunto de permisos compatible con el sincronizador.
4. Descarga su clave JSON como `serviceAccountKey.json` dentro de `tracker-backend/`.

La cuenta de servicio ignora las reglas cliente de Firestore. Su clave permite actuar con los permisos IAM asignados; no la compartas ni la incluyas en Git.

## 2. OAuth de Gmail

1. En [Google Cloud Console](https://console.cloud.google.com/), habilita Gmail API.
2. Configura la pantalla de consentimiento OAuth.
3. Solicita solamente el alcance `gmail.readonly`.
4. Crea un cliente OAuth de tipo aplicación de escritorio.
5. Descarga el archivo como `credentials.json` dentro de `tracker-backend/`.

En la primera ejecución se abrirá el consentimiento de Google y se generará `token.json`. Ese token permite acceder al correo dentro de los permisos concedidos hasta que se revoque o expire.

## 3. Gemini

Crea una clave en [Google AI Studio](https://aistudio.google.com/) y limita su uso cuando la plataforma lo permita. La disponibilidad, coste y tratamiento de datos dependen de la cuenta y del modelo configurados.

## 4. Variables de entorno

Copia el ejemplo:

```bash
cp .env.example .env
```

En Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Completa estas variables:

```dotenv
BANK_SENDER=alertas@tu-banco.example
UID_PROPIETARIO=uid_de_firebase
MAX_EMAILS_PER_RUN=10
MIN_CONFIDENCE=alta
AI_MODEL=gemini-3-flash-preview
GEMINI_API_KEY=...
```

- `BANK_SENDER`: remitente admitido. Trátalo como un filtro de entrada, no como prueba criptográfica de identidad.
- `UID_PROPIETARIO`: usuario de Firebase bajo el que se guardan los datos.
- `MIN_CONFIDENCE`: umbral que decide qué movimientos requieren revisión.
- `AI_MODEL`: modelo solicitado. El valor del ejemplo puede dejar de estar disponible al ser una versión preview.

## Ejecución local

```bash
python main.py
```

La primera ejecución requiere interacción para autorizar Gmail. Las posteriores reutilizan `token.json`.

Para ejecutar las pruebas:

```bash
python -m pytest
```

## GitHub Actions

El workflow versionado está en [`.github/workflows/run_tracker.yml`](../.github/workflows/run_tracker.yml) y se puede iniciar manualmente o mediante su programación.

Configura estos secretos del repositorio:

| Secreto | Contenido |
|---|---|
| `BANK_SENDER` | Remitente permitido |
| `UID_PROPIETARIO` | UID de Firebase |
| `GEMINI_API_KEY` | Clave de Gemini |
| `AI_MODEL` | Modelo configurado |
| `GMAIL_CREDENTIALS_BASE64` | `credentials.json` codificado en base64 |
| `GMAIL_TOKEN_BASE64` | `token.json` codificado en base64 |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | `serviceAccountKey.json` codificado en base64 |

En Linux, genera cada valor sin saltos de línea:

```bash
base64 -w 0 credentials.json
base64 -w 0 token.json
base64 -w 0 serviceAccountKey.json
```

En macOS:

```bash
base64 < credentials.json | tr -d '\n'
```

Base64 es una codificación, no cifrado. Los valores deben permanecer en GitHub Actions Secrets y no deben imprimirse en logs. Limita los permisos del workflow, fija las acciones de terceros a revisiones confiables y revisa los artefactos antes de hacer público el repositorio.

## Archivos que no deben publicarse

- `.env`
- `credentials.json`
- `token.json`
- `serviceAccountKey.json`
- logs, volcados, artefactos o capturas que contengan sus valores

Estos nombres están incluidos en el `.gitignore` del proyecto. Aun así, revisa el historial completo y rota cualquier credencial que haya llegado a Git o a metadatos de GitHub.

## Límites de seguridad relevantes

- El filtro por remitente no demuestra por sí solo que el mensaje proceda del banco.
- El texto del correo y la salida del modelo son entradas no confiables y deben validarse antes de escribir en Firestore.
- La idempotencia reduce duplicados en rutas concretas, pero debe comprobarse también en la aprobación manual y ante ejecuciones concurrentes.
- Los datos enviados a Gemini salen del límite de Gmail/Firestore; evalúa minimización y retención.
- Que el repositorio sea privado no corrige una credencial expuesta. Que sea público no implica exponer secretos si estos nunca están en Git ni en superficies públicas asociadas.

Consulta [SECURITY.md](../SECURITY.md) y el [checklist de publicación](../docs/PUBLIC_RELEASE_CHECKLIST.md) antes de desplegar.
