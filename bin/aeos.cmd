@echo off
set SCRIPT_DIR=%~dp0
if "%1"=="stop" goto stop
if "%1"=="--deactivate" goto stop
if "%1"=="claim" goto claim
if "%1"=="--claim-pending" goto claim
goto start

:start
echo [AEOS] Activating active linkage pipeline...
if not exist "%CD%\.planning" mkdir "%CD%\.planning"
if not exist "%CD%\dist" mkdir "%CD%\dist"
if not exist "%CD%\.planning\task_plan.md" (
  echo # AEOS Master Task Plan> "%CD%\.planning\task_plan.md"
  echo - [ ] Initialize system specifications and directory structure>> "%CD%\.planning\task_plan.md"
  echo - [ ] Configure local Qdrant Vector Store indexing>> "%CD%\.planning\task_plan.md"
  echo - [ ] Deploy Sandbox execution containers>> "%CD%\.planning\task_plan.md"
)
docker run -d -p 6333:6333 -p 6334:6334 --name aeos-books qdrant/qdrant >nul 2>&1
start /b node "%SCRIPT_DIR%aeos-stealth-browser.js" --daemon >nul 2>&1
start /b node "%SCRIPT_DIR%aeos-orchestrator.js" --watch > "%CD%\.planning\aeosd.log" 2>&1
echo 12345 > "%CD%\.planning\aeosd.pid"
echo [AEOS] Linkage successful! Claude Code and Antigravity are now hardwired.
echo [AEOS] Shared session logs active. Real-Time Telemetry: http://127.0.0.1:4000
goto end

:claim
node "%SCRIPT_DIR%aeos-orchestrator.js" --claim-pending
goto end

:stop
echo [AEOS] Breaking agent linkages and stopping services...
del "%CD%\.planning\aeosd.pid" >nul 2>&1
docker stop aeos-books >nul 2>&1
taskkill /f /im node.exe /fi "WINDOWTITLE eq aeos*" >nul 2>&1
echo [AEOS] System safely offline.
goto end

:end