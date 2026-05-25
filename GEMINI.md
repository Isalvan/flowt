# Flowt - Project Context & Decisions

## Recent Changes (2026-04-18)
- **Completed Manual Migration**: Successfully processed 5 pending emails using the new `/manual` workflow.
- **Improved Fallback Logic**: 
    - Implemented `BeautifulSoup` cleaning for HTML emails in `fallback_logic.py`.
    - Centralized extraction logic to avoid code duplication between `main.py` and manual scripts.
- **Fixed Encoding & Communication**:
    - Resolved `UnicodeEncodeError` in Windows console by sanitizing outputs.
    - Fixed `db` initialization and name collisions in `3_enviar.py`.
- **Database integrity**: All pending movements were recorded and distributed across huchas correctly.
- **Frontend Refactor**: Rebuilt UI with React, Recharts (linear trends), and Highcharts (circular categories). Implemented a premium glassmorphic design system.
- **Git & Workspace Management**: Reorganized manual files and added `/temp` exclusion in `.gitignore`.


## Project Overview
Automated financial tracker that extracts movements (income/expenses) from bank notification emails using Gemini AI and records them in Firestore, distributing funds across "huchas" (savings pockets).

## Architecture
- **Frontend**: React + Tailwind + Recharts (deployed on Firebase Hosting).
- **Backend**: Python script (`main.py`) using Gmail API and Gemini CLI.
- **Database**: Firestore.

## Key Decisions & Implementation Details

### Data Extraction
- **Model**: `gemini-3-flash-preview` (configurable via `AI_MODEL` in `.env`).
- **Date Logic**: Uses "FECHA DE ENVÍO DEL CORREO" (Sent Date) from Gmail headers as a fallback or primary date if the email body lacks a specific transaction date.
- **Multiple Movements**: A single email can contain multiple movements. The system processes all of them.
- **Deduplication**: Uses a SHA-256 hash of `gmail_id + movement_index` as the Firestore document ID to prevent duplicate processing while allowing multiple movements from the same email.
- **Robust JSON Parsing**: Implemented regex-based extraction to isolate JSON blocks from Gemini CLI output, ignoring non-JSON noise (logs, MCP warnings).

### Huchas (Savings Pockets) Distribution
- **Income**: Distributed among huchas based on rules:
  1. `flat`: Fixed amounts first.
  2. `porcentaje`: Percentage of the total amount.
  3. `resto`: Remaining balance goes to the pocket marked as "resto" or "es_principal".
- **Expenses**: Subtracted directly from the "principal" or "resto" pocket.

### Developer Tools
- **Verbose Mode**: Run with `--verbose` to see full prompt inputs and raw AI outputs.
- **Test Suite**: Pytest covered for core logic, multiple movements, and JSON extraction.

## Recent Changes (2026-04-12)
- Fixed `'charmap' codec can't encode characters` error in `call_gemini_cli` by implementing `strip_non_cp1252` cleaning.
- Resolved process hangs by refactoring `call_gemini_cli` to use a stable text-mode pipe with `utf-8` encoding and `replace` error handling, ensuring compatibility between the Python backend and the Node-based Gemini CLI.
- Added robust timeout (60s) and error logging to the AI communication loop.
- Verified character cleaning preserves accents (áéíóúñ) while removing emojis.

## Recent Changes (2026-04-11)
- Implemented extraction of `Date` header from Gmail.
- Added instruction to `prompt.md` to prioritize email sent date.
- Added support for multiple movements per email.
- Switched deduplication ID to use internal Gmail ID instead of Header Message-ID.
- Added `--verbose` flag and improved logging.
- Refactored `main.py` for testability (moved config to `setup_config`).
- Updated and verified test suite.
