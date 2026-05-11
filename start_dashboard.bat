@echo off
cd /d "%~dp0"
:loop
python live_server.py
timeout /t 5 /nobreak >nul
goto loop
