@echo off
setlocal

if "%~1"=="" (
  set MODEL=qwen2.5:7b
) else (
  set MODEL=%~1
)

waba config set aiProvider ollama
waba config set openaiBaseUrl http://127.0.0.1:11434/v1
waba config set openaiModel %MODEL%

echo.
echo Ollama is now the active provider.
echo Model: %MODEL%
echo Next: waba check

endlocal
