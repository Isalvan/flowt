# 🛡️ Plan de Desarrollo: Tracker Financiero Automatizado
**NAME:** Flowt
**REPO:** https://github.com/Isalvan/flowt.git

**Filosofía Principal:** "Security First" (Principio de Menor Privilegio, credenciales aisladas, prevención de inyecciones y validación estricta de datos).

---

## 1. Fase de Preparación y Seguridad del Entorno

* **Aislamiento de Credenciales y Configuración:** Nada de claves ni variables *hardcodeadas*. Archivo `.env` nunca subido al repo.
    * **`.gitignore` específico:**
        ```
        .env
        serviceAccountKey.json
        *credentials*.json
        *secret*.json
        ```
    * **🔴 CRÍTICO:** El `.env` contendrá el dominio **exacto** del banco (ej: `BANK_SENDER=notificaciones@unicaja.es`), el `UID` del propietario y variables de control (ej: `MAX_EMAILS_PER_RUN=10`).
    * **Nota de setup (README):** Antes de ejecutar el script por primera vez, debes ir a Firebase Console → Authentication → crear tu usuario → copiar el UID generado → pegarlo en el `.env`. Solo se hace una vez.

* **El Prompt Aislado y Versionado:** Archivo `prompt.md` con la instrucción exacta para la IA.
    * Permisos de solo lectura en el SO para evitar modificaciones no autorizadas.
    * La versión del prompt (ej. `v1`) se inyecta en la base de datos para trazabilidad.
    * **🔴 CRÍTICO:** El prompt debe instruir a la IA para que identifique la **dirección del dinero**:
        * Si es un cargo, pago o gasto → devolver JSON con `"tipo": "gasto"` e `importe` positivo.
        * Si es un abono, ingreso o transferencia recibida → devolver JSON con `"tipo": "ingreso"` e `importe` positivo.
        * Si el correo no es una notificación de movimiento → devolver `{}` para descartarlo.

* **Permisos de Firebase (IAM):**
    * `chmod 600 serviceAccountKey.json` en local.
    * **Aclaración crítica:** El Admin SDK bypasea las Security Rules. La restricción a las colecciones permitidas depende exclusivamente de que el código Python sea estricto.

* **Seguridad del MCP de Gmail:**
    * La única *query* permitida: correos no leídos del remitente exacto definido en `.env`.
    * Acceso estrictamente local; no exponer en puertos de red externos.
    * Limitar el scope de OAuth a `gmail.readonly` si el MCP lo permite.

---

## 2. Pila Tecnológica

* **Lenguaje:** Python 3.10+
* **Gestión de entorno:** `venv` o `poetry`.
* **Librerías clave:**
    * `python-dotenv` — leer el `.env`.
    * `subprocess` — ejecutar Gemini CLI.
    * `firebase-admin` — interactuar con Firestore.
    * `hashlib` — generar IDs de documento seguros.
    * `logging` — auditoría local rotatoria.

---

## 3. Arquitectura del Script (El Flujo Seguro)

1. **Carga Segura (Init):** Lee `.env`, carga `prompt.md`, verifica credenciales Firebase. Inicia logging rotatorio. Aborta inmediatamente si algo falta (Fail-fast).

2. **Petición al Lector (Read):** Llama al MCP local de Gmail con límite `MAX_EMAILS_PER_RUN`.
    * **🔴 CRÍTICO:** Validación de remitente **exacta** (`email.from == BANK_SENDER`), nunca `contains` ni `in`.
    * Se extrae el cuerpo del correo y su `Message-ID` original.

3. **Procesado Aislado (Extract):**
    * Subprocess a Gemini CLI con `shell=False`, contenido del correo por `stdin`.
    * **Timeout explícito** (ej. 30s). Si se supera:
        ```python
        except subprocess.TimeoutExpired:
            log.error(f"[{email_id}] Timeout al llamar a Gemini CLI. Se reintentará.")
            # No se marca como leído → reintento en próxima ejecución
        ```

