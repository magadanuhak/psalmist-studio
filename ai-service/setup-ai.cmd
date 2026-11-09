@echo off
rem One-time setup of the local AI service (Windows). Creates an isolated Python 3.11 venv OUTSIDE the project and
rem installs CUDA PyTorch + DeepFilterNet + Demucs + the Anticipatory Music Transformer package.
rem Override locations with PSALMIST_AI_VENV / PSALMIST_AI_CACHE (or put them in ai-service\env.local.cmd).
setlocal
cd /d "%~dp0"
if exist "%~dp0env.local.cmd" call "%~dp0env.local.cmd"
if "%PSALMIST_AI_HOME%"=="" set "PSALMIST_AI_HOME=%LOCALAPPDATA%\PsalmistAI"
if "%PSALMIST_AI_VENV%"=="" set "PSALMIST_AI_VENV=%PSALMIST_AI_HOME%\venv"
if "%PSALMIST_AI_CACHE%"=="" set "PSALMIST_AI_CACHE=%PSALMIST_AI_HOME%\cache"
set "UV_CACHE_DIR=%PSALMIST_AI_CACHE%\uv"
set "UV_PYTHON_INSTALL_DIR=%PSALMIST_AI_CACHE%\uv-python"
set "AMT_COMMIT=af37397922665a0fb8d474d7988b0f3755a38d45"

where uv >nul 2>nul || (echo Installing uv... & python -m pip install --user uv || goto :fail)
where uv >nul 2>nul || set "PATH=%PATH%;%APPDATA%\Python\Python313\Scripts;%USERPROFILE%\.local\bin"

uv venv --python 3.11 "%PSALMIST_AI_VENV%" || goto :fail
set "PY=%PSALMIST_AI_VENV%\Scripts\python.exe"
uv pip install --python "%PY%" torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu124 || goto :fail
uv pip install --python "%PY%" -r requirements.txt || goto :fail

uv pip install --python "%PY%" https://github.com/CPJKU/beat_this/archive/main.zip || goto :fail
uv pip install --python "%PY%" --no-deps voicefixer || goto :fail

rem Local LLM runtime (llama.cpp, MIT, no admin rights) + Qwen3-8B Q4_K_M (Apache-2.0) under %PSALMIST_AI_HOME%\llm
set "LLM=%PSALMIST_AI_HOME%\llm"
if not exist "%LLM%\bin\llama-server.exe" (
  if not exist "%LLM%\models" mkdir "%LLM%\models"
  curl -fL -o "%LLM%\bin.zip" https://github.com/ggml-org/llama.cpp/releases/download/b12223/llama-b12223-bin-win-cuda-12.4-x64.zip || goto :fail
  powershell -NoProfile -Command "Expand-Archive -Force '%LLM%\bin.zip' '%LLM%\bin'" || goto :fail
)
if not exist "%LLM%\models\Qwen3-8B-Q4_K_M.gguf" curl -fL -C - -o "%LLM%\models\Qwen3-8B-Q4_K_M.gguf" https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf || goto :fail

set "SRC=%PSALMIST_AI_CACHE%\amt-src"
if not exist "%SRC%" mkdir "%SRC%"
if not exist "%SRC%\anticipation-%AMT_COMMIT%" (
  curl -sL "https://github.com/jthickstun/anticipation/archive/%AMT_COMMIT%.zip" -o "%SRC%\a.zip" || goto :fail
  powershell -NoProfile -Command "Expand-Archive -Force '%SRC%\a.zip' '%SRC%'" || goto :fail
)
uv pip install --python "%PY%" --no-deps "%SRC%\anticipation-%AMT_COMMIT%" || goto :fail

echo Pre-downloading model weights (first start does this anyway)...
set "PSALMIST_AI_PRELOAD=1"
"%PY%" -c "from app import config, denoise, separate, accompany; denoise.load(); separate.load(); accompany.load(); print('models ready')" || goto :fail
echo.
echo Done. Start the service with start-ai.cmd
exit /b 0
:fail
echo SETUP FAILED
exit /b 1
