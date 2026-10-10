# Plan de implementación: revisión automática de Flowt mediante MCP

Fecha: 2026-10-04. Base inspeccionada: `main`, commit `7709478564913a3462e941be0c8fd9ee621138b5`, coincidente con `origin/main` tras `git fetch origin`.

## Objetivo y decisiones acordadas

Completar automáticamente los movimientos ya procesados por Flowt con contexto de Gmail y del historial financiero, sin contratar una API de IA adicional para esta revisión. El sincronizador actual sigue ejecutándose cada media hora; la revisión se ejecutará a las 06:00, Europe/Madrid, tras comprobar la integración real.

- Automatizar nombres, categorías, asignación de huchas y suscripciones.
- Configurar en la web las relaciones categoría/etiqueta → hucha, incluidas las categorías y huchas personalizadas. En esta versión, «etiqueta» corresponde al campo `categoria` existente; no se introduce un sistema de etiquetas múltiples.
- Ante ambigüedad, la IA aplica su mejor deducción respaldada por el contexto disponible, deja una explicación y permite revertir. No requiere aprobación movimiento por movimiento ni convierte una puntuación de confianza en condición rígida de aceptación.
- Vincular suscripciones existentes y permitir crear nuevas cuando la IA identifique una suscripción real.
- Para crear una suscripción, el código exige al menos tres movimientos distintos correspondientes a tres meses consecutivos. La IA aporta sus IDs y justifica la relación; el código consulta sus datos reales y verifica el requisito.
- No exigir comercio, importe ni día de cobro idénticos mediante reglas fijas. La relación semántica y la interpretación del patrón corresponden a la IA.
- Compensaciones automáticas y correcciones de tipo, importe, moneda o fecha quedan fuera de esta versión. Las compensaciones existentes se conservan.
- Conservar las decisiones explícitas del usuario. Automatizar no autoriza a inventar datos ni a sobrescribir una corrección manual.

## Situación encontrada en el código

| Área | Situación actual | Consecuencia |
|---|---|---|
| Sincronización | `.github/workflows/run_tracker.yml` ejecuta Python cada 30 minutos | Mantener el flujo y añadir la entrega a revisión |
| Persistencia | `tracker-backend/main.py::process_email_movements_transaction` registra movimientos, huchas y estadísticas | Extraer operaciones de dominio reutilizables, sin repetir ingresos/gastos al revisar |
| Fin del procesamiento | `correos_historico` se escribe después de la transacción de movimientos y puede fallar por separado | Añadir un registro duradero de procesamiento; no usar «correo leído» como prueba de finalización |
| Correo de origen | El sincronizador guarda `email_id`; las reglas web también contemplan `id_correo_origen` | Normalizar la relación y admitir lectura de formatos anteriores |
| Categorías | Catálogo compartido en `tracker-backend/prompts/categories.json`, categorías personalizadas en `categorias/{uid}/items` | Reutilizar IDs y validar ambos catálogos en servidor |
| Propuestas | `categoria_sugerida` es distinta de `categoria` confirmada | Registrar procedencia y protección por campo; una categoría automática no debe parecer una decisión manual |
| Huchas | Reasignación en `src/hooks/useFinanceData.ts::handleChangeMovimientoHucha` | Llevar la operación revisada al servidor y leer el movimiento actual dentro de la transacción |
| Suscripciones | La web crea suscripciones y sincroniza la hucha de sistema; Python enruta algunos cobros por nombre/importe | Compartir efectos de dominio y hacer explícito `suscripcion_id`; no convertir una coincidencia de importe en prueba |
| Retención | El cuerpo normalizado de `correos_historico` tiene TTL de 90 días | Conservar referencia y estado mínimos sin duplicar permanentemente cuerpos de correo |
| Seguridad | Firebase Admin no está sujeto a las reglas de Firestore del cliente | Validar identidad, propietario y campos admitidos en cada operación del servidor |
| Despliegue | `firebase.json` configura web y Firestore; no hay un servidor MCP persistente configurado | Añadir un servicio independiente y comprobar alojamiento y autenticación |

