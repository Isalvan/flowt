# Flowt para Android

La app de Android es la misma web de Flowt metida en una app nativa con [Capacitor](https://capacitorjs.com). Hay un solo código: lo que se cambia en `src/` llega a la web y a la app. El proyecto nativo vive en `android/` y la configuración en `capacitor.config.ts`.

## Qué añade la app frente a la web

| Función | Cómo funciona |
| --- | --- |
| Inicio de sesión con Google | Google no deja iniciar sesión dentro de una web view, así que la app pide la cuenta a Android (Credential Manager) y entrega el token al SDK web de Firebase (`src/native/googleSignIn.ts`). La sesión es la misma que en la web. |
| Cámara para tickets | El botón de ticket abre la cámara de Android (`src/native/camera.ts`) y la foto entra en el mismo lector de tickets. |
| Compartir a Flowt | Desde la galería, WhatsApp o cualquier app: *Compartir → Leer ticket en Flowt*. La foto se abre en el lector de tickets en cuanto la sesión está iniciada y desbloqueada (`ShareTargetPlugin.java` y `src/native/shareTarget.ts`). |
| Avisos de movimientos | Al iniciar sesión, la app pide permiso de notificaciones y guarda el token FCM del móvil en `push_tokens/{uid}/devices`. El tracker (`tracker-backend/push.py`) avisa de cada gasto o ingreso nuevo que lee del banco. En la pantalla de bloqueo el aviso no muestra importes. Al cerrar sesión se borra el token. |
| Compartir desde Flowt | El reparto de un ticket, el Wrapped o la imagen del flujo de dinero abren la hoja de compartir de Android (`src/native/webShare.ts`). |
| Botón atrás | Cierra la hoja o el modal abierto, luego vuelve atrás y, si no queda nada, minimiza la app. |

La app no usa el service worker: sus archivos van dentro del APK y se actualiza instalando un APK nuevo.

## Instalarla en el móvil

Cada vez que algo entra en `main`, el workflow **Flowt Android** compila un APK firmado y lo publica como la pre-release [`android`](https://github.com/Isalvan/flowt/releases/tag/android). Para instalarlo:

1. Abre ese enlace desde el móvil y descarga `flowt.apk`.
2. Ábrelo. La primera vez Android pedirá permitir instalar apps desde el navegador (Brave): acéptalo para esa app.
3. Las versiones siguientes se instalan encima, sin perder la sesión.

El repositorio es público, así que el APK también lo es. No lleva secretos: solo la web ya publicada y la configuración pública de Firebase. Los datos siguen protegidos por la lista de cuentas permitidas de las reglas de Firestore.

## Puesta en marcha (una sola vez)

### 1. Clave de firma

La clave firma el APK y Google la usa para reconocer la app al iniciar sesión. **Guárdala bien**: sin ella no se puede actualizar la app instalada (habría que desinstalar e instalar de nuevo).

En PowerShell, con el `keytool` de Android Studio o de cualquier JDK:

```powershell
$pass = "elige-una-contraseña-larga"
keytool -genkeypair -v -keystore flowt.jks -alias flowt -keyalg RSA -keysize 2048 -validity 10000 -storepass $pass -keypass $pass -dname "CN=Flowt"
keytool -list -v -keystore flowt.jks -alias flowt -storepass $pass   # copia la línea SHA1
[Convert]::ToBase64String([IO.File]::ReadAllBytes("flowt.jks")) | Set-Clipboard   # base64 al portapapeles
```

### 2. App Android en Firebase

En la [consola de Firebase](https://console.firebase.google.com/project/flowt-63536/settings/general), proyecto `flowt-63536`:

1. *Añadir app → Android*, con el paquete `com.isalvan.flowt` y el **SHA-1** del paso anterior.
2. Descarga `google-services.json`.

Si más adelante compilas desde Android Studio con su clave de depuración, añade también el SHA-1 de esa clave en la misma pantalla.

### 3. Secretos en GitHub

En *Settings → Secrets and variables → Actions → New repository secret*:

| Secreto | Valor |
| --- | --- |
| `GOOGLE_SERVICES_JSON` | El contenido completo de `google-services.json` |
| `ANDROID_KEYSTORE_BASE64` | El base64 de `flowt.jks` (paso 1) |
| `ANDROID_KEYSTORE_PASSWORD` | La contraseña del paso 1 |

Después, *Actions → Flowt Android → Run workflow* genera el primer APK sin esperar a otro cambio en `main`.

### 4. Backend

- **Reglas de Firestore**: las reglas añaden `push_tokens`. Publícalas con `npx firebase deploy --only firestore:rules`.
- **Avisos**: el tracker envía con la cuenta de servicio que ya usa. Si el envío falla con un error de permisos, activa la *Firebase Cloud Messaging API* en Google Cloud para `flowt-63536`.
- **Origen de la app**: dentro de la app la web se sirve como `https://flowt-63536.web.app` (`server.hostname` en `capacitor.config.ts`), aunque los archivos salen del APK. Así la clave web de Firebase, restringida a ese referente, y el CORS del Worker (`APP_URL`) la aceptan sin configurar nada más. Si cambia el dominio de la web, hay que cambiarlo también ahí.

## Desarrollo local

```bash
npm run build && npx cap sync android   # copia dist/ y los plugins al proyecto Android
npx cap open android                     # abre Android Studio para ejecutarla en un móvil o emulador
```

Pon `google-services.json` en `android/app/` (está en `.gitignore`). Sin ese archivo la app se compila, pero se cierra al abrirse, porque el inicio de sesión nativo lo necesita.

Para firmar en local con la clave de Flowt, define `FLOWT_KEYSTORE_FILE` y `FLOWT_KEYSTORE_PASSWORD` antes de `./gradlew assembleRelease`.

## iOS

Capacitor también genera la app de iOS desde el mismo código, pero compilarla requiere un Mac con Xcode y una cuenta de Apple Developer (99 $ al año). No está incluida.
