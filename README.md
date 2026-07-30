# Flowt

Flowt es una aplicación de finanzas personales que transforma notificaciones bancarias recibidas por Gmail en movimientos estructurados, los organiza en Firestore y los presenta en un panel web moderno y responsivo.

## Características Principal

- **Sincronización Automática Multibanco**: Consulta notificaciones desde Gmail para múltiples entidades (Unicaja, Revolut, BBVA, Santander, CaixaBank, ING, Sabadell, N26) utilizando el alcance `gmail.modify`.
- **Extracción Inteligente de Movimientos**: Redacción previa de PII y procesamiento con Gemini 1.5 Flash.
- **Dashboard de Salud Financiera**: Calificación continua de salud financiera (Score 0-100) evaluando el ratio de ahorro, la estabilidad de las carteras, el flujo de caja y la presión de suscripciones.
- **Filtrado Avanzado por Entidad**: Visualización y filtrado interactivo de movimientos según el banco de origen.
- **Revisión Manual Idempotente**: Cola de correos ambiguos con aprobación/descarte seguro en una única transacción.
- **Carteras, Objetivos y Suscripciones**: Reglas de reparto automático y gestión de suscripciones compartidas.
- **Exportación Segura**: Exportación a CSV sanitizada contra inyección de fórmulas (`CSV Formula Injection`).
- **Seguridad y Privacidad Avanzada**: Reglas estrictas en Firestore, retención TTL de 90 días para datos de correo y cabeceras de seguridad HTTP (CSP, HSTS).

## Arquitectura

Flowt se divide en dos aplicaciones:

- `src/`: frontend React, TypeScript y Vite.
- `tracker-backend/`: sincronizador Python para Gmail, Gemini y Firestore.

```text
Gmail → Sincronizador Python → Gemini AI → Firestore → Aplicación Web
```

La descripción de componentes, flujos de datos y límites de responsabilidad está en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requisitos

### Frontend

- Node.js y npm.
- Un proyecto de Firebase con Authentication y Firestore.

### Sincronizador Backend

- Python 3.10 o posterior.
- Gmail API y cliente OAuth de escritorio con alcance `gmail.modify`.
- Cuenta de servicio de Firebase (`serviceAccountKey.json`).
- Clave de API de Gemini (`GEMINI_API_KEY`).

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
VITE_FIREBASE_PROJECT_ID=flowt-63536
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

### Sincronizador Backend

La instalación y las variables de entorno se documentan en [tracker-backend/README.md](tracker-backend/README.md).

```bash
cd tracker-backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
python main.py
```

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

La aplicación web se despliega en Firebase Hosting y el sincronizador se ejecuta mediante GitHub Actions o Google Cloud Functions.

Consulta [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) para la configuración completa de Firebase y secretos.

## Licencia

Flowt se distribuye bajo la [licencia MIT](LICENSE). Copyright (c) 2026 Isalvan.
