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

Para que el script funcione bajo tu propia cuenta o la de otra persona, se deben configurar **3 llaves de acceso** y **1 archivo de configuración**.

### Paso 1: Configurar la Base de Datos (Firebase)
El script necesita permisos para escribir movimientos en tu base de datos de Firestore.
1. Ve a la [Consola de Firebase](https://console.firebase.google.com/).
2. Entra en tu proyecto de Flowt.
3. Ve a **Configuración del Proyecto** (icono de engranaje en el menú lateral izquierdo) ➔ pestaña **Cuentas de servicio**.
4. Haz clic en el botón **Generar nueva clave privada**.
5. Se descargará un archivo `.json`. Cámbiale el nombre a exactamente `serviceAccountKey.json` y guárdalo dentro de la carpeta `tracker-backend/`.

---

### Paso 2: Configurar el Acceso a Gmail (Google Cloud)
El script necesita permiso para buscar los correos electrónicos que te envía tu banco.
1. Ve a la [Consola de Google Cloud](https://console.cloud.google.com/).
2. Crea un nuevo proyecto (puedes llamarlo `Flowt-Gmail`).
3. En la barra de búsqueda superior, busca **Gmail API** y haz clic en **Habilitar**.
4. Ve al menú lateral izquierdo ➔ **API y servicios** ➔ **Pantalla de consentimiento de OAuth**.
   * Selecciona el tipo de usuario **Externo** y haz clic en Crear.
   * Rellena los datos básicos obligatorios (Nombre de la app: *Flowt*, tu correo de soporte y correo de contacto). Pulsa guardar.
   * En la sección de **Scopes (Permisos)**, haz clic en *Agregar o quitar permisos*, busca y selecciona `gmail.readonly` (lectura de correos) y agrégalo.
   * En **Usuarios de prueba**, añade tu propio correo electrónico de Gmail (donde recibes las alertas del banco) para poder autenticarte mientras la aplicación esté en desarrollo.
5. Ve a la pestaña **Credenciales** (en el menú izquierdo).
   * Haz clic en **Crear credenciales** ➔ **ID de cliente de OAuth**.
   * En *Tipo de aplicación*, selecciona **Aplicación de escritorio**.
   * Dale un nombre (ej. *Flowt Script*) y haz clic en Crear.
6. Se abrirá una ventana emergente. Haz clic en **Descargar JSON**. Cámbiale el nombre al archivo descargado a exactamente `credentials.json` y colócalo dentro de la carpeta `tracker-backend/`.

---

### Paso 3: Conseguir la Clave de Google Gemini (IA)
Gemini se encarga de leer el contenido en texto o HTML de tus correos bancarios y convertirlos en un registro limpio estructurado.
1. Ve a [Google AI Studio](https://aistudio.google.com/).
2. Inicia sesión con tu cuenta de Google y haz clic en **Get API key** (Obtener clave de API).
3. Haz clic en **Create API key** y selecciona tu proyecto de Google Cloud (o crea uno nuevo rápido).
4. Copia la clave alfanumérica generada (empieza por `AIzaSy...`). La utilizaremos en el siguiente paso.

---

### Paso 4: Rellenar la Configuración Local (`.env`)
1. En esta carpeta (`tracker-backend/`), crea una copia del archivo llamado `.env.example` y renómbralo a **`.env`**.
2. Ábrelo con un editor de notas y rellena los campos:

```env
# El correo exacto desde el cual tu banco envía las alertas (ej: alertas@ing.es, avisos@bbva.com, etc.)
BANK_SENDER=alertas@tu-banco.com

# Tu UID único de usuario (se obtiene al iniciar sesión en el frontend de Flowt, dentro de Firebase Auth)
UID_PROPIETARIO=pega_aqui_tu_uid_de_firebase

# Número máximo de correos sin leer a procesar en cada tanda
MAX_EMAILS_PER_RUN=10

# Nivel de seguridad mínimo que exigimos a la IA para auto-procesar el correo sin mandarlo a revisión
MIN_CONFIDENCE=alta

# Modelo de IA a utilizar (recomendado dejar el de defecto para velocidad y coste gratuito)
AI_MODEL=gemini-3-flash-preview

# La clave de API que copiaste de Google AI Studio en el Paso 3
GEMINI_API_KEY=pega_aquí_tu_api_key_de_gemini

# Token secreto para validar llamadas al Webhook en despliegues en la nube (ej. Cloud Functions). ¡Debe ser complejo y seguro!
WEBHOOK_TOKEN=generar_un_token_largo_y_seguro
```

```bash
cd tracker-backend
python -m venv .venv
```
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

<<<<<<< HEAD
---

### Opción C: Despliegue con Webhook (Google Cloud Functions / Run)
Si decides usar el entrypoint `gmail_webhook` incluido, ten en cuenta las siguientes medidas de seguridad obligatorias implementadas:
1. Solo se admiten peticiones **POST**.
2. Debes configurar la variable `WEBHOOK_TOKEN`. Sin ella el servicio fallará por seguridad.
3. El token debe enviarse por la cabecera `Authorization: Bearer TU_TOKEN`. (No se admite `?token=`).
4. **Límites recomendados**: En la consola de Google Cloud, configura tu función con concurrencia limitada (ej. max 1), timeout (ej. 60s) e idealmente IAM para restringir quién puede invocarla.

=======
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
>>>>>>> main
