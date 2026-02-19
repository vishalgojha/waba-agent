@echo off
setlocal

echo Opening WABA local web UI at http://127.0.0.1:3010 ...
start "" "http://127.0.0.1:3010"

echo Starting gateway server (Ctrl+C to stop)...
waba gateway start --host 127.0.0.1 --port 3010

echo.
pause
endlocal
