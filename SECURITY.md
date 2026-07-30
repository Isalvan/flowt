# Security Policy

## Versiones compatibles

Flowt se desarrolla de forma continua. Las correcciones de seguridad se aplican sobre la rama `main`.

| Versión | Soporte |
|---|---|
| Último commit de `main` | Sí |
| Commits y despliegues anteriores | No |

## Informar de una vulnerabilidad

No abras un issue público con detalles de una vulnerabilidad sin corregir.

Cuando el repositorio público tenga habilitado **Private vulnerability reporting**, utiliza **Security → Advisories → Report a vulnerability**. Si el botón no aparece, el proyecto no tiene todavía un canal privado de seguridad publicado; no envíes detalles sensibles mediante issues o discusiones.

Incluye:

- componente y commit afectados;
- descripción del impacto;
- condiciones y pasos mínimos de reproducción;
- prueba de concepto con datos ficticios;
- mitigación propuesta, si existe.

No incluyas credenciales, correos, movimientos financieros ni datos personales reales.

## Proceso de respuesta

El mantenedor revisará el alcance, reproducirá el comportamiento y coordinará la corrección antes de publicar los detalles. La severidad tendrá en cuenta el impacto, los privilegios necesarios, la complejidad de explotación y la exposición de datos.

Cuando corresponda, la resolución incluirá:

- corrección en la rama mantenida;
- pruebas de regresión;
- rotación de credenciales afectadas;
- aviso de seguridad con versiones o commits impactados;
- atribución al investigador que lo solicite.

## Datos sensibles

Se consideran secretos o datos sensibles:

- claves privadas y cuentas de servicio de Firebase o Google Cloud;
- `token.json` de Gmail OAuth;
- secretos del cliente OAuth;
- claves de Gemini;
- archivos `.env` con valores reales;
- GitHub Actions Secrets;
- correos, movimientos financieros e identificadores de usuario;
- logs, exportaciones y artefactos que contengan estos valores.

La configuración web `VITE_FIREBASE_*` identifica el proyecto y se distribuye al navegador. Los controles de acceso deben implementarse mediante Firebase Authentication, reglas de Firestore y la configuración del proyecto.

## Credencial expuesta

Si una credencial aparece en Git, logs, artefactos o metadatos públicos:

1. Revócala en el proveedor.
2. Genera una credencial nueva.
3. Actualiza los entornos que la utilizan.
4. Revisa accesos y cambios realizados durante el periodo de exposición.
5. Elimina el valor de las superficies afectadas.
6. Documenta el incidente sin reproducir el secreto.

Eliminar el valor del último commit no invalida una credencial ni elimina copias anteriores.
