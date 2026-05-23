@echo off
cd /d "%~dp0"
echo Starting AlphaBot Dashboard...
echo Open http://localhost:8765 in your browser
echo.
python serve.py
