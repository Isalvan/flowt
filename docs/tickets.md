# Tickets: de la foto al gasto, y reparto entre personas

Con **Escanear ticket** (en el panel, junto a **Añadir movimiento**, y en el menú de más acciones) se abre la cámara del móvil. Flowt lee la foto y muestra en una sola pantalla el comercio, la fecha, el total, la categoría propuesta y las líneas del ticket, todo ya rellenado. En el caso normal basta con pulsar **Guardar gasto**.

## Qué hace

- **Gasto nuevo**: se guarda por defecto en efectivo (cartera de metálico automática), porque los pagos con tarjeta ya llegan por correo del banco. La cartera se puede cambiar en el desplegable plegado.
- **Gasto que ya está en Flowt**: si hay un gasto con el mismo importe (±0,01 €), a tres días o menos y sin ticket, aparece **Ya está en Flowt** y la acción principal pasa a ser **Añadir el detalle a ese gasto**. Solo se añade el campo `ticket`; no se crea otro movimiento ni cambian importes o saldos. **Es otro gasto** ignora esa coincidencia. Si varios gastos encajan, gana el que tiene el nombre del comercio en el concepto.
- **Edición rápida**: la cabecera y cada línea se corrigen con un toque. Si las líneas no suman el total (descuentos globales o redondeos), se avisa y la diferencia se reparte en proporción.
- **Repartir entre personas** (apagado por defecto): «Yo» siempre está; se añaden nombres (se sugieren los 12 últimos usados en este dispositivo). Cada línea muestra las iniciales para asignarla; una línea sin asignar es de **Todos**, así que repartir a partes iguales no requiere ningún toque. Al elegir una persona arriba, cada toque en una línea se la asigna. El pie muestra en vivo lo que corresponde a cada uno, calculado en céntimos y con suma exacta igual al total. **Compartir** envía un resumen («Ticket Mercadona (17/11): Ana 12,30 €, Luis 8,10 €. Total 23,45 €») o lo copia si el navegador no permite compartir.
- **En el movimiento**: un gasto con ticket muestra **Ver ticket** con las líneas y, si se repartió, **Te deben**, con tachado quien ya ha pagado.
- **Bizum de vuelta**: cuando llega un ingreso con la parte de una persona, Flowt propone vincularlo al gasto (ver [movement-suggestions.md](movement-suggestions.md)).

Si la lectura falla, la misma pantalla ofrece **Reintentar** o **Escribirlo a mano**. En modo demo, o sin `VITE_REVIEW_API_URL`, se usa un ticket de ejemplo fijo para probar todo el flujo sin enviar fotos.

## Privacidad

- La foto se reduce en el navegador (1600 px de lado mayor, JPEG) y se envía a `POST /api/tickets/scan`, que la manda a **Gemini** para extraer los datos. Ni la web ni el servicio la guardan, y no se registra en los logs.
- En Firestore solo se guarda el detalle del ticket dentro del gasto: comercio, descripciones e importes de las líneas y, si hay reparto, los nombres y la parte de cada persona.
- Los nombres recientes se guardan solo en el `localStorage` del dispositivo (`flowt:ticket-people:<uid>`).

## Límites

- Solo cuentas permitidas, con sesión de Firebase. Cuerpo de hasta 2 MB y 10 escaneos por minuto por usuario.
- Totales entre 0,01 € y 10 000 €, hasta 150 líneas y 12 personas; descripciones de hasta 120 caracteres. Si la fecha es futura o ilegible, se propone la de hoy, que se puede cambiar.
- La lectura depende del modelo y de la foto: un ticket arrugado, cortado o con poca luz puede leerse mal. Revisa el total antes de guardar.
- El reparto es informativo: el importe del gasto sigue siendo el total y no se mueven saldos entre carteras.

## Despliegue

Ver [DEPLOYMENT.md](DEPLOYMENT.md#escaneo-de-tickets-worker-y-flask): secreto `GEMINI_API_KEY` del Worker, `TICKET_AI_MODEL` opcional y despliegue de las reglas de Firestore que admiten el campo `ticket`.
