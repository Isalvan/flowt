@echo off
echo ==========================================
echo   Flowt - Actualizando Movimientos
echo ==========================================
cd tracker-backend
.venv\Scripts\python.exe main.py --verbose
echo.
echo ==========================================
echo   Proceso finalizado.
pause
