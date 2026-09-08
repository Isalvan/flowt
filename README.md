# Flowt

[English](README.md) · [Español](README.es.md)

Flowt is a personal finance application that turns bank notifications received through Gmail into structured transactions, stores them in Firestore, and presents them in a modern, responsive dashboard.

## Features

- **Automatic multi-bank synchronization** for Unicaja, Revolut, BBVA, Santander, CaixaBank, ING, Sabadell, and N26 using the `gmail.modify` scope.
- **Intelligent transaction extraction** with PII redaction before Gemini processing.
- **Financial health dashboard** scoring savings, portfolios, cash flow, and subscriptions from 0 to 100.
- **Bank filtering**, idempotent manual review, pockets, goals, and shared subscriptions.
- **Safe CSV export** protected against formula injection.
- **Security and privacy controls** with strict Firestore rules, 90-day email-data TTL retention, CSP, and HSTS.

## Architecture

Flowt consists of a React frontend in `src/` and a Python synchronizer in `tracker-backend/`:

```text
Gmail → Python synchronizer → Gemini AI → Firestore → Web application
```

See the [architecture guide](docs/ARCHITECTURE.md) for component boundaries and data flows.

## Demo

![Flowt demo](media/flowt-demo.gif)

## Requirements

- Node.js and npm.
- Python 3.10 or later.
- A Firebase project with Authentication and Firestore.
- Gmail API desktop OAuth credentials with the `gmail.modify` scope.
- A Firebase service account (`serviceAccountKey.json`) and Gemini API key (`GEMINI_API_KEY`).

## Local development

```bash
npm install
npm run dev
```

Create a `.env` file in the repository root with the Firebase web configuration:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=flowt-63536
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

For the synchronizer, see the [backend guide](tracker-backend/README.md):

```bash
cd tracker-backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
python main.py
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite in development mode |
| `npm run build` | Type-check and build the application |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest tests |
| `npm run preview` | Serve the production build locally |

Run backend tests with `python -m pytest tracker-backend`.

## Deployment

The web application is deployed to Firebase Hosting and the synchronizer runs through GitHub Actions or Google Cloud Functions. See the [deployment guide](docs/DEPLOYMENT.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Backend](tracker-backend/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Español](README.es.md)

## License

Flowt is distributed under the [MIT License](LICENSE). Copyright (c) 2026 Isalvan.
