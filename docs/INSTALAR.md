# Monta tu propio Flowt

Esta guía es para quien quiere su propio Flowt, con sus datos, sin saber programar. Un asistente hace casi todo: tú solo creas un par de cuentas, haces clic donde te diga y pegas alguna clave.

**Qué tendrás al terminar:** tu Flowt en una dirección propia (`https://tu-proyecto.web.app`), en el que solo puede entrar tu cuenta de Google. Después puedes añadir, si quieres, el lector de tickets, la app de Android, la publicación automática desde GitHub y la lectura de los correos del banco.

**Cuánto cuesta:** nada para un uso personal. Firebase, Cloudflare, Gemini y GitHub tienen planes gratuitos de sobra para una persona. No hace falta tarjeta.

**Cuánto tarda:** unos 20 minutos lo básico; cada parte opcional, entre 5 y 15 minutos más.

## 1. Lo que necesitas instalar

| Programa | Para qué | Dónde |
|---|---|---|
| **Node.js 22 o más nuevo** (versión LTS) | Ejecutar el asistente y compilar la web | [nodejs.org](https://nodejs.org) |
| **Git** | Descargar el código | [git-scm.com](https://git-scm.com/downloads) |
| **GitHub CLI** *(opcional)* | Publicación automática y app de Android | [cli.github.com](https://cli.github.com) |
| **Java 21** *(opcional)* | Solo para la app de Android | [adoptium.net](https://adoptium.net) |
| **Python 3.11 o más nuevo** *(opcional)* | Solo para leer los correos del banco | [python.org](https://www.python.org/downloads/) |

Instálalos con las opciones por defecto. En Windows, cierra y vuelve a abrir la terminal después de instalar, para que los encuentre.

Y estas cuentas, todas gratuitas:

- Una **cuenta de Google** (la que usarás para entrar en Flowt).
- Una **cuenta de GitHub**, si quieres tu propia copia del código en internet ([github.com/signup](https://github.com/signup)).
- Una **cuenta de Cloudflare**, solo para el lector de tickets ([dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)).

## 2. Haz tu copia del código

1. Entra en [github.com/Isalvan/flowt](https://github.com/Isalvan/flowt) y pulsa **Fork** → **Create fork**. Ahora tienes `github.com/TU_USUARIO/flowt`.
2. Abre una terminal (en Windows, *PowerShell*; en Mac, *Terminal*) y escribe, cambiando `TU_USUARIO`:

   ```bash
   git clone https://github.com/TU_USUARIO/flowt
   cd flowt
   ```

Si no quieres usar GitHub, también vale descargar el código como ZIP (botón **Code → Download ZIP**), descomprimirlo y abrir la terminal en esa carpeta. Lo único que no tendrás es la publicación automática.

## 3. Lanza el asistente

Dentro de la carpeta `flowt`:

```bash
npm run setup
```

El asistente va paso a paso y te explica cada uno. Esto es lo que pasará:

1. **Comprobar lo necesario.** Instala lo que Flowt necesita. La primera vez tarda unos minutos.
2. **Entrar en Firebase.** Se abre el navegador: elige tu cuenta de Google y acepta. Firebase es el servicio de Google que guarda tus datos y publica la web.
3. **Proyecto de Firebase.** Pulsa Intro para crear uno nuevo con el nombre que te propone, o escribe el tuyo. Después elige dónde se guardan los datos: `eur3` si vives en Europa.
   - Si es la primera vez que usas Firebase, puede que no le deje crearlo y te abra la consola. Allí pulsa **Crear un proyecto**, acepta las condiciones, desactiva Google Analytics y, al terminar, escribe en la terminal el ID del proyecto (aparece bajo el nombre).
4. **Registrar la web.** Automático.
5. **Activar el inicio de sesión con Google.** Es el único clic que Firebase no deja hacer desde fuera. En la página que se abre: **Comenzar** → **Google** → **Habilitar** → elige tu correo en *correo de asistencia* → **Guardar**. Vuelve a la terminal y pulsa Intro.
6. **Publicar.** Automático. Al terminar, tu Flowt ya está en internet.
7. **Tu cuenta como la única permitida.** Flowt es privado: solo entran las cuentas de una lista. Abre tu Flowt, pulsa **Continuar con Google** y verás que no te deja entrar. Es normal. Vuelve a la terminal y pulsa Intro: el asistente encuentra tu cuenta, la añade a la lista y vuelve a publicar. Ya puedes entrar.

Con esto ya tienes Flowt funcionando. Lo que sigue es opcional y puedes decir que no y hacerlo otro día con `npm run setup`.

8. **Lector de tickets y asistentes** *(Cloudflare + Gemini)*. Te pedirá:
   - Una **clave de la cuenta de servicio** de Firebase: en la página que se abre, **Generar nueva clave privada**. Se descarga un `.json`; arrástralo a la terminal y pulsa Intro.
   - Una **clave de Gemini**: en [AI Studio](https://aistudio.google.com/apikey), **Create API key**, cópiala y pégala.
   - Entrar en **Cloudflare** desde el navegador. Si te pide elegir un subdominio `workers.dev`, pon el que quieras.
9. **App de Android.** Crea la clave con la que se firma la app y la registra en Firebase. El nombre del paquete que te propone sirve; no lo cambies después.
10. **Publicar desde GitHub.** Guarda en tu repositorio de GitHub las claves para que cada cambio se publique solo y se compile el APK de Android. Al final te ofrece subir tu configuración (*commit + push*): di que sí. Si tu copia es un fork, entra una vez en la pestaña **Actions** de tu repositorio y pulsa el botón verde para activarlas.
11. **Correos del banco** *(el más largo)*. Flowt puede apuntar tus gastos solo, leyendo los avisos que te manda el banco por correo. El asistente te lleva por la consola de Google Cloud para activar Gmail y crear un permiso de solo lectura. Cuando la pantalla de consentimiento lo ofrezca, pulsa **Publicar app**: si se queda en *Prueba*, Google retira el permiso cada 7 días. Al dar permiso, Google avisará de que la app no está verificada: **Configuración avanzada → Ir a…**. La app es tuya; nadie más la usa.

Al terminar, el APK de Android aparece en `github.com/TU_USUARIO/flowt/releases/tag/android`. Ábrelo desde el móvil para instalarlo.

## Dónde se guarda cada cosa

| Archivo o carpeta | Qué es | ¿Se sube a GitHub? |
|---|---|---|
| `flowt.config.json` | La configuración de tu Flowt: proyecto, direcciones, cuentas permitidas. Nada secreto. | Sí |
| `.env.local` | La configuración pública de la web de Firebase, para compilar en tu ordenador. | No |
| `.flowt-setup/` | **Tus claves**: cuenta de servicio, clave de firma de Android y su contraseña, clave de Gemini. | No |

**Haz una copia de `.flowt-setup/`** en un sitio seguro (un USB, tu gestor de contraseñas). Sin la clave de firma no podrás actualizar la app de Android instalada, y el resto se puede volver a generar pero cuesta.

## Cambiar algo más adelante

- **Volver a ejecutar el asistente:** `npm run setup`. Detecta lo que ya está hecho y te deja saltarlo.
- **Dar acceso a otra cuenta:** que intente entrar, ejecuta `npm run setup` y en el paso de *cuentas permitidas* responde que sí y elige las dos.
- **Cambiar la configuración a mano:** edita `flowt.config.json` y ejecuta `npm run config:apply`. Ese comando copia los valores a todos los archivos que los necesitan (reglas de Firestore, Worker, app de Android...). Después publica con `npx firebase deploy --only firestore,hosting` o sube el cambio a GitHub.
- **Traer las novedades de Flowt:** en tu fork de GitHub, **Sync fork → Update branch**. Si hay conflicto en `flowt.config.json` o en los archivos que genera, quédate con tus valores y ejecuta `npm run config:apply`.

### Los campos de `flowt.config.json`

| Campo | Qué es |
|---|---|
| `firebaseProjectId` | El ID de tu proyecto de Firebase. |
| `firestoreLocation` | Dónde se guardan los datos (`eur3`, `nam5`...). Solo cuenta la primera vez que se publica. |
| `appUrl` | La dirección de tu Flowt, sin barra final. |
| `workerUrl` | La dirección del Worker de Cloudflare (lector de tickets y asistentes). Vacío si no lo usas. |
| `androidAppId` | El paquete de la app de Android. No lo cambies una vez instalada. |
| `allowedUids` | Las cuentas que pueden entrar (sus UID de Firebase). |

## Si algo falla

| Lo que ves | Qué hacer |
|---|---|
| `npm` no se reconoce | Instala Node.js y abre una terminal nueva. |
| En PowerShell: *la ejecución de scripts está deshabilitada* | Escribe `npm.cmd run setup` en lugar de `npm run setup`. |
| *No se pudo crear* el proyecto | Créalo desde [la consola de Firebase](https://console.firebase.google.com/) como se explica en el paso 3 y escribe su ID. |
| En el paso 7 *todavía no veo a nadie* | Entra en tu Flowt con Google (aunque te diga que no tienes acceso) y vuelve a pulsar Intro. |
| No te deja entrar en Flowt después del paso 7 | Recarga la página. Si sigue, ejecuta `npm run setup` y repite el paso de cuentas permitidas. |
| El login de Google falla con *operation-not-allowed* | No se activó Google en el paso 5. Repite ese paso. |
| La app de Android se cierra al iniciar sesión | Repite el paso de Android unos minutos después de activar Google, y otra vez el de GitHub. |
| Los workflows de GitHub fallan en rojo | Mira el paso en rojo: dice qué variable o secreto falta. Ejecuta `npm run setup` y haz el paso de GitHub. |
| El lector de correos dejó de funcionar a la semana | La pantalla de consentimiento quedó en *Prueba*. Publícala y repite el paso de correos. |

Cualquier paso se puede repetir: el asistente sigue donde lo dejaste.

## Para quien sabe un poco más

El asistente es `scripts/setup.mjs` y usa las herramientas de siempre: Firebase CLI (del propio repositorio), Wrangler, GitHub CLI y `keytool`. El detalle de cada pieza está en [DEPLOYMENT.md](DEPLOYMENT.md) (Hosting, GitHub Actions, sincronizador), [ANDROID.md](ANDROID.md) y [mcp-daily-review-operation.md](mcp-daily-review-operation.md) (Worker). Un test (`tests/flowt-config.test.ts`) comprueba que los archivos generados coinciden con `flowt.config.json`.
