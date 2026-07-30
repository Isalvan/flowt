# Flowt Backend

Servicio de sincronización de Flowt. Consulta notificaciones bancarias en Gmail, extrae movimientos mediante Gemini AI y guarda el resultado en Firestore.

## Responsabilidades

- Autenticar el acceso a Gmail con el alcance `gmail.modify` (necesario para consultar y marcar notificaciones procesadas como leídas).
- Buscar mensajes de los remitentes bancarios configurados (soporte multi-banco).
- Normalizar y desinfectar el contenido de los mensajes (redacción de PII antes de enviar a IA).
- Extraer y validar movimientos financieros con Gemini 1.5 Flash.
- Enviar casos ambiguos o de baja confianza a la cola de revisión manual.
- Persistir movimientos, banco emisor e información de procesamiento en Firestore con política de retención TTL de 90 días.
- Evitar el reprocesamiento de mensajes mediante transacciones e identificadores idempotentes.

## Requisitos

- Python 3.10 o posterior.
- Proyecto de Firebase con Firestore.
- Cuenta de servicio de Firebase (`serviceAccountKey.json`).
- Proyecto de Google Cloud con Gmail API habilitada.
- Cliente OAuth de escritorio con el alcance `gmail.modify`.
- Clave de API de Google Gemini AI (`GEMINI_API_KEY`).

## Instalación y Configuración Local

Para que el servicio funcione bajo tu propia cuenta de Gmail o Firebase, debes configurar las credenciales y las variables de entorno.

### Paso 1: Configurar la Base de Datos (Firebase)
1. Ve a la [Consola de Firebase](https://console.firebase.google.com/).
2. Entra en tu proyecto de Flowt (`flowt-63536`).
3. Ve a **Configuración del Proyecto** ➔ **Cuentas de servicio**.
4. Haz clic en **Generar nueva clave privada**.
5. Cámbiale el nombre a `serviceAccountKey.json` y guárdalo dentro de la carpeta `tracker-backend/`.

---

### Paso 2: Configurar el Acceso a Gmail (Google Cloud)
El script requiere acceso para consultar correos bancarios y marcarlos como leídos una vez procesados (`gmail.modify`).
1. Ve a la [Consola de Google Cloud](https://console.cloud.google.com/).
2. En la barra de búsqueda superior, busca **Gmail API** y haz clic en **Habilitar**.
3. Ve a **API y servicios** ➔ **Pantalla de consentimiento de OAuth**.
   - Selecciona el tipo de usuario **Externo**.
   - Añade el alcance `https://www.googleapis.com/auth/gmail.modify`.
   - En **Usuarios de prueba**, añade tu propio correo de Gmail.
4. En la pestaña **Credenciales**, crea un **ID de cliente de OAuth** para **Aplicación de escritorio**.
5. Descarga el JSON, cámbiale el nombre a `credentials.json` y colócalo dentro de `tracker-backend/`.

---

### Paso 3: Conseguir la Clave de Google Gemini (IA)
1. Ve a [Google AI Studio](https://aistudio.google.com/).
2. Haz clic en **Get API key** y copia tu clave.

---

### Paso 4: Rellenar la Configuración Local (`.env`)
En `tracker-backend/`, crea una copia de `.env.example` y renómbrala a **`.env`**:

```env
# Remitentes bancarios configurados (puede ser un único correo, varios separados por comas, o una lista JSON)
BANK_SENDER=alertas@unicaja.es, info@revolut.com

# Tu UID de usuario en Firebase Auth
UID_PROPIETARIO=tu_uid_de_firebase

# Número máximo de correos sin leer a procesar por tanda
MAX_EMAILS_PER_RUN=10

# Umbral mínimo de confianza (alta, media, baja)
MIN_CONFIDENCE=alta

# Modelo de Gemini
AI_MODEL=gemini-1.5-flash

# Clave de API de Gemini
GEMINI_API_KEY=tu_api_key_de_gemini

# Token secreto para validar llamadas al Webhook en despliegues en la nube (ej. Cloud Functions)
WEBHOOK_TOKEN=generar_un_token_largo_y_seguro
```

Instala las dependencias y entorno virtual:

```bash
cd tracker-backend
python -m venv .venv

# Linux y macOS
source .venv/bin/activate

# Windows PowerShell
.venv\Scripts\Activate.ps1

python -m pip install -r requirements.txt
```

---

## Ejecución y Pruebas

Para ejecutar la sincronización manualmente:
```bash
python main.py
```

Para ejecutar la batería de pruebas en Python (Pytest):
```bash
python -m pytest
```

---

## Opción de Despliegue con Webhook (Google Cloud Functions / Run)

Si utilizas el entrypoint `gmail_webhook` incluido para invocaciones HTTP:
1. Solo admite peticiones **POST**.
2. Requiere configurar `WEBHOOK_TOKEN` en variables de entorno.
3. El token debe enviarse por la cabecera `Authorization: Bearer TU_TOKEN`.

---

## Automatización con GitHub Actions

El workflow [`.github/workflows/run_tracker.yml`](../.github/workflows/run_tracker.yml) ejecuta la sincronización de forma programada mediante cron.

Configura estos secretos en **Settings → Secrets and variables → Actions**:

| Secreto | Contenido |
|---|---|
| `BANK_SENDER` | Remitente(s) bancario(s) |
| `UID_PROPIETARIO` | UID de Firebase |
| `GEMINI_API_KEY` | Clave de Gemini |
| `AI_MODEL` | Modelo configurado |
| `GMAIL_CREDENTIALS_BASE64` | `credentials.json` en base64 |
| `GMAIL_TOKEN_BASE64` | `token.json` en base64 |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | `serviceAccountKey.json` en base64 |

Codificación en Base64:
```bash
# Linux
base64 -w 0 credentials.json
base64 -w 0 token.json
base64 -w 0 serviceAccountKey.json

# macOS
base64 < credentials.json | tr -d '\n'
```

---

## Archivos locales excluidos de Git

- `.env`
- `credentials.json`
- `token.json`
- `serviceAccountKey.json`
- `.venv/`
