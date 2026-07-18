# Security Policy

## Estado del proyecto

Flowt está en desarrollo y todavía mantiene hallazgos de seguridad abiertos. La rama `main` más reciente es la única versión que recibe correcciones; no se ofrecen garantías de soporte para commits o despliegues anteriores.

Antes de usar datos reales o exponer la aplicación a terceros, revisa los [issues abiertos](https://github.com/Isalvan/flowt/issues) y el [checklist de publicación](docs/PUBLIC_RELEASE_CHECKLIST.md).

## Informar de una vulnerabilidad

No publiques credenciales, datos financieros, correos, tokens ni instrucciones de explotación detalladas en un issue público.

Usa, por este orden:

1. La opción **Report a vulnerability** de la pestaña Security del repositorio, si está habilitada.
2. Un canal privado indicado por el mantenedor en su perfil de GitHub.

Incluye:

- componente y commit afectados;
- condiciones necesarias para reproducir el problema;
- impacto observado;
- pasos mínimos de reproducción o una prueba de concepto inocua;
- mitigación temporal, si existe.

No incluyas datos reales de usuarios. Usa valores ficticios y elimina tokens de capturas y logs.

## Datos y credenciales sensibles

En este proyecto deben tratarse como secretos:

- `serviceAccountKey.json` y cualquier clave privada de Firebase/Google Cloud;
- `token.json` de Gmail OAuth;
- `credentials.json` del cliente OAuth cuando contenga un secreto de cliente;
- `GEMINI_API_KEY`;
- archivos `.env` con valores reales;
- valores de GitHub Actions Secrets;
- logs, exportaciones o volcados con correos, movimientos financieros o identificadores de usuario.

La configuración web `VITE_FIREBASE_*` identifica el proyecto Firebase y suele enviarse al navegador. No debe usarse como barrera de seguridad: el acceso se controla con Authentication, reglas de Firestore, App Check cuando corresponda y configuración del proyecto.

## Si se expone una credencial

1. Revoca o deshabilita la credencial en el proveedor.
2. Crea una credencial nueva y actualiza los despliegues.
3. Revisa logs de acceso, IAM, ejecuciones de Actions y cambios de datos desde el momento de exposición.
4. Elimina el valor de la rama actual y, si procede, reescribe el historial con coordinación previa.
5. Revisa forks, clones, cachés, releases, artefactos, logs, issues y pull requests: reescribir Git no borra copias externas.
6. Documenta el incidente sin volver a publicar el secreto.

Considera comprometida una credencial que haya llegado a un commit, aunque ese commit ya no esté en `main`.

## Alcance

Son especialmente relevantes los problemas que permitan:

- leer o modificar datos financieros de otro usuario;
- ejecutar acciones sin autenticación o saltarse reglas de Firestore;
- inyectar contenido activo en la interfaz;
- manipular movimientos mediante correos, prompts o respuestas del modelo;
- extraer credenciales desde código, historial, Actions o artefactos;
- duplicar o alterar transacciones en condiciones concurrentes;
- enviar datos personales a terceros sin la configuración o información esperadas.
