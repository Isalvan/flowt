# Flowt

[English](README.md) · [Español](README.es.md)

Flowt es una aplicación de finanzas personales que transforma notificaciones bancarias recibidas por Gmail en movimientos estructurados, los organiza en Firestore y los presenta en un panel web moderno y responsivo.

## Características

- **Sincronización automática multibanco** para Unicaja, Revolut, BBVA, Santander, CaixaBank, ING, Sabadell y N26 mediante el alcance `gmail.modify`.
- **Extracción inteligente de movimientos**, con redacción previa de PII antes de procesarlos con Gemini.
- **Panel de salud financiera** con una puntuación de 0 a 100 basada en ahorro, carteras, flujo de caja y suscripciones.
- **Filtrado por entidad**, revisión manual idempotente, carteras, objetivos y suscripciones compartidas.
- **Exportación CSV segura** protegida contra inyección de fórmulas.
- **Seguridad y privacidad avanzada** con reglas estrictas de Firestore, retención TTL de 90 días y cabeceras CSP y HSTS.

## Arquitectura

Flowt se divide en un frontend React en `src/` y un sincronizador Python en `tracker-backend/`:

```text
Gmail → Sincronizador Python → Gemini AI → Firestore → Aplicación web
```

Consulta la [guía de arquitectura](docs/ARCHITECTURE.md) y la [guía de despliegue](docs/DEPLOYMENT.md).

## Demo

![Demo de Flowt](media/flowt-demo.gif)

## Desarrollo local

```bash
npm install
npm run dev
```

La configuración del backend está documentada en la [guía del backend](tracker-backend/README.md).

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Despliegue](docs/DEPLOYMENT.md)
- [Backend](tracker-backend/README.md)
- [Contribuir](CONTRIBUTING.md)
- [Política de seguridad](SECURITY.md)
- [Soporte](SUPPORT.md)
- [English](README.md)

## Licencia

Flowt se distribuye bajo la [licencia MIT](LICENSE). Copyright (c) 2026 Isalvan.
