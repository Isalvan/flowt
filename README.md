# Flowt

[English](README.md) · [Español](README.es.md)

Flowt keeps your money organised without asking you for any extra work. It reads the notifications your bank already sends to Gmail, turns them into transactions, and shows you where you stand: what you have, where it goes, and what is coming next.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/readme/inicio-dark.png">
  <img src="docs/media/readme/inicio-light.png" alt="Flowt home: current balance, wallets, income and spending trend, banks, upcoming charges and spending by category">
</picture>

You can try it without an account at [flowt-63536.web.app](https://flowt-63536.web.app): choose **Explorar en modo demo** on the sign-in screen. The interface is in Spanish.

## What it does

### Your money, without typing it in

- **Automatic sync from Gmail.** Bank notification emails become transactions every 30 minutes. The bank catalogue covers Revolut, Unicaja, BBVA, Santander, CaixaBank, ING, Sabadell, N26 and Trade Republic, and you choose which ones you use.
- **Extraction with Gemini**, with personal data redacted before the email is processed. Emails that cannot be read with confidence wait in a manual review queue instead of being guessed.
- **Suggested categories and offsets** that you confirm with one tap, plus your own custom categories.
- **Possible duplicate charges** are flagged on the transaction itself.

### Where it goes

- **Wallets** that split every income by your own rules (a percentage, a fixed amount, or the rest), with goals and extra pay in the months you choose.
- **Money flow**: a diagram from your income to each category and what is left unspent, shareable without amounts.
- **Spending by category**, a monthly income and spending trend, and a card for the small purchases that add up.
- **Banks**: an estimated balance per bank from your transactions, anchored to a balance you note down, and reconciled against your wallets.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/readme/flujo-dark.png">
  <img src="docs/media/readme/flujo-light.png" alt="Money flow diagram from income to categories, balance projection with cautious, expected and optimistic scenarios, and small purchases">
</picture>

### What is coming

- **Balance projection** over 1 to 60 months based on your real pace, with a band between the cautious and the optimistic scenario and a what-if simulator.
- **Calendar** showing what you spent each day, the charges still to come and your next expected paycheck.
- **Subscriptions**, including shared ones, with their yearly cost and their weight in your spending.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/readme/calendario-dark.png">
  <img src="docs/media/readme/calendario-light.png" alt="Calendar with the spending of each day, the selected day's transactions and the month summary">
</picture>

### Your paycheck

- **Paycheck tab**: how the last one was split across your wallets, what is left of the free part until the next one, and the charges due before then.
- **Configurable period start**, so a month runs from payday to payday if that is how you think about it.
- **The price of an expense in hours of work.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/readme/nomina-dark.png">
  <img src="docs/media/readme/nomina-light.png" alt="Paycheck tab: last paycheck, how it was split across wallets, what is left until the next one and the previous period">
</picture>

### On your phone

Flowt is a responsive web app with a light and a dark theme.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/readme/movil-inicio-dark.png">
    <img src="docs/media/readme/movil-inicio-light.png" alt="Home on a phone" width="30%">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/readme/movil-calendario-dark.png">
    <img src="docs/media/readme/movil-calendario-light.png" alt="Calendar on a phone" width="30%">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/readme/movil-nomina-dark.png">
    <img src="docs/media/readme/movil-nomina-light.png" alt="Paycheck tab on a phone" width="30%">
  </picture>
</p>

### Privacy and security

- **The app always opens locked.** Amounts stay hidden until you unlock with your PIN, your fingerprint or the device lock.
- **Strict Firestore rules** isolate each user's data, and email content is kept for 90 days at most.
- **Safe CSV export**, protected against formula injection, and search across your whole history.
- **CSP and HSTS** headers on the hosted app.

### Assistants

An optional **MCP connector** lets an assistant such as Claude or ChatGPT read your finances and review transactions, authorised with OAuth 2.1. It is off unless you connect one.

## Architecture

```text
Gmail → Python synchronizer → Gemini → Firestore ⇄ React web app
                                           ⇅
                              MCP connector and review API
```

- **`src/`**: the web app (React, TypeScript, Vite, Tailwind).
- **`tracker-backend/`**: the Python synchronizer that reads Gmail, extracts transactions with Gemini and writes them to Firestore.
- **`mcp-worker/`**: the MCP connector and the review API as a Cloudflare Worker. `tracker-backend/mcp_server.py` is an equivalent Flask implementation for local use or Cloud Run.
- **`firestore.rules`**, **`firestore.indexes.json`**: data access rules and indexes.

See the [architecture guide](docs/ARCHITECTURE.md) for component boundaries and data flows.

## Requirements

- Node.js and npm.
- Python 3.10 or later.
- A Firebase project with Authentication and Firestore.
- Gmail API desktop OAuth credentials with the `gmail.modify` scope.
- A Firebase service account (`serviceAccountKey.json`) and a Gemini API key (`GEMINI_API_KEY`).

## Local development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env` in the repository root and fill in the Firebase web configuration:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
# Optional: URL of the review API and MCP connector
VITE_REVIEW_API_URL=
```

Demo mode works without a bank or a Gmail account, so it is the quickest way to see the app with data.

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
| `npm run test:rules` | Run the Firestore rules tests against the emulator |
| `npm run preview` | Serve the production build locally |

Run backend tests with `python -m pytest tracker-backend`.

## Deployment

- **Web app**: every push to `main` builds and publishes to Firebase Hosting through GitHub Actions.
- **Synchronizer**: a GitHub Actions workflow runs it every 30 minutes.
- **Firestore rules and indexes**: deployed manually; publish them before any web change that needs them.
- **MCP connector**: deployed to Cloudflare Workers with Wrangler.

See the [deployment guide](docs/DEPLOYMENT.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Backend](tracker-backend/README.md)
- [Transaction categories](docs/CATEGORIES.md)
- [Category and offset suggestions](docs/movement-suggestions.md)
- [Automatic review: running and enabling it](docs/mcp-daily-review-operation.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)

The guides under `docs/` are written in Spanish.

## License

Flowt is distributed under the [MIT License](LICENSE). Copyright (c) 2026 Isalvan.
