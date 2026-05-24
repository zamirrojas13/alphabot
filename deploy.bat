@echo off
setlocal

set KEY=C:\Users\zamir\OneDrive\Claude AI\alphabot\.keys\oracle.key
set HOST=ubuntu@163.192.100.135
set REMOTE=/home/ubuntu/btc-bot
set LOCAL=C:\Users\zamir\OneDrive\Claude AI\alphabot

cd /d "%LOCAL%"

:: 1. Stage all changes
echo.
echo [1/9] Staging all changes...
git add -A
if errorlevel 1 ( echo ERROR: git add failed & exit /b 1 )

:: 2. Prompt for deploy message
echo.
set /p MSG="Deploy message: "
if "%MSG%"=="" ( echo ERROR: message cannot be empty & exit /b 1 )

:: 3. Commit with timestamp
echo.
echo [3/9] Committing...
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set TS=%%i
git commit -m "%MSG% - %TS%"
if errorlevel 1 ( echo [WARN] Nothing to commit - continuing to deploy )

:: 4. Push to GitHub
echo.
echo [4/9] Pushing to origin main...
git push origin main
if errorlevel 1 ( echo ERROR: git push failed & exit /b 1 )

:: 5. SCP changed files to server
echo.
echo [5/9] Copying files to server...
scp -i "%KEY%" -o StrictHostKeyChecking=no "%LOCAL%\main.py" "%HOST%:%REMOTE%/main.py"
if errorlevel 1 ( echo ERROR: SCP main.py failed & exit /b 1 )

scp -i "%KEY%" -o StrictHostKeyChecking=no "%LOCAL%\serve.py" "%HOST%:%REMOTE%/serve.py"
if errorlevel 1 ( echo ERROR: SCP serve.py failed & exit /b 1 )

scp -r -i "%KEY%" -o StrictHostKeyChecking=no "%LOCAL%\signal_engine\brain" "%HOST%:%REMOTE%/signal_engine/brain"
if errorlevel 1 ( echo ERROR: SCP brain folder failed & exit /b 1 )

echo Files copied OK

:: 6. Restart alphabot service
echo.
echo [6/9] Restarting alphabot...
ssh -i "%KEY%" -o StrictHostKeyChecking=no %HOST% "sudo systemctl restart alphabot"
if errorlevel 1 ( echo ERROR: Restart failed & exit /b 1 )
echo Restart command sent

:: 7. Wait 15 seconds
echo.
echo [7/9] Waiting 15 seconds for startup...
timeout /t 15 /nobreak >nul

:: 8. Show last 10 lines of bot log
echo.
echo [8/9] Last 10 lines of bot.log:
echo ----------------------------------------
ssh -i "%KEY%" -o StrictHostKeyChecking=no %HOST% "tail -10 /home/ubuntu/btc-bot/logs/bot.log"
echo ----------------------------------------

:: 9. Done
echo.
echo [9/9] Deploy complete - %TS%
endlocal