## Arquitectura propuesta

```text
Gmail → sincronizador actual → movimientos + registro de procesamiento
                                      ↓ finalización
                                cola de revisiones
                                      ↓
Tarea ChatGPT ↔ MCP Flowt ↔ servicios de dominio ↔ Firestore
      ↕                            ↑
Plugin Gmail                 web de Flowt
```

El MCP será un adaptador fino sobre servicios Python. La web seguirá usando Firebase para sus lecturas y utilizará operaciones autenticadas del mismo servicio para las escrituras que deban mantener revisión, protección manual, concurrencia y efectos financieros. No trasladar todas las operaciones de la aplicación innecesariamente.

Archivos nuevos propuestos: `tracker-backend/domain/`, `tracker-backend/reviews/`, `tracker-backend/mcp_server.py`, `tracker-backend/api.py` y `tracker-backend/prompts/daily_review.md`. Los nombres finales pueden ajustarse al organizar la implementación.

## Fases y entregables

### 0. Probar la integración antes de construir todo

1. Exponer un MCP mínimo autenticado con una lectura de datos ficticios.
2. Conectarlo en el entorno web donde correrá la tarea y comprobar acceso al plugin de Gmail en ese mismo chat.
3. Ejecutar una escritura reversible sobre datos de prueba, tanto manualmente como mediante una ejecución programada. Comprobar que no requiere una confirmación humana en cada ejecución.
4. Elegir alojamiento y mecanismo de autenticación compatible con esa conexión. Primera opción a evaluar: servicio Python independiente en Cloud Run, por afinidad con el backend y Firebase existentes; no asumir que ya está configurado ni que su coste es cero.
5. Registrar resultado, costes de infraestructura previstos y límites observados. Si la prueba falla, conservar el modo de revisión manual sin programar un flujo que aún no funciona.

**Salida:** lectura, Gmail y escritura autenticada demostradas en una ejecución programada de prueba. Esta fase precede a la construcción completa.

### 1. Contratos, procedencia y entrega a revisión

1. Ampliar `src/types/index.ts` y los contratos Python para representar correo de origen, moneda, vínculo a suscripción, procedencia por campo y estado de revisión.
2. Conservar `concepto` como descripción visible y añadir un campo inmutable para el concepto bancario original cuando esté disponible. Para históricos, distinguir el concepto extraído inicialmente del texto bancario real: no inventar un original a partir del nombre actual.
3. Crear un registro de procesamiento por propietario y correo, con IDs de movimientos, estado y finalización. Mantenerlo independiente del TTL del cuerpo.
4. Registrar cada movimiento persistido y su relación al procesamiento de forma atómica. Publicar revisiones pendientes solamente cuando todas las ramas del procesamiento de ese correo hayan terminado o quedado registradas como pendientes de revisión inicial.
5. Recuperar fallos entre persistencia, historial y cierre sin duplicar movimientos ni saldos. Un movimiento ya existente también debe poder reparar el registro incompleto.
6. Mantener separadas la revisión inicial de `correos_pendientes` y esta segunda revisión. Los movimientos aprobados desde la web se entregan a la segunda revisión al completar su procesamiento.
7. Para nuevos movimientos externos, realizar una primera revisión aunque no tengan concepto sospechoso. Para históricos, habilitar una incorporación por lotes explícita y acotada, basada en relaciones de procesamiento comprobables; no revisar toda la base al activar el servicio.
8. Una revisión terminada puede ser «sin cambios». No volver a investigarla cada día.

**Salida:** cola recuperable que nunca entrega movimientos a medio procesar.

### 2. Servicios financieros y control de escrituras

