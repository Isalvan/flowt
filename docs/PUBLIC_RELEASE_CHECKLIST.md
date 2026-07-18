# Checklist para publicar Flowt

Este checklist separa dos decisiones distintas:

1. hacer público el código;
2. desplegar una aplicación que procese datos reales.

La segunda exige más controles que la primera. Completa y documenta cada punto antes de cambiar la visibilidad o aceptar usuarios externos.

## 1. Credenciales e historial

- [ ] Ejecutar un detector de secretos sobre todas las referencias, no solo sobre `main`.
- [ ] Revisar manualmente patrones propios de Google/Firebase, claves privadas, OAuth, JWT, URLs con tokens y archivos de entorno.
- [ ] Inspeccionar commits huérfanos o referencias antiguas que sigan accesibles.
- [ ] Revisar tags y ramas remotas.
- [ ] Revocar y reemplazar cualquier credencial encontrada; no basta con borrar el archivo.
- [ ] Confirmar que `.env`, `credentials.json`, `token.json` y `serviceAccountKey.json` siguen ignorados.

Ejemplos de comprobación en un clon completo:

```bash
git fetch --all --tags --prune
gitleaks git --log-opts="--all" --redact --verbose
trufflehog git file://$(pwd) --only-verified
```

Un resultado limpio reduce el riesgo de exposición conocida, pero ningún escáner cubre todos los formatos ni todas las superficies.

## 2. Superficies de GitHub fuera de Git

- [ ] Revisar cuerpos y comentarios de issues y pull requests.
- [ ] Eliminar enlaces personales o de sesiones de herramientas que no deban ser públicos.
- [ ] Revisar logs y resúmenes de GitHub Actions.
- [ ] Revisar artefactos de workflows y cachés descargables.
- [ ] Revisar releases y sus adjuntos.
- [ ] Revisar snippets, imágenes y archivos adjuntos.
- [ ] Confirmar que los issues de seguridad no revelan detalles explotables mientras el fallo siga abierto.

Cambiar la visibilidad del repositorio también puede hacer visibles metadatos que no forman parte del árbol Git.

## 3. Bloqueos de seguridad del código

- [ ] Resolver y verificar el XSS almacenado en el historial de correo.
- [ ] Validar remitente, contenido del correo y salida del modelo antes de persistir datos.
- [ ] Sustituir el PIN visual por controles coherentes con su objetivo o documentarlo solo como privacidad de pantalla.
- [ ] Exigir autenticación en todos los endpoints desplegables.
- [ ] Actualizar dependencias vulnerables y eliminar dependencias de servidor innecesarias del frontend.
- [ ] Endurecer reglas de Firestore y proteger campos de integridad.
- [ ] Aplicar mínimos permisos y credenciales de corta duración en CI/CD.
- [ ] Configurar CSP y cabeceras HTTP de seguridad.
- [ ] Neutralizar fórmulas al exportar CSV.
- [ ] Definir minimización, retención y borrado de datos enviados al proveedor de IA.
- [ ] Probar idempotencia y concurrencia de la aprobación manual.

Los detalles y criterios de aceptación están en los issues de la auditoría del repositorio.

## 4. Firebase y Google Cloud

- [ ] Usar proyectos separados para desarrollo y producción.
- [ ] Aplicar y probar las reglas de Firestore con emulador y pruebas negativas entre usuarios.
- [ ] Revisar IAM de la cuenta de servicio y retirar roles amplios.
- [ ] Restringir claves de API por API, aplicación y entorno cuando sea compatible.
- [ ] Configurar dominios OAuth autorizados y usuarios de prueba/producción.
- [ ] Revisar cuotas, presupuestos y alertas.
- [ ] Evaluar App Check como señal adicional; no sustituye Authentication ni las reglas.
- [ ] Definir eliminación de cuenta y datos.

## 5. GitHub Actions

- [ ] Declarar `permissions` mínimos en cada workflow.
- [ ] Fijar acciones de terceros a commits revisados o a una política de versiones controlada.
- [ ] Usar entornos con aprobación para producción.
- [ ] Evitar que procesos no confiables puedan imprimir secretos.
- [ ] Preferir identidad federada o credenciales de corta duración cuando el proveedor lo admita.
- [ ] Rotar los secretos actuales antes de la publicación si existe cualquier duda sobre su exposición.
- [ ] Verificar que el workflow falla de forma segura cuando falta un secreto.

## 6. Aplicación pública

- [ ] Servir exclusivamente por HTTPS.
- [ ] Configurar CSP, HSTS, `X-Content-Type-Options`, política de referrer y permisos del navegador.
- [ ] Verificar aislamiento entre dos cuentas reales de prueba.
- [ ] Probar entradas hostiles de correo, HTML, Markdown, CSV y respuestas de IA.
- [ ] Evitar datos reales en demos, telemetría, errores y capturas.
- [ ] Publicar política de privacidad, términos aplicables y mecanismo de soporte.
- [ ] Definir copias de seguridad, restauración, respuesta a incidentes y monitorización.
- [ ] Confirmar que el modelo de IA y la región elegidos son compatibles con la política de datos prevista.

## 7. Calidad y entrega

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `python -m pytest tracker-backend`
- [ ] Revisión manual del diff final.
- [ ] Protección de `main`, revisión obligatoria y checks requeridos.
- [ ] Dependabot y análisis de código/secretos configurados según las funciones disponibles en la cuenta.
- [ ] Añadir una licencia si se desea permitir reutilización del código.

## Criterio de salida

El repositorio puede considerarse candidato a publicación cuando no queden secretos vigentes en Git ni en las superficies públicas asociadas, los bloqueos de seguridad estén corregidos y verificados, y la documentación describa con precisión las limitaciones restantes.

El despliegue para terceros requiere además pruebas de aislamiento, controles operativos, política de datos y un plan de respuesta a incidentes.
