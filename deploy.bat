@echo off
setlocal

set KEY="C:\Users\zamir\OneDrive\Claude AI\alphabot\.keys\oracle.key"
set HOST=ubuntu@163.192.100.135
set REMOTE=/home/ubuntu/btc-bot/
set LOCAL="C:\Users\zamir\OneDrive\Claude AI\alphabot"

cd /d "C:\Users\zamir\OneDrive\Claude AI\alphabot"

:: ── 1. Read current version from serve.py ────────────────────────────────────
for /f "usebackq delims=" %%v in (`python -c "import re; m=re.search(r'BOT_VERSION\s*=\s*\"([\d.]+)\"',open('serve.py').read()); print(m.group(1)) if m else print('0.0.0')"`) do set CURVER=%%v
if "%CURVER%"=="0.0.0" (
    echo ERROR: Could not read BOT_VERSION from serve.py
    exit /b 1
)

:: ── 2. Bump patch number ──────────────────────────────────────────────────────
for /f "usebackq delims=" %%v in (`python -c "parts='%CURVER%'.split('.'); parts[2]=str(int(parts[2])+1); print('.'.join(parts))"`) do set NEWVER=%%v

echo.
echo Bumping version: %CURVER% ^-^> %NEWVER%

:: ── 3. Update version string in serve.py ─────────────────────────────────────
python -c "import re; s=open('serve.py').read(); s=re.sub(r'BOT_VERSION\s*=\s*\"[\d.]+\"','BOT_VERSION = \"%NEWVER%\"',s); open('serve.py','w').write(s)"
if errorlevel 1 ( echo ERROR: Failed to update serve.py version. & exit /b 1 )

:: ── 4. Stage files ────────────────────────────────────────────────────────────
echo.
echo Staging files...
git add signal_engine/config.py signal_engine/strategy.py signal_engine/indicators.py serve.py
if errorlevel 1 ( echo ERROR: git add failed. & exit /b 1 )

:: ── 5. Prompt for deploy message ─────────────────────────────────────────────
echo.
set /p MSG="Enter deploy message: "
if "%MSG%"=="" (
    echo ERROR: commit message cannot be empty.
    exit /b 1
)

:: ── 6. Commit ────────────────────────────────────────────────────────────────
git diff --cached --quiet
if not errorlevel 1 (
    echo Nothing staged to commit. Deploying anyway...
    goto :deploy
)

git commit -m "%MSG%"
if errorlevel 1 ( echo ERROR: git commit failed. & exit /b 1 )

:: ── 7. Tag ───────────────────────────────────────────────────────────────────
for /f "tokens=1-4 delims=/ " %%a in ('echo %DATE%') do set D=%%c%%a%%b
for /f "tokens=1-2 delims=:. " %%a in ('echo %TIME%') do set T=%%a%%b
set T=%T: =0%
set TAG=deploy-%D:~0,4%-%D:~4,2%-%D:~6,2%-%T%
git tag %TAG%
echo Tagged: %TAG%

:deploy
:: ── 8. SCP changed files to server ───────────────────────────────────────────
echo.
echo Copying files to server...
scp -i %KEY% -o StrictHostKeyChecking=no ^
    %LOCAL%\signal_engine\config.py ^
    %LOCAL%\signal_engine\strategy.py ^
    %LOCAL%\signal_engine\indicators.py ^
    %HOST%:%REMOTE%signal_engine/
if errorlevel 1 ( echo ERROR: scp of signal_engine failed. & exit /b 1 )

scp -i %KEY% -o StrictHostKeyChecking=no ^
    %LOCAL%\serve.py ^
    %HOST%:%REMOTE%
if errorlevel 1 ( echo ERROR: scp of serve.py failed. & exit /b 1 )

:: ── 9. Restart alphabot service ──────────────────────────────────────────────
echo Restarting alphabot...
ssh -i %KEY% -o StrictHostKeyChecking=no %HOST% "sudo systemctl restart alphabot"
if errorlevel 1 ( echo ERROR: ssh restart failed. & exit /b 1 )

:: ── 10. Done ─────────────────────────────────────────────────────────────────
echo.
echo Deploy complete ^— v%NEWVER%
endlocal
