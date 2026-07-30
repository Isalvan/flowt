# Arquitectura

## Visión general

Flowt separa la experiencia web del proceso que transforma correos bancarios en datos financieros.

```text
┌──────────┐   OAuth   ┌────────────────────┐
│  Gmail   │ ────────→ │ Sincronizador Python│
└──────────┘            └─────────┬──────────┘
                                  │
                                  ├──→ Gemini
                                  │
                                  ▼
┌──────────┐  Firebase SDK  ┌────────────┐
│ React PWA│ ←────────────→ │ Firestore  │
└────┬─────┘                └────────────┘
     │
     └── Firebase Authentication
```

## Frontend

El frontend se encuentra en `src/` y utiliza React, TypeScript y Vite.

### Capas principales

- `src/components/`: vistas y componentes de interfaz organizados por dominio.
- `src/hooks/useFinanceData.ts`: suscripciones a Firestore y operaciones financieras.
- `src/context/PrivacyContext.tsx`: estado de privacidad visual.
- `src/utils/`: reglas reutilizables para movimientos y suscripciones.
- `src/types/`: contratos TypeScript compartidos.
- `src/firebase.ts`: inicialización del SDK web de Firebase.

Firebase Authentication establece la identidad del usuario. Las consultas y escrituras incluyen el UID propietario y las reglas de Firestore aplican el aislamiento en el servidor.

## Sincronizador

El backend se encuentra en `tracker-backend/`.

- `main.py`: orquestación del ciclo de sincronización y persistencia.
- `gmail_client.py`: autenticación OAuth, búsqueda y lectura de mensajes.
- `ai_parser.py`: extracción estructurada mediante Gemini.
- `fallback_logic.py`: tratamiento alternativo cuando la extracción principal no produce un resultado utilizable.
- `manual/`: utilidades de migración o mantenimiento.
- `tests/`: pruebas del backend.

El proceso utiliza Gmail en modo de solo lectura. Los mensajes se filtran, normalizan y convierten en movimientos. Los resultados que requieren confirmación se guardan para revisión manual.

## Modelo de datos

Las colecciones principales de Firestore son:

| Colección | Propósito |
|---|---|
| `movimientos` | Ingresos, gastos y transferencias |
| `huchas` | Carteras, objetivos y reglas de reparto |
| `suscripciones` | Gastos recurrentes |
| `correos_pendientes` | Mensajes pendientes de revisión |
| `correos_historico` | Resultado e historial de procesamiento |
| `stats` | Agregados por UID de usuario |

Los documentos de dominio incluyen `id_propietario` o utilizan el UID como identificador cuando corresponde.

## Flujo de sincronización

1. GitHub Actions o una ejecución local inicia `main.py`.
2. El cliente OAuth consulta Gmail con el filtro configurado.
3. El contenido se normaliza y se entrega al parser.
4. El parser produce datos estructurados.
5. La aplicación valida el resultado y decide entre persistencia automática y revisión manual.
6. Firestore actualiza movimientos, carteras, estadísticas e historial.
7. El frontend recibe los cambios mediante listeners en tiempo real.

## Límites de confianza

- Gmail, el HTML del correo y su remitente son entradas externas.
- La respuesta del modelo es una entrada no confiable hasta ser validada.
- Firebase Admin opera con IAM y no con las reglas del SDK cliente.
- El frontend no conserva secretos administrativos.
- GitHub Actions reconstruye credenciales efímeras desde su almacén de secretos.

## Decisiones de diseño

- Frontend y sincronizador pueden desplegarse de forma independiente.
- La configuración se suministra mediante variables de entorno.
- Los archivos de credenciales locales no forman parte del repositorio.
- La revisión manual conserva los casos ambiguos fuera del flujo automático.
- Las operaciones financieras reutilizan utilidades de dominio para mantener reglas coherentes.
