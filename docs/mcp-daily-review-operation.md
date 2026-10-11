# Revisión automática: ejecución y activación

## Implementado

- Configuración categoría → hucha en Ajustes, con catálogo personalizado y persistencia por usuario.
- Registro duradero de procesamiento de correos y cola independiente de revisión.
- Servicio MCP HTTP autenticado y API web para historial, reversión y respuestas a dudas.
- Revisión atómica de nombre/categoría/hucha, vínculos a suscripciones y creación de suscripciones mensuales con evidencia validada de tres meses consecutivos.
- Auditoría, protección manual, control por versión real de Firestore e idempotencia.
- Dudas agrupadas, respuestas persistentes, reintentos con límite y espera entre ejecuciones.
- Historial y dudas en Ajustes → Revisiones automáticas.

Las compensaciones se conservan; no hay herramientas para cambiarlas. Las operaciones con deuda, efectivo o transferencias internas no se reasignan automáticamente. Si falta la hucha original o no hay capacidad para conservar todo el saldo con los topes actuales, la operación se rechaza y se muestra para resolverla; no se pierde dinero silenciosamente.

## Implementaciones del servicio

El repositorio contiene dos implementaciones independientes del conector MCP y de la API web de revisión:

1. **Python / Flask (`tracker-backend/mcp_server.py`)**: pensada para ejecución local y despliegue en Google Cloud Run mediante contenedor.
2. **Cloudflare Worker (`mcp-worker/`, con `wrangler.json`)**: pensada para despliegue serverless en la red de Cloudflare Workers, comunicándose con Firestore vía API REST y Web Crypto.

Cualquiera de las dos implementaciones puede dar soporte a la aplicación web de Flowt. Las secciones siguientes detallan la ejecución local, el conector OAuth, el despliegue en Cloud Run (`## Alojamiento preparado`) y el despliegue del Worker en Cloudflare (`## Desplegar el Worker de Cloudflare`), de modo que el lector sepa qué sección aplica según la infraestructura seleccionada. Ninguna de las dos implementaciones ha sido desplegada todavía en producción ni verificada contra un asistente real.

## Ejecutar el servicio local

Desde `tracker-backend`, instalar `requirements-review.in` en un entorno Python y ejecutar `python mcp_server.py`. En Windows se utiliza un entorno local aislado; los scripts habituales pueden ejecutarse con el prefijo `rtk` indicado por las instrucciones del workspace.

El servicio escucha por defecto en `127.0.0.1:8081`. Firebase Admin se inicializa solo cuando una herramienta necesita datos; utiliza Application Default Credentials. No toma credenciales de la web ni publica archivos de secretos.

| Variable | Uso |
|---|---|
| `GOOGLE_CLOUD_PROJECT` | Proyecto de Firebase/Google Cloud de destino |
| `FLOWT_REVIEW_WRITES_ENABLED` | `true` permite aplicar/revertir revisiones y guardar dudas; por defecto desactivado |
| `FLOWT_REVIEW_ALLOWED_ORIGINS` | Orígenes web exactos separados por comas; sin configuración se rechazan peticiones con Origin |
| `FLOWT_PUBLIC_BASE_URL` | URL pública del servicio, sin barra final. El conector queda en `<URL>/mcp`. Sin ella no hay OAuth |
| `FLOWT_CONSENT_URL` | Pantalla de Flowt donde el usuario autoriza la conexión: `<web>/conectar` |
| `FLOWT_MCP_WRITES_ENABLED` | `false` deja el conector en solo lectura para todos; por defecto `true` |
| `FLOWT_MCP_OWNER_UID` | Propietario del token fijo de la revisión programada (opcional) |
| `FLOWT_MCP_TOKEN` | Secreto de al menos 32 caracteres para ese token fijo; usar gestor de secretos |
| `PORT` | Puerto HTTP; por defecto 8081 local |
| `FLOWT_REVIEW_BIND` | Dirección de escucha local; por defecto 127.0.0.1 |
| `VITE_REVIEW_API_URL` | URL base del servicio para compilar la web; nunca contiene el token del conector |
| `FLOWT_REVIEW_ENABLED` | Activa la entrega a revisión en el sincronizador; por defecto desactivado |

