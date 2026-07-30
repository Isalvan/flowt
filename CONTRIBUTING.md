# Contribuir a Flowt

Gracias por contribuir. Estas pautas mantienen los cambios revisables y coherentes con la arquitectura del proyecto.

## Antes de empezar

- Busca issues y pull requests existentes para evitar trabajo duplicado.
- Para cambios relevantes, abre primero un issue describiendo el problema y la propuesta.
- No publiques vulnerabilidades en issues; sigue [SECURITY.md](SECURITY.md).
- No incluyas credenciales, correos ni datos financieros reales.

## Configuración local

### Frontend

```bash
npm install
npm run dev
```

### Backend

```bash
cd tracker-backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Utiliza un proyecto de Firebase de desarrollo y datos ficticios.

## Flujo de trabajo

1. Crea una rama desde `main`.
2. Limita el cambio a una responsabilidad concreta.
3. Añade o actualiza pruebas cuando cambie el comportamiento.
4. Actualiza la documentación relacionada.
5. Ejecuta las comprobaciones locales.
6. Abre un pull request utilizando la plantilla del repositorio.

Nombres de rama recomendados:

- `feat/descripcion`
- `fix/descripcion`
- `docs/descripcion`
- `refactor/descripcion`
- `test/descripcion`

## Comprobaciones

```bash
npm run lint
npm test
npm run build
python -m pytest tracker-backend
```

## Estilo

- Mantén TypeScript en modo estricto y evita `any` salvo justificación.
- Reutiliza tipos y utilidades existentes.
- Conserva la separación entre componentes, hooks y acceso a datos.
- Valida entradas externas en los límites del sistema.
- Escribe mensajes y documentación orientados al usuario en español.
- Mantén nombres técnicos, APIs y código en el idioma utilizado por el módulo.

## Commits

Utiliza mensajes breves en modo imperativo. Se recomienda el formato Conventional Commits:

```text
feat: añade filtro por categoría
fix: valida el importe antes de guardar
docs: actualiza la guía de despliegue
```

## Pull requests

Un pull request debe incluir:

- problema que resuelve;
- solución aplicada;
- impacto y riesgos;
- instrucciones de verificación;
- capturas para cambios visuales;
- issues relacionados.

El autor debe resolver los comentarios de revisión y mantener la rama actualizada. Los cambios se integran cuando las comprobaciones requeridas pasan y la revisión ha sido aprobada.
