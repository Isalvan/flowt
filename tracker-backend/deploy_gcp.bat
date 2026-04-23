@echo off
echo ========================================================
echo   Despliegue de Flowt a Google Cloud Functions
echo ========================================================
echo.
echo Asegurate de tener instalado y configurado Google Cloud CLI (gcloud).
echo Ejecuta 'gcloud init' si es tu primera vez.
echo.
echo Desplegando funcion...

gcloud functions deploy flowt-webhook ^
  --gen2 ^
  --runtime=python311 ^
  --region=europe-west1 ^
  --source=. ^
  --entry-point=gmail_webhook ^
  --trigger-http ^
  --allow-unauthenticated ^
  --memory=512MB ^
  --env-vars-file=.env.yaml

echo.
echo ========================================================
echo Despliegue terminado.
echo Ve a tu consola de GCP, busca el servicio Cloud Run/Functions
echo y copia la URL HTTP proporcionada. Esa es la URL que debes
echo configurar en tu Webhook o sistema de eventos de Gmail.
echo ========================================================
pause