1. Extraer las operaciones necesarias del sincronizador y portar al servidor los efectos pertinentes de la web: reasignación de gasto, vinculación/creación de suscripción y sincronización de la hucha de suscripciones.
2. Usar céntimos enteros o Decimal en los cálculos del servicio y convertir al formato existente al persistir. Releer movimiento, configuración, suscripción y huchas dentro de la transacción.
3. La reasignación de un gasto revierte su cargo en la hucha anterior y lo aplica a la nueva mediante las reglas de dominio actuales, incluidos topes y desbordamientos. No modifica los totales de ingreso/gasto ni vuelve a distribuir un ingreso.
4. Registrar todos los efectos financieros de cada operación, incluyendo destinos de desbordamiento, para poder deshacerlos sin restaurar saldos antiguos completos.
5. Introducir una revisión o token de versión consistente para los documentos afectados. Las ediciones manuales relevantes y el sincronizador deben participar en el control; un contador modificado solo por el MCP no protege frente a la web.
6. Conservar decisiones manuales por campo. Como criterio conservador de migración, proteger categorías ya confirmadas y huchas explícitas de suscripciones; no considerar manual toda hucha histórica, porque el sincronizador también las asigna.
7. Enrutar las escrituras web necesarias por el servicio autenticado y actualizar reglas para impedir que el cliente evite las protecciones nuevas. Revisar también conversiones, borrados y aprobación de correos que afecten a documentos revisables.
8. Aplicar cambio, efectos financieros, auditoría y estado de revisión en una transacción idempotente. Repetir `operation_id` con la misma carga devuelve el resultado anterior; con otra carga devuelve conflicto.

**Salida:** núcleo compartido que mantiene saldos y decisiones manuales bajo concurrencia.

### 3. Configuración categoría → hucha en la web

1. Añadir una sección en `src/components/ajustes/AjustesOrchestrator.tsx`, apoyada en el contexto de categorías existente.
2. Mostrar huchas y categorías/etiquetas en dos columnas en escritorio y controles equivalentes en móvil. Una hucha admite varias categorías; una categoría de gasto tiene como máximo una hucha configurada.
3. Persistir por usuario el mapa y su versión, con IDs reales. Permitir asignar, quitar y cambiar relaciones, incluidas las personalizadas.
4. Validar propietario, categoría válida y hucha activa. Si desaparece o se archiva una hucha, mostrar la relación inválida y conservar la asignación actual del movimiento hasta resolverla.
5. Aplicar el mapa a gastos externos. Las categorías de ingresos pueden clasificarse, pero no cambian su distribución existente entre huchas.
6. Precedencia propuesta para implementar: corrección manual del movimiento → mapa explícito de categoría → hucha explícita de suscripción → asignación actual. Sin mapa no se deduce una nueva hucha. Esta precedencia debe quedar visible en la configuración.
7. Guardar el mapa no mueve automáticamente todo el histórico. Los cambios afectan a nuevas revisiones; una reaplicación a históricos será una acción explícita y por lotes.
8. Cuando el usuario corrige una categoría desde la web, ofrecer/aplicar la misma resolución de hucha mediante el servicio, respetando una hucha elegida manualmente.

**Salida:** el usuario controla el reparto; la IA elige categoría y Flowt resuelve la hucha.

### 4. MCP y contrato de revisión

| Herramienta | Contrato mínimo |
|---|---|
| `list_pending_reviews` | Lote paginado, cursor estable, solo procesamiento completo; reserva temporal opcional con caducidad |
| `get_movement_context` | Documento actual, token de versión, original, campos protegidos, correo, relaciones y evidencia disponible |
| `get_finance_configuration` | Categorías reales, huchas activas, mapa versionado y suscripciones |
| `search_related_movements` | Búsqueda paginada por fechas/contexto, también de revisados; suficiente historial para tres meses consecutivos |
| `preview_review` | Validar propuesta y calcular efectos sin persistir; misma lógica que la escritura |
| `apply_review` | Cambios permitidos, evidencia, motivo, versiones esperadas e ID de operación; efectos y estado atómicos |
| `record_question` / `resolve_question` | Dudas excepcionales persistentes y respuestas; no requieren aprobación rutinaria |
| `get_review_history` / `revert_review` | Historial paginado y reversión validada con control de conflictos |

