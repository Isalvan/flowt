# Despliegue

Esta guía describe el despliegue del frontend en Firebase Hosting y la ejecución programada del sincronizador mediante GitHub Actions.

## Despliegue automático desde GitHub

Una vez configurado el acceso que se describe abajo:

- Al abrir o actualizar una PR interna hacia `main`, **Firebase Hosting PR** instala dependencias, ejecuta lint, prueba los helpers de despliegue, ejecuta los tests de la web y las reglas con el emulador de Firestore, y compila. Si todo pasa, publica una preview que caduca a los siete días y deja su enlace en la PR. Las PR de forks se omiten y no reciben credenciales.
- Al fusionar una PR o hacer un push a `main`, **Firebase Hosting production** repite esas comprobaciones y publica `dist/` en el canal `live`. También puede ejecutarse desde **Actions → Firebase Hosting production → Run workflow**, seleccionando `main`.
- Si falla la instalación, configuración, lint, tests o compilación, no se inicia la publicación. Las publicaciones de producción se serializan y no se cancelan a mitad de ejecución.
- Solo se despliega **Firebase Hosting**. Las reglas e índices de Firestore siguen siendo manuales; si un cambio los necesita, publícalos antes de la web. El workflow no ejecuta el sincronizador ni modifica Firebase Auth.

El proyecto por defecto de `.firebaserc` es `flowt-63536`. El helper comprueba que la configuración web y la cuenta de despliegue pertenezcan a ese proyecto. Para otro proyecto, cambia el alias y la URL del environment `production` del workflow, además de las variables y credenciales.

### Configuración inicial, una sola vez

1. En **GitHub → Settings → Secrets and variables → Actions → Variables**, crea estas seis **Repository Variables** con los valores reales del SDK web de **Firebase → Configuración del proyecto → Tus aplicaciones**:

   | Variable | Campo del SDK |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | `apiKey` |
   | `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
   | `VITE_FIREBASE_PROJECT_ID` | `projectId` (`flowt-63536`) |
   | `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
   | `VITE_FIREBASE_APP_ID` | `appId` |

   Son parámetros del cliente web y quedan incluidos en el JavaScript publicado. La protección de los datos depende de Authentication y de las reglas de Firestore. Las variables se pasan a la compilación; Actions no genera un `.env.production.local`.

2. En **Google Cloud → IAM y administración → Cuentas de servicio**, dentro de `flowt-63536`, crea una cuenta dedicada a Hosting, por ejemplo `flowt-hosting-deploy`. Asígnale estos roles del proyecto:

   - **Firebase Hosting Admin** (`roles/firebasehosting.admin`), para publicar versiones y canales de Hosting.
   - **Service Usage Consumer** (`roles/serviceusage.serviceUsageConsumer`), para las llamadas de Firebase CLI.
   - **API Keys Viewer** (`roles/serviceusage.apiKeysViewer`), para las consultas de configuración que usa Firebase CLI.

   Genera una clave JSON de esa cuenta. En **GitHub → Settings → Secrets and variables → Actions → Secrets**, crea **`FIREBASE_SERVICE_ACCOUNT_FLOWT_63536`** pegando el JSON completo, **sin codificar en base64**. El archivo no se añade al repositorio. Esta cuenta no necesita permisos de escritura sobre Firestore o Auth ni acceso a Gmail; no se reutiliza la cuenta del tracker.

3. Vuelve a ejecutar el workflow que hubiera fallado por falta de configuración. Puedes publicar el `main` actual con **Run workflow**; no hace falta otro commit. Si el environment `production` tiene una aprobación obligatoria configurada en GitHub, la publicación esperará esa aprobación.

### Previews y comprobación de la publicación

La URL de preview aparece en un comentario de la PR y en el resumen de la ejecución. Producción se publica en [Flowt](https://flowt-63536.web.app); el historial de versiones está en **Firebase → Hosting**.

Las previews usan la configuración del proyecto de producción. Usa el modo demo para probar con datos ficticios: iniciar sesión en una preview da acceso a tus datos reales. El despliegue de preview utiliza `--no-authorized-domains` para no cambiar Firebase Auth. Si necesitas probar Google login desde una preview, autoriza su dominio manualmente desde Firebase Authentication.

Ante un workflow fallido, abre el paso marcado en rojo. Los helpers indican los nombres de las variables o del secret que faltan, y rechazan configuraciones de proyectos distintos. Una cuenta sin los permisos de Hosting necesarios hará fallar la publicación. Tras corregir la configuración, usa **Re-run failed jobs**. No subas las credenciales a una issue o PR.

Firebase CLI se usa desde las dependencias de `package-lock.json`, con la misma versión comprobada por los tests. La credencial temporal se crea con permisos `600` y se elimina al terminar, incluso si Firebase falla. Las previews se publican con Firebase CLI en lugar de `action-hosting-deploy`, para poder desactivar explícitamente los cambios de dominios de Auth.

### Deuda de lint existente

`eslint-suppressions.json` registra los 88 errores previos del frontend actual. `npm run lint` los reconoce y sigue fallando ante errores que superen esa base o aparezcan en archivos/reglas sin excepciones. No exige todavía resolver toda la deuda para publicar; siguen visibles ocho avisos anteriores. El prototipo antiguo `tracker-frontend/`, que no forma parte de la aplicación Vite actual, queda fuera del lint.

Al corregir esa deuda, ejecuta `npx eslint . --prune-suppressions` y versiona la reducción del archivo. No regeneres las excepciones con `--suppress-all` para ocultar errores nuevos. La CI detecta excepciones sobrantes. Esto no sustituye la revisión de código: el presupuesto de excepciones se cuenta por archivo y regla.

## Despliegue manual

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

El repositorio contiene `firebase.json`, reglas e índices de Firestore. El alias por defecto apunta a `flowt-63536`; selecciona el proyecto de destino correcto antes de publicar.

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