Los asistentes (Claude, ChatGPT u otro cliente MCP) entran con OAuth: nadie copia un token. El token fijo sigue existiendo para la revisión programada, limitado a las herramientas de revisión; es opcional. La web se autentica con su Firebase ID token.

## Conector completo con OAuth

El conector da al asistente lo mismo que la web al usuario que lo autoriza: movimientos, carteras, suscripciones, categorías, correos pendientes e histórico, además de las revisiones. Quedan fuera el PIN y los ajustes de la cuenta. Cada herramienta actúa sobre el usuario que dio el permiso; ningún argumento puede cambiarlo.

Cómo se conecta un asistente:

1. El usuario añade `<FLOWT_PUBLIC_BASE_URL>/mcp` como conector (la dirección aparece en Ajustes → Conexiones).
2. El asistente recibe un 401 con la dirección de los metadatos, se registra solo (`/oauth/register`) y abre `<web>/conectar` en el navegador.
3. El usuario, con su sesión de Flowt, ve qué aplicación pide acceso y a dónde volverá, decide si además de ver puede hacer cambios, y autoriza.
4. El asistente canjea el código (PKCE S256) por un token de acceso de una hora y uno de renovación de 90 días que rota en cada uso.

Ajustes → Conexiones lista las aplicaciones conectadas y permite desconectarlas; la desconexión es inmediata. Códigos y tokens se guardan solo como resumen SHA-256 en `oauth_codes` y `oauth_tokens`; los clientes en `oauth_clients` y las conexiones en `oauth_grants`. Las reglas niegan todo acceso desde el cliente a esas colecciones.

Permisos: `flowt:read` (consultas) y `flowt:write` (cambios). Una conexión de solo lectura ni siquiera ve las herramientas de escritura. Las herramientas que crean algo aceptan `operation_id`: repetir la llamada con el mismo valor tras un fallo de red devuelve el primer resultado sin aplicarlo dos veces.

Diferencias deliberadas con la web, todas para no perder dinero por el camino:

- Un ingreso sin cartera se reparte como en el sincronizador (respeta topes y paga deudas entre carteras) y guarda el reparto en `reparto_aplicado`, de modo que borrarlo o convertirlo lo deshace exactamente. Los ingresos antiguos, sin ese dato, se deshacen recalculando con las reglas actuales, como hace la web.
- Una transferencia que no cabe en la cartera destino y no tiene dónde dejar el sobrante se rechaza en vez de dejar dinero sin asignar.
- Archivar una cartera con deuda pendiente o saldo negativo se rechaza: antes hay que resolver la deuda o compensar el saldo.

### Publicarlo en el mismo dominio que la web

Servir el servicio bajo el dominio de la web evita tocar la CSP y CORS. Pasos, ninguno ejecutado todavía:

1. Construir la imagen con `tracker-backend/Dockerfile.review` y desplegarla en Cloud Run permitiendo invocaciones sin autenticar (la aplicación autentica cada petición). Su cuenta de servicio necesita acceso a Firestore y poder verificar tokens de Firebase Auth.
2. Variables del servicio: `GOOGLE_CLOUD_PROJECT`, `FLOWT_PUBLIC_BASE_URL=https://<web>`, `FLOWT_CONSENT_URL=https://<web>/conectar`, `FLOWT_REVIEW_ALLOWED_ORIGINS=https://<web>`.
3. En `firebase.json`, antes de la regla `**`, añadir reescrituras a ese servicio para `/mcp`, `/oauth/**`, `/api/**` y `/.well-known/**` (`"run": { "serviceId": "...", "region": "..." }`). No añadirlas antes de que el servicio exista: el despliegue de Hosting fallaría.
4. Definir la variable de repositorio `VITE_REVIEW_API_URL=https://<web>`; los flujos de Hosting ya la pasan a la compilación. Sin ella la web no muestra conexiones ni la pantalla de autorización.
5. Desplegar reglas e índices de Firestore.
6. Opcional: políticas TTL de Firestore sobre el campo `expires_at` de `oauth_tokens`, `oauth_codes`, `oauth_clients` y `mcp_operations`. Sin ellas el servicio limpia los caducados en cada canje o renovación.

Si se sirve en otro dominio, hay que añadir su origen al `connect-src` de `firebase.json`.

