@echo off
rem Starts the Psalmist Studio local AI service on http://127.0.0.1:5175 (CORS: http://localhost:5174 only).
setlocal
cd /d "%~dp0"
if exist "%~dp0env.local.cmd" call "%~dp0env.local.cmd"
if "%PSALMIST_AI_HOME%"=="" set "PSALMIST_AI_HOME=%LOCALAPPDATA%\PsalmistAI"
if "%PSALMIST_AI_VENV%"=="" set "PSALMIST_AI_VENV=%PSALMIST_AI_HOME%\venv"
if "%PSALMIST_AI_CACHE%"=="" set "PSALMIST_AI_CACHE=%PSALMIST_AI_HOME%\cache"
set "HF_HUB_DISABLE_SYMLINKS_WARNING=1"
set "PYTHONWARNINGS=ignore"
if not exist "%PSALMIST_AI_VENV%\Scripts\python.exe" (
  echo AI environment not found at %PSALMIST_AI_VENV%
  echo Run setup-ai.cmd first.
  exit /b 1
)
echo Psalmist AI service: http://127.0.0.1:5175   (Ctrl+C to stop)
"%PSALMIST_AI_VENV%\Scripts\python.exe" run.py
