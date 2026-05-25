@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo   📦 Flowt - Generador de Release Seguro (Backend)
echo ===================================================
echo.
echo Este script creara un archivo ZIP limpio de la carpeta 'tracker-backend'
echo excluyendo AUTOMATICAMENTE todos tus archivos privados y credenciales:
echo   - .env (Claves personales)
echo   - credentials.json / token.json (Permisos de Gmail)
echo   - serviceAccountKey.json (Llave de Firebase)
echo   - .venv / __pycache__ (Entorno virtual y cache)
echo.
echo Usando Git Archive para garantizar la maxima seguridad...
echo.

:: Verificar si git esta instalado
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Git no esta instalado o no se encuentra en el PATH.
    echo Por favor, instala Git o comprime la carpeta manualmente asegurandote de
    echo EXCLUIR los archivos serviceAccountKey.json, credentials.json, token.json y .env.
    pause
    exit /b 1
)

:: Crear el zip usando git archive
git archive --format=zip HEAD:tracker-backend -o flowt-backend-release.zip

if %errorlevel% equ 0 (
    echo.
    echo ===================================================
    echo  ¡EXiTO! Se ha generado tu release segura:
    echo  📁 flowt-backend-release.zip
    echo ===================================================
    echo Ya puedes compartir este archivo ZIP con quien quieras.
    echo Al descomprimirlo, contendra el README.md con las instrucciones de configuracion.
) else (
    echo.
    echo [ERROR] Hubo un problema al generar el archivo ZIP.
    echo Asegurate de que has hecho commit de tus ultimos cambios en Git antes de ejecutar este script.
)

echo.
pause
endlocal
