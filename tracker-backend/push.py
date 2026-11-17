"""Avisos push a los móviles del propietario (app Android de Flowt) mediante FCM.

La app guarda el token de cada móvil en push_tokens/{uid}/devices/{id}. Un aviso que falla
nunca debe parar el tracker: los errores se registran y se sigue.
"""
import logging
from typing import Any, Callable, Dict, Iterable, List, Optional

from firebase_admin import messaging

logger = logging.getLogger(__name__)

# Debe coincidir con AndroidManifest.xml y src/native/push.ts.
CHANNEL_ID = "movimientos"
MAX_BODY = 240


def format_amount(amount: float) -> str:
    """1234.5 -> '1.234,50 €', como en la web."""
    text = f"{abs(amount):,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return f"{text} €"


def notification_text(movements: List[Dict[str, Any]]) -> Optional[tuple]:
    """Título y cuerpo del aviso, o None si no hay nada que contar."""
    visible = [m for m in movements if not m.get("es_interno")]
    if not visible:
        return None
    if len(visible) == 1:
        m = visible[0]
        kind = "Ingreso" if m.get("tipo") == "ingreso" else "Gasto"
        concept = str(m.get("concepto") or "Sin concepto").strip()
        return f"{kind} de {format_amount(float(m.get('importe') or 0))}", concept[:MAX_BODY]
    parts = []
    for m in visible:
        sign = "+" if m.get("tipo") == "ingreso" else "−"
        parts.append(f"{sign}{format_amount(float(m.get('importe') or 0))} {str(m.get('concepto') or '').strip()}".strip())
    body = " · ".join(parts)
    if len(body) > MAX_BODY:
        body = body[: MAX_BODY - 1].rstrip() + "…"
    return f"{len(visible)} movimientos nuevos", body


def _is_dead_token(error: Optional[Exception]) -> bool:
    return isinstance(error, (messaging.UnregisteredError, messaging.SenderIdMismatchError)) or (
        getattr(error, "code", None) == "INVALID_ARGUMENT" and "token" in str(error).lower()
    )


def notify_new_movements(
    db,
    owner_id: str,
    movements: Iterable[Dict[str, Any]],
    send: Callable[[List[messaging.Message]], Any] = messaging.send_each,
) -> int:
    """Avisa a cada móvil del propietario de los movimientos recién guardados.

    Devuelve cuántos avisos se entregaron a FCM. Borra los tokens que FCM da por muertos
    (app desinstalada o token sustituido) para no volver a intentarlo.
    """
    text = notification_text(list(movements))
    if not text:
        return 0
    title, body = text
    devices = []
    for snapshot in db.collection("push_tokens").document(owner_id).collection("devices").stream():
        token = (snapshot.to_dict() or {}).get("token")
        if isinstance(token, str) and token:
            devices.append((snapshot, token))
    if not devices:
        return 0

    messages = [
        messaging.Message(
            token=token,
            notification=messaging.Notification(title=title, body=body),
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    channel_id=CHANNEL_ID,
                    # En la pantalla de bloqueo, sin importes ni conceptos.
                    visibility="private",
                ),
            ),
            data={"tipo": "movimientos"},
        )
        for _, token in devices
    ]
    response = send(messages)
    for (snapshot, _), result in zip(devices, response.responses):
        if result.success:
            continue
        if _is_dead_token(result.exception):
            snapshot.reference.delete()
            logger.info("Removed a push token that FCM no longer accepts.")
        else:
            logger.warning(f"Push notification failed: {result.exception}")
    return response.success_count
