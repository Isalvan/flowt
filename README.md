# 🐖 Flowt - Financial Tracker

> Control financiero automatizado e inteligente con reparto automático en carteras y visualización premium.

**Flowt** es un gestor de finanzas personales automatizado. El sistema extrae en tiempo real los movimientos (ingresos y gastos) desde las notificaciones de correo electrónico de tu banco, procesa los textos mediante Inteligencia Artificial (**Google Gemini AI**) y los registra de forma segura en **Google Firebase Firestore**, distribuyendo automáticamente tus ahorros en diferentes "huchas" o carteras digitales según tus propias reglas.

---

## 🎨 Características Clave

* **🤖 Extracción Inteligente con IA**: Lector automático de Gmail que utiliza el modelo `gemini-3-flash-preview` para interpretar notificaciones bancarias en lenguaje natural (cargos, abonos, transferencias, Bizums) y convertirlas en JSON estructurado.
* **📈 Lógica de Huchas Dinámica**: Reparto automático de ingresos basado en reglas personalizables:
  * **Flat**: Asignación de cantidades fijas de dinero a huchas de suscripciones o gastos recurrentes.
  * **Porcentaje**: Asignación porcentual del ingreso total (ej. 15% a Viajes, 20% a Inversiones).
  * **Resto**: El remanente disponible va automáticamente a tu cartera principal o de fondo de emergencia.
  * **Topes por Objetivo**: Si una hucha alcanza su meta de ahorro y tiene el tope activo, el excedente se redirige automáticamente para evitar sobre-financiación.
* **💼 Revisión Manual Inteligente**: Si un correo es ambiguo o la IA duda del importe o tipo de transacción, el movimiento se envía a una bandeja de revisión en el frontend para que lo apruebes a mano con un solo clic.
* **🔒 Privacidad y "Security First"**:
  * **Modo Privado (Ocultar saldos)**: Un botón de privacidad con bloqueo de PIN numérico que oculta visualmente todos tus saldos con efecto difuminado.
  * **Idempotencia Absoluta**: Evita duplicidad de movimientos mediante hashes únicos SHA-256 basados en el ID interno del correo de Gmail.
* **✨ Interfaz Premium Glassmorphic**: Frontend moderno construido con React, Tailwind CSS y gráficos avanzados (tendencias lineales con Recharts y categorías circulares con Highcharts).
* **📱 Modo Demo Symmetrical**: Si no tienes Firebase configurado, la aplicación te permite explorar la interfaz completa y todas sus acciones simulando la base de datos localmente en el `localStorage` del navegador.

---

## 🏗️ Arquitectura del Sistema

El proyecto se compone de dos piezas independientes y perfectamente integradas:

```
├── tracker-backend/        # Motor en Python (Automatización)
│   ├── main.py             # Script principal de lectura y procesamiento
│   ├── README.md           # Guía de configuración paso a paso (Gmail + Firebase + Gemini)
│   ├── start.bat           # Ejecutor automatizado local (Windows)
│   └── requirements.txt    # Librerías de Python (Google API, Firebase Admin, Gemini SDK)
│
├── src/                    # Frontend en React + TypeScript + Vite
│   ├── components/         # Componentes visuales (Dashboard, Suscripciones, Calendario, Manual)
│   ├── hooks/              # Lógica de datos en tiempo real (useFinanceData)
│   ├── firebase.ts         # Inicialización cliente de Firebase
│   └── index.css           # Estilos globales y variables de diseño
```

---

## 🚀 Guía de Inicio Rápido

### 1. Desplegar el Frontend (Web PWA)
El frontend está preparado para ser multiusuario y aislar los datos de cada persona utilizando su cuenta de Google.

1. Ve a la raíz del proyecto e instala las dependencias de Node.js:
   ```bash
   npm install
   ```
2. Crea un archivo `.env` en la raíz del proyecto con las credenciales de cliente de tu proyecto de Firebase:
   ```env
   VITE_FIREBASE_API_KEY=tu_api_key
   VITE_FIREBASE_AUTH_DOMAIN=tu_auth_domain
   VITE_FIREBASE_PROJECT_ID=tu_project_id
   VITE_FIREBASE_STORAGE_BUCKET=tu_storage_bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=tu_sender_id
   VITE_FIREBASE_APP_ID=tu_app_id
   ```
3. Ejecuta la aplicación en modo desarrollo:
   ```bash
   npm run dev
   ```
4. O compila y despliega en Firebase Hosting de forma gratuita:
   ```bash
   npm run build
   firebase deploy
   ```

### 2. Configurar el Backend (Lector de Gmail y Gemini)
El script de Python se encarga de sincronizar tu cuenta de Gmail con tu Firestore.

Para configurarlo:
1. Entra en la carpeta `tracker-backend/`.
2. Sigue las instrucciones paso a paso detalladas en el archivo [tracker-backend/README.md](file:///c:/Users/isalvan2/Documents/01_Proyectos_Desarrollo/Bots_y_Scripts/bank-movements/tracker-backend/README.md) para configurar las credenciales de Google Cloud, Firebase Admin SDK y Google Gemini.
3. Ejecuta el script localmente con `start.bat` o automatízalo en la nube 24/7 de forma gratuita utilizando **GitHub Actions** (la guía de Actions está incluida al final del manual del backend).

---

## 📦 Cómo compartir el Backend de forma segura

Si deseas compartir únicamente la parte de automatización (el script extractor de Python) con algún familiar o amigo para que lo configure con su propio banco:
1. Asegúrate de tener Git instalado y haber hecho commit de tus últimos cambios.
2. En la raíz del proyecto, haz doble clic en el archivo **`crear_zip_release.bat`**.
3. Esto generará un archivo comprimido limpio llamado `flowt-backend-release.zip` listo para enviar, el cual **excluye automáticamente** todos tus secretos, claves del banco, contraseñas y entornos virtuales locales.