4. **Validación de Datos (Sanitize):**
    * Si la IA devuelve `{}` → correo descartado, se marca como leído igualmente.
    * Validaciones obligatorias:
        * `tipo`: debe ser exactamente `"gasto"` o `"ingreso"`.
        * `importe`: número real, `0 < importe < 100000`.
        * `fecha_operacion`: forzada a UTC (ISO 8601 con `Z`).
        * Sin campos adicionales permitidos.
    * El log registra únicamente `id_correo` + motivo del descarte. **Nunca** el contenido del correo ni el output crudo de la IA.

5. **Generación del ID seguro:**
    * El `Message-ID` del correo puede contener caracteres especiales (`< > @ .`) incompatibles con Firestore.
    * **🔴 CRÍTICO:** Se genera un hash SHA-256 del `Message-ID` como ID del documento:
        ```python
        import hashlib
        doc_id = hashlib.sha256(email_id.encode()).hexdigest()
        ```
    * Sigue siendo completamente idempotente y genera un ID alfanumérico limpio.

6. **Inyección en BBDD (Write):**
    * **🟠 CRÍTICO (Esquema estricto):** Nunca inyectar el JSON de la IA directamente. Construir el dict explícitamente:
        ```python
        movimiento = {
            "id_propietario":  UID_FROM_ENV,       # nunca de la IA
            "tipo":            parsed["tipo"],      # "gasto" | "ingreso"
            "concepto":        parsed["concepto"],
            "importe":         parsed["importe"],
            "fecha_operacion": parsed["fecha_operacion"],
            "version_prompt":  PROMPT_VERSION,
        }
        db.collection("movimientos").document(doc_id).set(movimiento)
        ```
    * **Idempotencia:** `.set()` — reprocesar un correo sobrescribe los mismos datos sin duplicar.
    * **Si es un ingreso:** tras el Write, se ejecuta la lógica de distribución en huchas (ver sección 5).

7. **Cierre (Clean):** Solo si el Write fue exitoso, se marca el correo como leído. Todo queda registrado en el log.

---

## 4. Estructura de Firestore

### Colección: `movimientos`
Unifica gastos e ingresos. Permite calcular balance total con una sola query.

| Campo | Tipo | Descripción |
|---|---|---|
| `id_propietario` | String | UID del propietario (siempre del `.env`) |
| `tipo` | String | `"gasto"` o `"ingreso"` |
| `concepto` | String | Descripción extraída por la IA |
| `importe` | Number (Float) | Siempre positivo, `0 < x < 100000` |
| `fecha_operacion` | Timestamp | Siempre UTC |
| `version_prompt` | String | Versión del prompt usado (ej. `"v1"`) |

> El ID del documento es el SHA-256 del `Message-ID` del correo original.

### Colección: `huchas`
Configuración de cada hucha. Gestionada desde el front.

| Campo | Tipo | Descripción |
|---|---|---|
| `id_propietario` | String | UID del propietario |
| `nombre` | String | Nombre de la hucha (ej. "Vacaciones") |
| `tipo_aportacion` | String | `"flat"`, `"porcentaje"` o `"resto"` |
| `valor_aportacion` | Number | Importe fijo o % (nulo si `tipo` es `"resto"`) |
| `saldo_acumulado` | Number | Saldo actual acumulado |
| `objetivo` | Number \| null | Objetivo opcional. `null` si no tiene |
| `tope_objetivo` | Boolean \| undefined | Si `true` y existe `objetivo`, los aportes se cortan al alcanzar la meta y el excedente se redirige a `resto`/`principal`. Default = visual (sin corte) |
| `es_principal` | Boolean | `true` en la hucha principal (recibe el sobrante) |
| `orden` | Number | Orden de ejecución (las de `"resto"` siempre las últimas) |

---

## 5. Lógica de Distribución en Huchas (Backend)

Se ejecuta automáticamente tras registrar un ingreso. El flujo es:

