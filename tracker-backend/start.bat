@echo off
setlocal
cd /d %~dp0

if not exist .venv (
    echo [Flowt] Creando entorno virtual...
    python -m venv .venv
)

echo [Flowt] Verificando dependencias...
.venv\Scripts\python.exe -m pip install -r requirements.txt --quiet

echo [Flowt] Ejecutando backend...
.venv\Scripts\python.exe main.py --verbose %*

endlocal
