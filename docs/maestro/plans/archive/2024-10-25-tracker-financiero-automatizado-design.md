---
title: Tracker Financiero Automatizado
date: 2024-10-25
design_depth: standard
task_complexity: medium
---

# 1. Problem Statement
El proyecto persigue desarrollar un 'Tracker Financiero Automatizado' con un enfoque radical de 'Security First'. El objetivo es automatizar la captura, procesamiento y registro de movimientos bancarios a partir de emails de notificación utilizando un script aislado en Python, que a través de Gemini CLI (con su prompt versionado) y el MCP local de Gmail, interactúa y escribe en Firebase Firestore. Además, requiere un frontend progresivo (PWA) construido en React y TailwindCSS. Este frontend actuará como Dashboard permitiendo al usuario visualizar el balance total, el estado de sus "huchas" (sistemas de ahorro porcentual y remanente) y gráficas de historial, facilitando una instalación móvil nativa sin intermediarios.

# 2. Requirements (Functional, Non-Functional, Constraints)
**Functional**
- El backend (Python) lee notificaciones bancarias del MCP de Gmail local.
- Analiza el texto con Gemini CLI devolviendo JSON con formato estricto (tipo: `gasto` o `ingreso`).
- Registra el movimiento en Firestore con ID de documento hash SHA-256 (del Message-ID).
- Ejecuta una lógica atómica transaccional de distribución en "huchas" (`flat`, `porcentaje`, `resto`) si el movimiento es un ingreso.
- El frontend PWA permite instalarse en móvil y muestra el dashboard (balance general, tarjetas de huchas y gráfica de tendencias).

**Non-Functional**
- "Security First": Aislamiento estricto de credenciales en `.env` / `serviceAccountKey.json`, versionado del `prompt.md`.
- Escalabilidad Concurrente: Utilización de `db.transaction()` para actualizar saldos de huchas atómicamente.

**Constraints**
- Coincidencia exacta del email remitente del banco (sin condicionales laxos).
- Ejecución del proceso de rastreo de manera manual vía consola.
- PWA alojada sobre Firebase Hosting con `manifest.json` y service worker obligatorio.

# 3. Approach
**Selected Approach: Frontend-First + Script Aislado (Recomendado)**
El proyecto alojará el entorno PWA (Vite + React + Tailwind) en el directorio raíz, mientras que la lógica de parseo y conexión a Gemini CLI y Gmail MCP residirá en un subdirectorio aislado `tracker-backend/`.
- Ubicación Root del Frontend — *[Justificación: Vite y Firebase Hosting requieren una estructura base sencilla para empaquetar el `dist/` e indexarlo, evitando configuraciones de enrutamiento anidadas complejas]*.
- Carpeta Aislada del Backend — *[Justificación: Previene la subida accidental de credenciales `serviceAccountKey.json`, `.env` o del `prompt.md` a los despliegues públicos de Firebase Hosting y permite a Python manejar su propio `.venv`]*.

**Alternatives Considered:** Monorepo Equilibrado (directorios paralelos `/frontend` y `/backend` con un root genérico).

**Decision Matrix:**
| Criterio (Peso) | Frontend-First | Monorepo Equilibrado |
|---|---|---|
| Aislamiento Seguridad (40%) | 5: Máxima protección. | 4: Comparte raíz, riesgo de fugas. |
| Integración Hosting (30%) | 5: Deploy directo sobre raíz. | 3: Rutas anidadas en `firebase.json`. |
| Simplicidad de Ejecución (30%) | 4: Un `cd` extra para el script. | 5: Ejecución al mismo nivel. |
| **Total Ponderado** | **4.7** | **3.9** |

# 4. Architecture
**Component Diagram:**
- **Capa Cliente (PWA Vite/React):** Autenticación de Firebase y lectura directa de Firestore (con Security Rules `request.auth.uid == id_propietario`). Maneja la UI (Dashboards y Huchas).
- **Capa Scripts (Python + Admin SDK):** Entorno de terminal que dispara `gmail-mcp` (lectura controlada), `gemini cli` con `prompt.md` inyectado (inteligencia semántica) y escritura directa al backend.
- **Capa Datos (Firebase Firestore):** Colecciones `movimientos` (historial/balance) y `huchas` (reglas de ahorro).

**Data Flow (Ingreso):**
1. El Script Python procesa un email de `BANK_SENDER`.
2. Gemini emite `{ "tipo": "ingreso", "importe": 100 }`.
3. Python aplica hash SHA-256 al ID original del email como clave única (Idempotencia) — *[Razón: Prevenir duplicidades si el script falla a medio camino]*.
4. Python ejecuta `db.transaction()` sobre Firestore: graba el ingreso y, en el mismo bloque atómico, lee las huchas, reparte los montos (`flat` -> `porcentaje` -> `resto`) y guarda los nuevos `saldo_acumulado` — *[Razón: Garantiza la precisión matemática sin condiciones de carrera]*.

# 6. Risk Assessment
**Riesgos de Analítica y Modelos:**
- *Gemini CLI devuelve formato impredecible:* El backend requiere fallar con gracia (Fail-fast) o reintentar, logueando el descarte sin grabar el correo. El script parsea JSON de manera estricta e ignora datos extras — *[Razón: Prevenir datos corruptos en el balance general]*.
- *Timeouts en invocación de Gemini:* Definir un timeout explícito en `subprocess`. El correo no se marca como leído para que sea procesado en la siguiente ejecución.

**Riesgos de Infraestructura y Datos:**
- *Credenciales en Repositorio:* Riesgo mitigado mediante una fuerte configuración `.gitignore` (excluyendo el Service Account y `.env`).
- *Ataques Transaccionales (Concurrencia):* Cubierto por la implementación de `db.transaction()`. Si dos transacciones solapan, Firestore reintentará automáticamente.

**Security Rules del Frontend:**
- Las claves públicas web de Firebase estarán expuestas, por lo que Firestore depende 100% de la regla `request.auth.uid == resource.data.id_propietario` (y la imposibilidad de escrituras directas del PWA en `movimientos`) — *[Razón: Restringe que usuarios modifiquen movimientos falsos y evita fugas de datos]*.