1. Leer todas las huchas del propietario ordenadas por `orden`.
2. Validar que la suma de `valor_aportacion` de todas las huchas de tipo `"porcentaje"` no supere el 100%. Si supera, abortar y loguear error.
3. Calcular aportaciones en orden:
    * **`flat`:** restar el importe fijo del ingreso disponible.
    * **`porcentaje`:** calcular `ingreso_total * (valor / 100)`.
    * **`resto`:** asignar todo el remanente (solo puede haber una; siempre se ejecuta al final).
    * Si no existe hucha de tipo `"resto"`, el remanente va a la hucha marcada con `es_principal: true`.
    * **Tope por objetivo (opt-in):** Si una hucha tiene `tope_objetivo: true` y `saldo_acumulado + aporte > objetivo`, el aporte se recorta a `max(0, objetivo - saldo_acumulado)` y el sobrante se reasigna al destino por defecto (`resto` → `principal` → primera disponible). Si todas están llenas con tope, el remanente queda sin asignar y se avisa al usuario. Huchas sin `tope_objetivo` o con `tope_objetivo: false` se comportan como antes (modo solo visual). `tope_objetivo` solo tiene efecto cuando `objetivo > 0`.
4. **🔴 CRÍTICO (Concurrencia):** La actualización de los saldos **DEBE** realizarse dentro de una **Transacción de Firestore (`db.transaction()`)**. No usar `firestore.Increment` directamente fuera de ella.
    * La transacción lee el `saldo_acumulado` actual de cada hucha, suma la cantidad calculada en el paso 3 y guarda el nuevo total de forma atómica.
    * Si dos ingresos se procesan simultáneamente (ej. dos Bizums a la vez), Firestore detecta el conflicto, reintenta la transacción automáticamente y garantiza que las matemáticas cuadren al céntimo sin condiciones de carrera.

**Restricciones de integridad:**
* Solo puede existir **una** hucha con `tipo_aportacion: "resto"` por propietario.
* Solo puede existir **una** hucha con `es_principal: true` por propietario.
* `tope_objetivo` solo tiene efecto cuando `objetivo > 0`. Si se borra el objetivo, el campo se resetea a `false` automáticamente.
* La hucha principal se crea obligatoriamente en el setup inicial del front.
* La suma de porcentajes se valida tanto en el backend como en las reglas del front antes de guardar.

---

## 6. Decisiones de Producto

| Decisión | Elección | Notas |
|---|---|---|
| Ejecución del script | Manual | Sin cron job. El usuario lanza `main.py` cuando quiere procesar correos nuevos |
| Frontend | PWA (Progressive Web App) | Web instalable en móvil desde Chrome/Safari sin pasar por ninguna tienda. Requiere `manifest.json` + service worker |
| Dashboard | Balance total + huchas + gráficas | Balance general, acceso directo al estado de cada hucha y gráfica de gastos/ingresos por mes |
| Multi-usuario | Sí, desde el inicio | Cada usuario tiene su propio Firebase Auth + backend independiente. El `id_propietario` ya lo soporta sin cambios |

---

## 7. El Frontend (Próximos Pasos)

### PWA — Instalabilidad en móvil
Para que la web sea instalable en móvil sin pasar por ninguna tienda:
* Añadir `manifest.json` con nombre, icono y `display: standalone`.
* Registrar un service worker básico (puede ser mínimo al principio, solo para cumplir el requisito de instalación).
* Servir la app por HTTPS (Firebase Hosting lo da gratis y encaja perfecto con el resto del stack).

### Dashboard principal
Tres bloques en la pantalla de inicio:
1. **Balance total** — ingresos acumulados menos gastos acumulados.
2. **Huchas** — tarjetas con nombre, saldo actual y barra de progreso si tiene objetivo configurado.
3. **Gráfica** — barras o líneas de gastos/ingresos por mes (últimos 6 meses).

### Reglas de Firestore

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Movimientos (gastos e ingresos)
    match /movimientos/{movimiento} {
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.id_propietario;

      allow read: if request.auth != null
        && request.auth.uid == resource.data.id_propietario;

      // No se permite editar ni borrar desde el front
      // (solo el backend via Admin SDK puede escribir)
    }

    // Huchas
    match /huchas/{hucha} {
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.id_propietario;

      allow read, update: if request.auth != null
        && request.auth.uid == resource.data.id_propietario
        // El propietario no puede cambiarse
        && request.resource.data.id_propietario == resource.data.id_propietario;

      // DELETE omitido intencionadamente (principio de menor privilegio)
    }
  }
}
```