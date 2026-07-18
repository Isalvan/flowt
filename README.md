# Flowt

Gestor personal de finanzas que convierte notificaciones bancarias recibidas por Gmail en movimientos estructurados, los almacena en Firestore y los presenta en una aplicación web.

> [!WARNING]
> Flowt está en desarrollo. La auditoría de seguridad mantiene hallazgos abiertos que deben resolverse antes de usarlo con terceros o tratarlo como un servicio público. Consulta los [issues abiertos](https://github.com/Isalvan/flowt/issues).

## Qué incluye

- Frontend React, TypeScript y Vite con autenticación de Firebase.
- Sincronizador Python con acceso de solo lectura a Gmail.
- Extracción asistida por Gemini y revisión manual de movimientos ambiguos.
- Reglas de reparto de ingresos entre carteras y objetivos.
- Dashboard, calendario, suscripciones y exportación.
- Modo de demostración local cuando Firebase no está configurado.

El PIN de la interfaz únicamente oculta información en pantalla. No sustituye la autenticación, el control de acceso de Firebase ni la seguridad del dispositivo.

## Arquitectura

```text
.
├── src/                         # Aplicación web
├── tracker-backend/             # Sincronizador Gmail → Gemini → Firestore
├── .github/workflows/           # Automatización programada
├── firestore.rules              # Reglas de acceso a Firestore
├── firestore.indexes.json
└── firebase.json                # Hosting y configuración de Firebase
```

Flujo principal:

```text
Gmail → sincronizador Python → Gemini → Firestore → aplicación web
```

Los mensajes procesados pueden contener información financiera y se envían al proveedor de IA configurado. Revisa sus condiciones, la región de procesamiento y la política de retención antes de usar datos reales.

## Requisitos

- Node.js compatible con las dependencias declaradas en `package.json`.
- npm.
- Para el sincronizador: Python 3.10 o posterior.
- Un proyecto de Firebase.
- Una aplicación OAuth de Google con Gmail API.
- Una clave de API de Gemini.

## Frontend

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Crea un archivo `.env` en la raíz:

   ```dotenv
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

3. Inicia el entorno local:

   ```bash
   npm run dev
   ```

La configuración web de Firebase identifica el proyecto, pero no concede acceso administrativo. La protección de los datos depende de Firebase Authentication, las reglas de Firestore y la configuración del proyecto.

## Backend

La configuración de Gmail, Firebase Admin, Gemini y GitHub Actions está en [tracker-backend/README.md](tracker-backend/README.md).

Los siguientes archivos son credenciales o configuración local y no deben añadirse a Git:

- `.env`
- `credentials.json`
- `token.json`
- `serviceAccountKey.json`

El `.gitignore` los excluye, pero esa exclusión no reemplaza una revisión del historial antes de publicar el repositorio.

## Comprobaciones locales

```bash
npm run lint
npm test
npm run build
```

Para el backend:

```bash
python -m pip install -r tracker-backend/requirements.txt
python -m pytest tracker-backend
```

## Seguridad y publicación

- Lee [SECURITY.md](SECURITY.md) antes de informar de una vulnerabilidad.
- Sigue el [checklist de publicación](docs/PUBLIC_RELEASE_CHECKLIST.md) antes de cambiar la visibilidad del repositorio.
- Mantén todas las credenciales en el almacén de secretos del entorno de ejecución.
- Si una credencial aparece en un commit, log, artefacto, issue o pull request, revócala y reemplázala; borrarla del último commit no basta.
- No consideres el repositorio listo para producción mientras sigan abiertos los bloqueos de seguridad de la auditoría.

## Licencia

Este repositorio no declara actualmente una licencia. Hasta que se añada una, se mantienen los derechos de autor aplicables y no se conceden permisos de reutilización.