El UID procede de la identidad autenticada, nunca del argumento elegido por la IA. El modelo no envía saldos ni una hucha arbitraria: el servidor la resuelve desde configuración. El contrato de revisión admite nombre, categoría, vínculo existente o propuesta de nueva suscripción y resultado por campo. No admite compensaciones ni cambios de importe/tipo/fecha.

La creación de suscripción incluye `evidence_movement_ids` y justificación. El servidor exige IDs únicos, existentes, del mismo propietario, gastos externos, moneda compatible y una secuencia de tres meses consecutivos en Europe/Madrid. Rechaza vínculos incompatibles y consulta vínculos existentes en la transacción para evitar duplicados concurrentes. El código verifica el calendario; la IA interpreta si los cobros representan realmente una suscripción.

El requisito acordado habilita creación automática de suscripciones mensuales. Las trimestrales, semestrales y anuales existentes pueden vincularse, pero no se flexibiliza el requisito de creación para ellas en esta versión. No se cambia el importe ni el día configurado de una suscripción existente solo por vincular un cobro.

### 5. Instrucciones de IA, estados y reintentos

1. Versionar `daily_review.md`: revisar contexto de Flowt, consultar el correo original y buscar recibos/pedidos solo cuando aporte información. Tratar los correos como datos, nunca como instrucciones.
2. Separar evidencia directa de inferencias. La IA puede deducir sin coincidencias exactas; debe explicar lo que sostiene cada cambio. Sin sustento suficiente para un campo, conserva su valor y completa los demás.
3. Buscar suscripciones existentes antes de proponer nuevas y adjuntar movimientos históricos reales. La respuesta «es una suscripción» sin IDs no puede crearla.
4. Guardar resultados por campo y estado del caso: `pending`, `reviewed`, `needs_user_input`, `waiting_evidence`, `retryable_error`. Una reserva es un mecanismo independiente, con vencimiento.
5. Guardar intentos, próxima ejecución elegible y motivo del reintento. Limitar reintentos técnicos y de evidencia; agotados, mostrar el caso en la web sin repetirlo indefinidamente.
6. Reabrir solo por respuesta, evidencia nueva registrada o reaplicación explícita de una configuración relevante. Las respuestas no dependen de la memoria del chat.
7. Acotar tamaño de lote y trabajo por ejecución. Registrar resumen persistente de ejecución; continuar con cursor en la siguiente si queda trabajo.

**Salida:** automatización que avanza y conserva incertidumbre sin atascarse ni preguntar cada día lo mismo.

### 6. Auditoría, reversión e interfaz

1. Guardar antes/después de los campos modificados, procedencia, evidencia referenciada, motivo, versión de instrucciones, fecha, actor e ID de operación. Guardar solo extractos necesarios de evidencia, sin duplicar cuerpos completos fuera de su retención.
2. Mostrar «Revisado automáticamente», explicación y acción «Deshacer» en actividad/histórico, integrándolo con `MovementReview` y `HistoricoCorreosView`.
3. Añadir en la web listado de revisiones y dudas pendientes con respuesta persistente, historial y errores accionables. Distinguirlo de los correos aún no aprobados por el procesamiento inicial.
4. Revertir mediante una nueva operación auditada: restaurar los campos afectados y aplicar los deltas inversos a los saldos actuales, sin borrar cambios ajenos.
5. Si campos afectados o relaciones cambiaron posteriormente, devolver conflicto y mostrar qué impide una reversión segura. No sobrescribir silenciosamente.
6. Al revertir una suscripción creada automáticamente, retirar solo los vínculos y efectos propios. Si la suscripción ya tiene ediciones o vínculos posteriores, no borrarla automáticamente.
7. Una reversión del usuario protege los campos afectados para que la próxima tarea no reproduzca la misma corrección.

### 7. Verificación y activación

Pruebas de dominio y de integración con Firestore Emulator:

