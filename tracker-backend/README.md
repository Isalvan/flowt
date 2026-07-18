# Flowt Backend

Servicio de sincronización de Flowt. Consulta notificaciones bancarias en Gmail, extrae movimientos mediante Gemini y guarda el resultado en Firestore.

## Responsabilidades

- Autenticar el acceso de solo lectura a Gmail.
- Buscar mensajes del remitente configurado.
- Normalizar el contenido de los mensajes.
- Extraer y validar movimientos financieros.
- Enviar casos ambiguos a revisión manual.
- Persistir movimientos e información de procesamiento en Firestore.
- Evitar el reprocesamiento de mensajes ya gestionados.

## Requisitos

- Python 3.10 o posterior.
- Proyecto de Firebase con Firestore.
- Cuenta de servicio de Firebase.
- Proyecto de Google Cloud con Gmail API.
- Cliente OAuth de escritorio con el alcance `gmail.readonly`.
- Clave de API de Gemini.

## Instalación

```bash
cd tracker-backend
python -m venv .venv
```

Activa el entorno e instala las dependencias:

```bash
# Linux y macOS
source .venv/bin/activate

# Windows PowerShell
.venv\Scripts\Activate.ps1

python -m pip install -r requirements.txt
```

En Windows también puede utilizarse `start.bat`.

## Configuración

### Firebase

1. Habilita Authentication y Firestore en Firebase Console.
2. Crea una cuenta de servicio dedicada.
3. Descarga la clave como `tracker-backend/serviceAccountKey.json`.

### Gmail

1. Habilita Gmail API en Google Cloud.
2. Configura la pantalla de consentimiento OAuth.
3. Añade el alcance `gmail.readonly`.
4. Crea un cliente OAuth de tipo aplicación de escritorio.
5. Descarga el cliente como `tracker-backend/credentials.json`.

La primera ejecución abre el consentimiento de Google y genera `token.json`.

### Variables de entorno

```bash
cp .env.example .env
```

```dotenv
BANK_SENDER=alertas@tu-banco.example
UID_PROPIETARIO=uid_de_firebase
MAX_EMAILS_PER_RUN=10
MIN_CONFIDENCE=alta
AI_MODEL=gemini-3-flash-preview
GEMINI_API_KEY=...
```

| Variable | Descripción |
|---|---|
| `BANK_SENDER` | Remitente de las notificaciones que se procesarán |
| `UID_PROPIETARIO` | UID de Firebase propietario de los datos |
| `MAX_EMAILS_PER_RUN` | Máximo de mensajes procesados por ejecución |
| `MIN_CONFIDENCE` | Umbral para aceptar o enviar a revisión |
| `AI_MODEL` | Modelo de Gemini utilizado |
| `GEMINI_API_KEY` | Credencial de acceso a Gemini |

## Ejecución

```bash
python main.py
```

## Pruebas

```bash
python -m pytest
```

## Automatización con GitHub Actions

El workflow [`.github/workflows/run_tracker.yml`](../.github/workflows/run_tracker.yml) ejecuta el sincronizador de forma programada y permite ejecuciones manuales.

Configura estos secretos en **Settings → Secrets and variables → Actions**:

| Secreto | Contenido |
|---|---|
| `BANK_SENDER` | Remitente bancario |
| `UID_PROPIETARIO` | UID de Firebase |
| `GEMINI_API_KEY` | Clave de Gemini |
| `AI_MODEL` | Modelo configurado |
| `GMAIL_CREDENTIALS_BASE64` | `credentials.json` en base64 |
| `GMAIL_TOKEN_BASE64` | `token.json` en base64 |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | `serviceAccountKey.json` en base64 |

Codificación en Linux:

```bash
base64 -w 0 credentials.json
base64 -w 0 token.json
base64 -w 0 serviceAccountKey.json
```

Codificación en macOS:

```bash
base64 < credentials.json | tr -d '\n'
```

Base64 no cifra el contenido. Conserva estos valores exclusivamente en el almacén de secretos.

## Archivos locales

Los siguientes archivos contienen configuración o credenciales y están excluidos de Git:

- `.env`
- `credentials.json`
- `token.json`
- `serviceAccountKey.json`
- `.venv/`

## Operación

- El workflow se ejecuta cada 30 minutos según su expresión cron.
- `workflow_dispatch` permite una ejecución manual desde GitHub.
- Los mensajes que no alcanzan el umbral configurado quedan disponibles para revisión.
- Cambiar el modelo de Gemini no requiere modificar el código si se configura mediante `AI_MODEL`.

La guía de despliegue del sistema completo está en [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).
