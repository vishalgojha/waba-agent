@echo off
setlocal

set PORT=3010
set PID=

for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set PID=%%a
  goto :found
)

:found
if defined PID (
  echo Port %PORT% is in use by PID %PID%. Stopping it...
  taskkill /PID %PID% /F >nul 2>nul
)

echo Opening WABA local web UI at http://127.0.0.1:%PORT% ...
start "" cmd /c "timeout /t 2 >nul && start http://127.0.0.1:%PORT%"

echo Starting gateway server on %PORT% (Ctrl+C to stop)...
waba gateway start --host 127.0.0.1 --port %PORT%

echo.
pause
endlocal