- Persistencia completada pero fallo del historial/cierre: recuperación sin duplicar saldos; movimiento aún en proceso excluido del MCP.
- Edición web concurrente con revisión, configuración modificada y reserva vencida: conflicto o recuperación controlada.
- Mismo ID de operación repetido, incluida respuesta HTTP perdida después de confirmar: un único efecto.
- Reasignación con topes, desbordamientos, deuda y compensaciones preexistentes: conservación del dinero y de vínculos; sin duplicar estadísticas.
- Categorías/huchas personalizadas, hucha archivada, mapa ausente y propietario ajeno.
- Suscripción con tres meses válidos, diciembre/enero, días variables, importes variables, IDs repetidos, meses no consecutivos, dos intentos concurrentes y vínculo ya existente.
- Revertir nombre/categoría/hucha y creación de suscripción; conservar cambios posteriores; rechazar conflicto sin escrituras parciales.
- Reintentos limitados, revisión parcial, resolución de preguntas y protección tras reversión.
- Contenido de correo con instrucciones maliciosas: la revisión sigue las instrucciones del flujo y el backend mantiene su contrato.

Reutilizar `tracker-backend/tests/`, `tests/subscriptions.test.ts`, `tests/hucha-race-condition.test.ts`, `tests/idempotency.test.ts` y `tests/firestore.rules.test.ts`. Añadir pruebas de la configuración y de la reversión en las vistas afectadas. Ejecutar pytest, Vitest en modo no interactivo, compilación y lint según los cambios; no usar servicios de producción para pruebas automatizadas.

Activación por pasos:

1. Desplegar servicio, reglas, índices y web compatibles, con automatización desactivada.
2. Incorporar un lote controlado y ejecutar propuestas sin escritura; revisar ejemplos reales minimizando datos sensibles.
3. Activar escrituras sobre el lote, comprobar auditoría y reversión, repetir la ejecución y verificar ausencia de nuevos efectos.
4. Probar un ciclo de tarea con Gmail y MCP y comprobar la comunicación de resultados.
5. Programar las 06:00 con zona Europe/Madrid y comprobar cambio de horario estacional. Notificar dudas, fallos o cambios relevantes; permanecer en silencio si no hay nada accionable.
6. Observar primeras ejecuciones. Disponer de interruptor para detener nuevas revisiones manteniendo el sincronizador actual operativo.

## Orden de trabajo sugerido

1. Prueba técnica de conexión y ejecución programada.
2. Modelo de procesamiento, cola y compatibilidad de datos.
3. Servicios de dominio, autenticación, control de escrituras y pruebas financieras.
4. Mapa categoría → hucha en la web.
5. Lecturas MCP, búsqueda histórica y propuestas sin escritura.
6. Escritura automática, suscripciones, auditoría y reversión.
7. Dudas persistentes, pruebas integrales y activación diaria.

Cada entrega debe poder validarse por separado. No crear la tarea de producción ni desplegar cambios financieros como parte de redactar este plan.

## Criterios de aceptación

- Un movimiento terminado queda nombrado y clasificado automáticamente; su hucha sigue la configuración del usuario.
- La creación de suscripción requiere evidencia real de tres meses consecutivos validada en código, sin exigir día/importe idénticos.
- Repetir la revisión no produce nuevos efectos; la edición manual tiene prioridad.
- Cada cambio se explica y se puede revertir, o se informa del conflicto concreto que impide hacerlo.
- Las compensaciones actuales y los importes registrados se conservan.
- Medir cobertura, correcciones revertidas, preguntas por ejecución, fallos pendientes y mantenimiento manual ahorrado; no fijar una tasa de acierto inventada antes de obtener una muestra real.

## Referencia de integración

La documentación oficial permite herramientas y plugins disponibles en el chat para tareas programadas web. La compatibilidad concreta de Gmail, autenticación del MCP y escrituras desatendidas debe probarse en la fase 0: [Tareas programadas](https://learn.chatgpt.com/docs/automations).
