# 🚀 Flowt Backend - Extractor Automático de Movimientos Bancarios

Este es el script de automatización en Python que se encarga de leer las notificaciones de tu banco desde Gmail, extraer la información de tus gastos e ingresos utilizando la Inteligencia Artificial de Google Gemini, y registrar los datos en tiempo real en tu base de datos de Firestore.

---

## 📋 Requisitos Previos

Antes de configurar el script, asegúrate de tener instalado en tu ordenador:
1. **Python 3.10 o superior** (al instalar en Windows, asegúrate de marcar la casilla *"Add Python to PATH"*).
2. Una cuenta de **Google Gmail** donde recibas las notificaciones del banco.
3. Un proyecto creado en **Google Firebase**.

---

## 🛠️ Guía de Configuración Paso a Paso

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
```

---

## 🏃‍♂️ Cómo arrancar el Script por primera vez

Una vez que tengas los siguientes **3 archivos** en tu carpeta `tracker-backend/`:
1. `serviceAccountKey.json` ➔ (Firebase)
2. `credentials.json` ➔ (Google Cloud)
3. `.env` ➔ (Configuración personal con tus claves)

Simplemente haz doble clic en el archivo **`start.bat`** (en Windows) o ejecuta en tu terminal:
```bash
python main.py
```

### 🔴 ¿Qué ocurrirá en la primera ejecución?
1. El script creará automáticamente una carpeta `.venv/` de Python e instalará todas las librerías necesarias de forma totalmente aislada.
2. Se pausará y **abrirá una pestaña en tu navegador web de forma automática**.
3. Te pedirá iniciar sesión con tu cuenta de Gmail.
4. Verás una pantalla de advertencia ("Google no ha verificado esta aplicación") debido a que es una app privada en desarrollo. Haz clic en **Configuración avanzada** (o *Advanced*) ➔ **Ir a Flowt (inseguro)**.
5. Concede los permisos y haz clic en Permitir.
6. El navegador mostrará el mensaje *"The authentication flow has completed..."*. Ya puedes cerrar la pestaña.
7. El script creará un archivo llamado `token.json` en la carpeta. **A partir de este momento, nunca más te volverá a pedir iniciar sesión en el navegador.** Las futuras ejecuciones serán 100% silenciosas y automáticas.

---

## 🔒 Seguridad e Idempotencia

* **Principio de seguridad**: El script nunca almacena tus contraseñas del banco ni datos personales sensibles fuera de tu base de datos privada de Firebase.
* **Idempotencia (Sin duplicados)**: Cada movimiento bancario se registra en Firestore con un ID generado mediante un hash SHA-256 de su identificador de correo único en Gmail. Si ejecutas el script 10 veces seguidas, los registros nunca se duplicarán en tu dashboard financiero.
* **Aislamiento**: Recuerda **nunca subir al repositorio de Git ni compartir con nadie** los archivos `.env`, `credentials.json`, `token.json` ni `serviceAccountKey.json`.

---

## 📅 Sincronización Automática

Para no tener que ejecutar el script a mano, tienes dos opciones: ejecutarlo localmente en tu ordenador o desplegarlo de forma gratuita en la nube con **GitHub Actions**.

### Opción A: Programación Local (Tu ordenador)
* **Windows**: Abre el *"Programador de Tareas"*, crea una tarea básica que apunte a ejecutar el archivo `start.bat` todos los días a la hora que prefieras (por ejemplo, al iniciar sesión).
* **Mac/Linux**: Configura un `cron job` de sistema que apunte a ejecutar el script `main.py` utilizando el Python de la carpeta `.venv/`.

---

### Opción B: Ejecución en la Nube con GitHub Actions (Servidor 24/7 Gratis) 🤖
Puedes subir el backend a un repositorio **privado** de GitHub y programar un flujo automatizado para que se ejecute solo (por ejemplo, cada hora) sin consumir recursos de tu ordenador.

> [!CAUTION]
> **SEGURIDAD CRÍTICA**: El repositorio de GitHub **DEBE ser 100% privado**. Si compartes o publicas este repositorio con tus secretos, cualquiera podría acceder a tu base de datos de Firebase o a la lectura de tu correo Gmail.

#### Paso 1: Generar el token inicial en local
Debes iniciar el script en tu ordenador al menos una vez siguiendo la sección *"Cómo arrancar el Script por primera vez"*. Esto generará el archivo `token.json` en tu carpeta local. **Este archivo es obligatorio** para que el servidor de GitHub pueda saltarse el inicio de sesión del navegador.

#### Paso 2: Crear los Secretos de GitHub
Ve a tu repositorio privado en GitHub ➔ pestaña **Settings** ➔ menú izquierdo **Secrets and variables** ➔ **Actions** ➔ botón **New repository secret**.

Crea los siguientes secretos introduciendo los valores correspondientes:

1. `BANK_SENDER`: El correo remitente del banco (ej. `alertas@tu-banco.com`).
2. `UID_PROPIETARIO`: Tu UID único de usuario de Firebase.
3. `GEMINI_API_KEY`: Tu clave de Google Gemini API.
4. `FIREBASE_KEY_JSON`: Abre tu archivo `serviceAccountKey.json` con el bloc de notas, copia todo su texto y pégalo aquí.
5. `GMAIL_CREDENTIALS_JSON`: Abre tu archivo `credentials.json`, copia todo su texto y pégalo aquí.
6. `GMAIL_TOKEN_JSON`: Abre tu archivo `token.json` recién generado en local, copia todo su texto y pégalo aquí.

#### Paso 3: Crear el archivo Workflow
En la raíz de tu repositorio de GitHub, crea la estructura de carpetas `.github/workflows/` y dentro crea un archivo llamado `flowt-sync.yml` con el siguiente contenido:

```yaml
name: Sincronizador Financiero Flowt

on:
  schedule:
    - cron: '0 * * * *' # Se ejecuta automáticamente cada hora
  workflow_dispatch: # Permite pulsar un botón en GitHub para forzar la ejecución manual

jobs:
  run-tracker:
    runs-on: ubuntu-latest

    steps:
    - name: Descargar Código
      uses: actions/checkout@v4

    - name: Configurar Python
      uses: actions/setup-python@v5
      with:
        python-version: '3.11'
        cache: 'pip'

    - name: Instalar Dependencias
      run: |
        pip install -r requirements.txt

    - name: Reconstruir Archivos de Configuración y Claves
      run: |
        # Generar archivo .env temporal
        echo "BANK_SENDER=${{ secrets.BANK_SENDER }}" >> .env
        echo "UID_PROPIETARIO=${{ secrets.UID_PROPIETARIO }}" >> .env
        echo "GEMINI_API_KEY=${{ secrets.GEMINI_API_KEY }}" >> .env
        echo "MAX_EMAILS_PER_RUN=15" >> .env
        echo "MIN_CONFIDENCE=alta" >> .env
        echo "AI_MODEL=gemini-3-flash-preview" >> .env
        
        # Reconstruir las llaves de seguridad JSON
        echo '${{ secrets.FIREBASE_KEY_JSON }}' > serviceAccountKey.json
        echo '${{ secrets.GMAIL_CREDENTIALS_JSON }}' > credentials.json
        echo '${{ secrets.GMAIL_TOKEN_JSON }}' > token.json

    - name: Ejecutar Extractor
      run: |
        python main.py
```

Una vez guardado y subido a la rama principal de GitHub, tu extractor financiero de Flowt estará funcionando de forma totalmente autónoma en la nube cada hora.

