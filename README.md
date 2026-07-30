# Flowt

Flowt es una aplicación de finanzas personales que transforma notificaciones bancarias recibidas por Gmail en movimientos estructurados, los organiza en Firestore y los presenta en un panel web.

## Características

- Sincronización automática de notificaciones bancarias desde Gmail.
- Extracción estructurada de movimientos mediante Gemini.
- Revisión manual de movimientos que requieren confirmación.
- Carteras, objetivos, suscripciones y reglas de reparto de ingresos.
- Dashboard, calendario, histórico y exportación de datos.
- Autenticación con Firebase y aislamiento de datos por usuario.
- Aplicación web instalable y modo de demostración local.
- Tema claro y oscuro, privacidad visual y diseño adaptable.

## Arquitectura

Flowt se divide en dos aplicaciones:

- `src/`: frontend React, TypeScript y Vite.
- `tracker-backend/`: sincronizador Python para Gmail, Gemini y Firestore.

```text
Gmail → sincronizador Python → Gemini → Firestore → aplicación web
```

La descripción de componentes, flujos de datos y límites de responsabilidad está en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requisitos

### Frontend

- Node.js y npm.
- Un proyecto de Firebase con Authentication y Firestore.

### Sincronizador

- Python 3.10 o posterior.
- Gmail API y un cliente OAuth de escritorio.
- Una cuenta de servicio de Firebase.
- Una clave de API de Gemini.

## Desarrollo local

### Frontend

```bash
npm install
npm run dev
```

Crea un archivo `.env` en la raíz con la configuración web de Firebase:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

### Sincronizador

La instalación, las credenciales OAuth y las variables de entorno se documentan en [tracker-backend/README.md](tracker-backend/README.md).

```bash
cd tracker-backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
python main.py
```

En Windows puede utilizarse `tracker-backend/start.bat`.

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Inicia Vite en modo desarrollo |
| `npm run build` | Comprueba TypeScript y genera la aplicación |
| `npm run lint` | Ejecuta ESLint |
| `npm test` | Ejecuta las pruebas con Vitest |
| `npm run preview` | Sirve localmente la compilación |

Pruebas del backend:

```bash
python -m pytest tracker-backend
```

## Despliegue

La aplicación web se despliega en Firebase Hosting y el sincronizador puede ejecutarse localmente o mediante GitHub Actions.

Consulta [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) para la configuración completa de Firebase, secretos, compilación y automatización.

## Seguridad y privacidad

Flowt procesa correos y datos financieros. Las credenciales locales se mantienen fuera de Git y los secretos de automatización se almacenan en GitHub Actions Secrets.

El PIN de privacidad oculta información en la interfaz; no sustituye la autenticación ni los controles de acceso.

Para informar de una vulnerabilidad, consulta [SECURITY.md](SECURITY.md). No publiques tokens, correos ni datos financieros en issues.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Despliegue](docs/DEPLOYMENT.md)
- [Backend](tracker-backend/README.md)
- [Contribución](CONTRIBUTING.md)
- [Soporte](SUPPORT.md)
- [Política de seguridad](SECURITY.md)
- [Código de conducta](CODE_OF_CONDUCT.md)

## Contribuir

Las contribuciones son bienvenidas. Lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir un issue o pull request.

## Licencia

Flowt se distribuye bajo la [licencia MIT](LICENSE). Copyright (c) 2026 Isalvan.
