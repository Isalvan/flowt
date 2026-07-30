# Despliegue

Esta guía describe el despliegue del frontend en Firebase Hosting y la ejecución programada del sincronizador mediante GitHub Actions.

## 1. Firebase

Crea un proyecto en [Firebase Console](https://console.firebase.google.com/) y habilita:

- Authentication;
- proveedor de acceso de Google;
- Cloud Firestore;
- Firebase Hosting.

Añade los dominios desde los que se servirá Flowt a los dominios autorizados de Authentication.

Instala Firebase CLI e inicia sesión:

```bash
npm install --global firebase-tools
firebase login
firebase use --add
```

El repositorio contiene `firebase.json`, reglas e índices de Firestore. Asocia el alias seleccionado al proyecto de destino.

## 2. Configuración del frontend

Crea `.env.production.local` en la raíz:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Obtén estos valores desde **Configuración del proyecto → Tus aplicaciones → SDK de Firebase**.

Compila la aplicación:

```bash
npm ci
npm run build
```

Vite genera el contenido estático en `dist/`, que es el directorio configurado para Hosting.

## 3. Reglas e índices

Despliega primero las reglas e índices:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Despliega el frontend:

```bash
firebase deploy --only hosting
```

Para publicar ambos componentes en una sola operación:

```bash
firebase deploy --only hosting,firestore
```

Firebase mostrará la URL del sitio al finalizar.

## 4. Google Cloud y Gmail

En el proyecto que ejecutará el sincronizador:

1. habilita Gmail API;
2. configura la pantalla de consentimiento OAuth;
3. añade el alcance `gmail.readonly`;
4. crea un cliente OAuth de escritorio;
5. descarga el cliente como `credentials.json`.

Ejecuta el backend una vez en local para completar el consentimiento y generar `token.json`:

```bash
cd tracker-backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
python main.py
```

## 5. Firebase Admin y Gemini

Descarga una clave de una cuenta de servicio dedicada como `serviceAccountKey.json`. Configura su IAM con los permisos necesarios para las operaciones de Flowt.

Crea una clave de Gemini en Google AI Studio y selecciona el modelo mediante `AI_MODEL`.

## 6. Secretos de GitHub Actions

El workflow `.github/workflows/run_tracker.yml` espera:

| Secreto | Valor |
|---|---|
| `BANK_SENDER` | Dirección que envía las notificaciones |
| `UID_PROPIETARIO` | UID de Firebase |
| `GEMINI_API_KEY` | Clave de Gemini |
| `AI_MODEL` | Identificador del modelo |
| `GMAIL_CREDENTIALS_BASE64` | Cliente OAuth codificado |
| `GMAIL_TOKEN_BASE64` | Token OAuth codificado |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | Cuenta de servicio codificada |

Genera los tres valores base64 en Linux:

```bash
base64 -w 0 credentials.json
base64 -w 0 token.json
base64 -w 0 serviceAccountKey.json
```

En macOS:

```bash
base64 < credentials.json | tr -d '\n'
base64 < token.json | tr -d '\n'
base64 < serviceAccountKey.json | tr -d '\n'
```

Añade cada salida en **Settings → Secrets and variables → Actions**.

## 7. Activación del sincronizador

Abre **Actions → Run Flowt Tracker** y ejecuta `workflow_dispatch`. El mismo workflow se ejecuta automáticamente cada 30 minutos.

Los archivos de credenciales se reconstruyen dentro del runner y desaparecen al finalizar el job.

## 8. Actualizaciones

Frontend:

```bash
git pull
npm ci
npm run build
firebase deploy --only hosting
```

Reglas o índices:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

El sincronizador utiliza el código de la rama que descarga el workflow. Los cambios en secretos se aplican en la siguiente ejecución.