El endpoint `/mcp` implementa Streamable HTTP con respuestas JSON y protocolo negociado 2025-03-26, 2025-06-18 o 2025-11-25. No publica sesiones ni flujo SSE independiente; GET devuelve 405. El cliente debe utilizar un protocolo compatible. Referencia del transporte: [especificación oficial MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Alojamiento preparado

`tracker-backend/Dockerfile.review` permite construir el servicio para Cloud Run. `.dockerignore` usa una lista explícita de archivos admitidos; no incorpora `.env`, tokens, credenciales ni datos de evaluación privados al contexto de imagen.

Antes de publicar, definir proyecto, región, identidad de servicio con permisos Firestore y secretos del conector. Cloud Run debe dirigir tráfico al servidor Gunicorn del contenedor. Para el conector externo, la autenticación de aplicación debe poder recibir la petición; una política IAM de Cloud Run que exija otro token además del conector necesita una pasarela compatible.

Configurar el origen público real de Flowt en `FLOWT_REVIEW_ALLOWED_ORIGINS`. Si la API se sirve en otro dominio, añadir su origen exacto al `connect-src` de `firebase.json` antes de publicar la web; la CSP actual no admite automáticamente un dominio nuevo de Cloud Run. Alternativamente, configurar una ruta del mismo dominio mediante el hosting.

No se ha desplegado el servicio ni se ha dado por probado su uso desde una tarea programada. Tener pruebas locales del transporte no demuestra permisos de escritura desatendidos en ChatGPT.

## Desplegar el Worker de Cloudflare

La implementación alternativa del servicio MCP y de la API web de revisión reside en el directorio `mcp-worker/` y se gestiona mediante el archivo de configuración `wrangler.json` situado en la raíz del repositorio. No utiliza el SDK de Node ni de Firebase Admin, sino Web Crypto y la API REST directa de Firestore, lo que le permite ejecutarse de forma ligera en el runtime serverless de Cloudflare Workers.

Ni el Worker ni el servicio en Python han sido desplegados todavía en producción ni verificados contra un asistente real; no asumas que existe un despliegue operativo previo. Las pruebas automatizadas del Worker se encuentran en `mcp-worker/tests/` y pueden ejecutarse desde la raíz del repositorio con `npm test -- --run`.

### Variables de entorno del Worker

A continuación se detallan todas las variables de entorno que el Worker lee en tiempo de ejecución (definidas en `mcp-worker/src/worker.js`):

| Variable | Tipo de configuración | Descripción | Valor predeterminado si no está definida |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Secreto (`wrangler secret put`) | JSON de la clave de cuenta de servicio de Firebase / Google Cloud. Debe incluir `client_email` y `private_key` (y opcionalmente `project_id`). Permite al Worker autenticarse mediante Web Crypto ante la API REST de Firestore y obtener tokens de acceso OAuth2 de Google. | Sin valor predeterminado (obligatoria). Si no está configurada o carece de `client_email`/`private_key`, el Worker lanza un error interno y responde HTTP 500 (`server_error`). |
| `FIREBASE_PROJECT_ID` | Variable ordinaria (`wrangler.json` en `vars`) | Identificador del proyecto de Firebase / Google Cloud (`flowt-63536`). | `account.project_id` extraído del JSON de `FIREBASE_SERVICE_ACCOUNT`. |
| `APP_URL` | Variable ordinaria (`wrangler.json` en `vars`) | URL pública base de la aplicación web Flowt (por ejemplo `https://flowt-63536.web.app`). Se emplea para derivar la pantalla de consentimiento OAuth (`<APP_URL>/conectar`) y se incorpora de forma predeterminada a los orígenes CORS permitidos. | Cadena vacía `""`. Sin esta variable no hay pantalla de consentimiento, por lo que el servidor OAuth queda deshabilitado y sus rutas devuelven 404. |
| `ALLOWED_ORIGINS` | Variable ordinaria (`wrangler.json` en `vars`) | Lista de orígenes web adicionales permitidos para CORS separados por comas (por ejemplo para entornos de staging o pruebas locales), que se añaden a `APP_URL`. Las peticiones protegidas con cabecera `Origin` que no coincidan con ninguno de estos orígenes se rechazan con HTTP 403 (`origin_forbidden`). | Cadena vacía `""` (solo se admite el origen indicado en `APP_URL`). |
| `PUBLIC_ORIGIN` | Variable ordinaria (`wrangler.json` en `vars`) | Origen público canónico del Worker (sin barra final), por ejemplo `https://conector.flowt.example`. Se utiliza como `issuer` en los metadatos OAuth y para fijar el identificador del recurso MCP (`<PUBLIC_ORIGIN>/mcp`). | Origen de la URL de la petición entrante (`url.origin`, por ejemplo `https://flowt-mcp.<subdominio>.workers.dev`). |
| `FLOWT_REVIEW_WRITES_ENABLED` | Variable ordinaria (`wrangler.json` en `vars`) | Habilita las operaciones de escritura del servicio de revisión (`apply_review`, `revert_review`, `defer_review`, `record_question`, `resolve_question`) cuando su valor es `"true"`. Si es `"false"` u otro valor, estas herramientas rechazan cambios con `writes_disabled`. Las ediciones manuales del usuario (`edit_movement`) continúan funcionando. | `false` (desactivado; solo se activa si su valor en minúsculas es explícitamente `"true"`). |
| `FLOWT_MCP_WRITES_ENABLED` | Variable ordinaria (`wrangler.json` en `vars`) | Controla si las herramientas financieras de escritura del conector MCP (`create_movement`, `update_movement`, `delete_movement`, transferencias, huchas, suscripciones, etc.) están disponibles para asistentes conectados con permiso `flowt:write`. Si se define como `"false"`, oculta esas herramientas y rechaza peticiones con `writes_disabled`. | `"true"` (activado por defecto; permite escrituras si el cliente tiene scope `flowt:write`). |
| `FLOWT_MCP_TOKEN` | Secreto (`wrangler secret put`) | Secreto de al menos 32 caracteres para el token portador de larga duración destinado a la revisión automática programada desatendida. Otorga exclusivamente el ámbito `flowt:review`. | Cadena vacía `""` (desactivado; el conector solo admite OAuth o tokens de Firebase). |
| `FLOWT_MCP_OWNER_UID` | Variable ordinaria (`wrangler.json` en `vars`) o secreto | UID de Firebase del usuario propietario de los datos para el que actúa el token fijo de revisión programada (`FLOWT_MCP_TOKEN`). | `undefined` (el token fijo no surte efecto si no hay un UID configurado). |

### Pasos de despliegue en orden

Para poner en marcha el Worker partiendo de una cuenta de Cloudflare y la clave JSON de la cuenta de servicio de Firebase:

1. **Ejecutar la suite de pruebas del Worker**:
   Antes de desplegar, asegurar la integridad del código ejecutando las pruebas desde la raíz del repositorio:
   ```bash
   npm test -- --run
   ```
2. **Desplegar reglas e índices de Firestore**:
   El Worker realiza lecturas y escrituras directas sobre Firestore. Desplegar los índices compuestos y las reglas de seguridad:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   Las colecciones utilizadas por el conector y OAuth incluyen `oauth_clients`, `oauth_codes`, `oauth_tokens`, `oauth_grants`, `mcp_operations`, `review_jobs`, `review_handoffs`, `review_history`, `review_questions`, `review_configuration` y `email_processing`.
3. **Revisar la configuración en `wrangler.json`**:
   El archivo `wrangler.json` en la raíz contiene la configuración base:
   ```json
   {
     "name": "flowt-mcp",
     "main": "mcp-worker/src/worker.js",
     "compatibility_date": "2026-03-01",
     "vars": {
       "FIREBASE_PROJECT_ID": "flowt-63536",
       "APP_URL": "https://flowt-63536.web.app"
     }
   }
   ```
   Ajustar los valores según el entorno:
   - Configurar `FLOWT_REVIEW_WRITES_ENABLED: "false"` inicialmente si se desea seguir el orden de activación seguro.
   - Definir `PUBLIC_ORIGIN: "https://<dominio-worker>"` si el Worker responderá tras un dominio personalizado en vez del subdominio de `workers.dev`.
   - Añadir `ALLOWED_ORIGINS` con orígenes adicionales si la aplicación web se consulta desde otras URLs (como previews de Hosting).
4. **Registrar los secretos en Cloudflare**:
   Iniciar sesión en Cloudflare si es necesario (`npx wrangler login`). Subir las credenciales privadas:
   ```bash
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
   ```
   Pegar el contenido JSON completo de la clave de la cuenta de servicio de Firebase (con `client_email` y `private_key`).
   Si se planea utilizar revisión programada con token fijo:
   ```bash
   npx wrangler secret put FLOWT_MCP_TOKEN
   ```
   Introducir una clave secreta de al menos 32 caracteres y asegurarse de haber asignado `FLOWT_MCP_OWNER_UID` en `wrangler.json` o mediante `wrangler secret put FLOWT_MCP_OWNER_UID`.
5. **Desplegar el Worker**:
   Ejecutar desde la raíz del proyecto:
   ```bash
   npx wrangler deploy
   ```
   Wrangler mostrará la URL pública asignada al Worker (por ejemplo `https://flowt-mcp.<subdominio>.workers.dev`).
   Comprobar que el servicio está activo consultando su comprobación de estado:
   ```bash
   curl -i https://<url-del-worker>/health
   ```
   Debe responder con código HTTP 200 y el cuerpo `{"status":"ok","server":"flowt-mcp"}`.
6. **Ajustar la Content-Security-Policy (CSP) en la aplicación web**:
   Si el Worker reside en un dominio distinto al de la web (el caso estándar de Cloudflare Workers), seguir las instrucciones de la sección siguiente para actualizar `connect-src` en `firebase.json` y en `index.html`.
7. **Configurar `VITE_REVIEW_API_URL` y publicar la web**:
   El frontend localiza el servicio mediante la variable de compilación `VITE_REVIEW_API_URL`.
   - En compilación local: añadir en `.env.production.local` la URL base del Worker (sin barra final):
     ```dotenv
     VITE_REVIEW_API_URL=https://<url-del-worker>
     ```
     Compilar con `npm run build` y publicar con `firebase deploy --only hosting`.
   - En despliegue automatizado con GitHub Actions: crear la variable de repositorio `VITE_REVIEW_API_URL` en **Settings → Secrets and variables → Actions → Variables** con el valor `https://<url-del-worker>`.
   Sin esta variable, la web no mostrará el panel de conexiones conectadas, ni la pantalla `/conectar`, ni el historial de revisiones automáticas.

### Política de seguridad de contenido (CSP) y control de orígenes

Cuando el Worker se sirve desde un dominio distinto al de la aplicación web, el navegador bloqueará las conexiones si no están explícitamente autorizadas:

1. **Ajustes en la CSP del frontend**:
   - En `firebase.json`: dentro de la configuración `hosting.headers`, localizar la directiva `connect-src` de la cabecera `Content-Security-Policy` y añadir el origen del Worker (por ejemplo `https://flowt-mcp.<subdominio>.workers.dev` o `https://<dominio-worker>`).
   - En `index.html`: actualizar la etiqueta meta de respaldo `<meta http-equiv="Content-Security-Policy" content="...">` añadiendo igualmente el origen del Worker dentro de `connect-src`.
2. **Orígenes admitidos por el Worker (CORS)**:
   - **Rutas no públicas** (`/mcp`, `/api/reviews/*`, `/api/connections/*`): el Worker valida la cabecera `Origin`. Solo acepta peticiones cuyo origen coincida con `APP_URL` o con alguno de los orígenes configurados en `ALLOWED_ORIGINS`. Si el origen no coincide, devuelve HTTP 403 (`origin_forbidden`). Si coincide, devuelve `Access-Control-Allow-Origin` con el origen solicitado. Las peticiones sin cabecera `Origin`, como las de un cliente MCP que no es un navegador, no pasan por esta comprobación: las protege su credencial.
   - **Rutas públicas** (`/.well-known/*`, `/oauth/register`, `/oauth/token`, `/oauth/revoke`): al ser endpoints de descubrimiento y canje OAuth que cualquier cliente MCP o asistente debe poder invocar desde cualquier origen, el Worker devuelve `Access-Control-Allow-Origin: *`.

### Comportamiento que conviene conocer

Los dos primeros puntos distinguen al Worker del servicio Python, que comprueba la revocación de sesiones y no limita peticiones. El tercero es igual en ambos:

1. **Persistencia temporal de sesiones revocadas de Firebase**:
   El servicio Python utiliza el SDK de Firebase Admin para verificar tokens y permite comprobar en tiempo real si una sesión ha sido revocada en el servidor de identidad. En el Worker (`mcp-worker/src/idToken.js`), los tokens de sesión de Firebase se validan localmente mediante Web Crypto contrastando su firma criptográfica con las claves públicas que Google publica en `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`, comprobando emisor, audiencia y marcas de tiempo. No se consulta a Firebase Auth en cada petición. En consecuencia, si se revoca una sesión en Firebase Authentication, el token continúa siendo considerado válido por el Worker hasta que expire su tiempo de vida natural (como máximo una hora).
2. **Limitador de tasa en memoria por isolate**:
   El limitador de peticiones (`mcp-worker/src/rateLimiter.js`) se ejecuta en la memoria local de cada isolate de Cloudflare (`RATE_LIMITS`: 120 peticiones por minuto por IP según la cabecera `CF-Connecting-IP`, y 60 llamadas a herramientas por minuto por UID de usuario). Al tratarse de contadores en memoria sin almacenamiento persistente compartido, el control es de tipo *best-effort*: cada isolate gestiona su propia ventana temporal. Si el tráfico se distribuye entre múltiples isolates o centros de datos, el límite efectivo global puede ser superior al umbral configurado. Su propósito es mitigar ráfagas y abusos de un único cliente sin requerir servicios externos de pago.
3. **Token fijo de larga duración limitado estrictamente a herramientas de revisión**:
   En el Worker (`mcp-worker/src/worker.js` y `tools.js`), el token fijo configurado mediante `FLOWT_MCP_TOKEN` (asociado a `FLOWT_MCP_OWNER_UID`) otorga exclusivamente el ámbito `flowt:review` (`SCOPE_REVIEW`). Este token solo permite ejecutar las 12 herramientas del servicio de revisión (`list_pending_reviews`, `get_movement_context`, `get_finance_configuration`, `search_related_movements`, `preview_review`, `apply_review`, `get_review_history`, `revert_review`, `record_question`, `resolve_question`, `list_review_questions`, `defer_review`). No tiene acceso a las herramientas financieras (`create_movement`, `update_movement`, `delete_movement`, gestión de carteras o suscripciones), ni puede realizar ediciones manuales mediante `/api/reviews/edit` (que exige un Firebase ID token de la web). Para que un asistente realice modificaciones como usuario, debe conectarse mediante OAuth con el ámbito `flowt:write`.

## Orden de activación

1. Desplegar reglas e índices de `firestore.rules`/`firestore.indexes.json` junto con la web compatible. Las aprobaciones manuales ahora guardan un handoff duradero en la misma transacción.
2. Publicar el servicio con escrituras desactivadas. Conectar MCP y Gmail en el chat web que ejecutará la revisión.
3. Verificar lectura, configuración, búsqueda paginada y `preview_review` con datos de prueba.
4. Habilitar escrituras exclusivamente en el entorno de prueba y ejecutar una revisión real. Repetir exactamente `operation_id`/carga, comprobar saldos y deshacerla desde la web.
5. Repetir esa prueba desde una ejecución programada y verificar que no exige confirmación en cada corrida. Si falla la autenticación o el conector, mantener la automatización desactivada y resolver la incompatibilidad.
6. Activar entrega en GitHub Actions con la variable de repositorio `FLOWT_REVIEW_ENABLED=true` y usar un lote inicial pequeño. El workflow incluye esta variable con valor predeterminado `false`.
7. Activar escrituras en producción y programar las 06:00, Europe/Madrid, con las instrucciones versionadas de `tracker-backend/prompts/daily_review.md`.
8. Revisar las primeras ejecuciones y las reversiones. Para detener nuevas correcciones, desactivar `FLOWT_REVIEW_WRITES_ENABLED`; para detener nuevos pendientes, desactivar la variable del sincronizador. El sincronizador bancario continúa funcionando.

No hay migración automática de todo el histórico. La búsqueda para suscripciones sí puede usar movimientos antiguos. Para incorporar movimientos antiguos a revisión hace falta una incorporación explícita, acotada y basada en relaciones de procesamiento verificadas.

## Recuperación y comportamiento

- `email_processing` conserva IDs y estado mínimos sin TTL de cuerpo. `correos_historico` mantiene su retención existente de 90 días.
- Una caída después de guardar movimientos y antes de terminar las ramas no vuelve a ejecutar Gemini sobre gastos ya registrados. Conserva esos IDs y deriva la parte incierta a la revisión inicial.
- Los movimientos aprobados en la revisión inicial guardan `review_handoffs`; el sincronizador consume hasta 50 por ejecución y publica las nuevas revisiones de forma atómica.
- Una corrección manual protege los campos editados; las reglas impiden borrar sus protecciones o falsificar auditoría/procedencia.
- Con `VITE_REVIEW_API_URL` configurado, las ediciones web de nombre, categoría y hucha usan el servicio autenticado y la misma lógica de reasignación. Cambiar la categoría aplica su mapa salvo que la hucha esté protegida manualmente. Estas ediciones humanas siguen disponibles aunque las correcciones automáticas estén desactivadas. Un asistente conectado con permiso de cambios hace esa misma edición con `update_movement`, y cuenta como decisión del usuario; el token fijo de la revisión programada no puede.
- `expected_version` es el timestamp exacto del documento leído, no solo el contador modificado por el MCP. Las ediciones de la web y del sincronizador también provocan conflicto si cambian el documento.
- Las reversiones aplican deltas inversos sobre saldos actuales. Conservan otros movimientos y rechazan cambios posteriores incompatibles o deudas nuevas.
- `defer_review` incrementa un presupuesto persistente. Al tercer aplazamiento el caso requiere atención y deja de aparecer en los lotes diarios. `record_question` evita preguntas duplicadas y `resolve_question` reabre los casos afectados.
- Crear una suscripción exige que los movimientos de evidencia incluyan el movimiento revisado. No se exige igualdad de concepto, día o importe. En esta versión, la creación automática admite suscripciones mensuales en EUR; las existentes de otras frecuencias pueden vincularse. No modificar precios o fechas configuradas al vincular un cobro.

## Verificación

Pruebas Python: `python -m pytest tracker-backend/tests -q`, con las dependencias de revisión instaladas. Pruebas web: `npm test -- --run`; compilación: `npm run build`; lint: `npm run lint`.

Las pruebas `tests/review-security.rules.test.ts`, `tests/category-huchas.rules.test.ts` y `tracker-backend/tests/test_review_emulator.py` requieren un Firestore Emulator real. Usar proyecto `demo-flowt-test`, Java 21 y `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`; no apuntarlas a producción. Las nuevas pruebas se omiten explícitamente cuando no hay emulador.

Se han verificado reglas y operaciones con Firestore Emulator, además de las pruebas de dominio, servicio, transporte HTTP y UI. La prueba pendiente que condiciona la activación es la conexión real a ChatGPT y una ejecución programada con Gmail y escritura autorizada.

Resultado local del 2026-10-04:

- Suite Python: 163 pruebas correctas; los casos con emulador se ejecutaron por separado.
- Suite web: 127 pruebas correctas; las pruebas nuevas de reglas se ejecutaron por separado con emulador.
- Firestore Emulator: 37 pruebas de reglas y 5 pruebas Python con el SDK real, sin omisiones en esas ejecuciones.
- Cliente oficial MCP SDK 2.3.0: negociación de protocolo, descubrimiento de 12 herramientas, lectura/escritura/deshacer autenticados y rechazo de carga inválida mediante HTTP real local.
- `npm run build` y `npm run lint` terminan correctamente. Permanecen avisos anteriores de hooks y del tamaño del bundle.

Los datos del emulador y del cliente MCP son de prueba. No se desplegaron recursos ni se escribieron datos financieros de producción. Los cambios permanecen en el checkout local de `main`; no se creó commit ni se publicaron los cambios locales previos del usuario.

Resultado local del 2026-10-10, tras añadir el conector con OAuth:

- Suite Python: 251 pruebas correctas y 8 omitidas (las que necesitan emulador). Las operaciones financieras nuevas y el flujo OAuth completo se prueban contra un Firestore en memoria que aplica las escrituras de cada transacción juntas y rechaza lecturas posteriores a una escritura.
- `tracker-backend/tests/test_finance_emulator.py` cubre lo mismo con el SDK real, pero no se ha ejecutado: el emulador exige Java 21 y la máquina solo tenía Java 17.
- Suite web: 142 pruebas correctas; compilación y lint sin errores.
- No se ha desplegado nada ni se ha conectado un asistente real. Queda por comprobar el flujo OAuth con Claude o ChatGPT contra el servicio publicado.
