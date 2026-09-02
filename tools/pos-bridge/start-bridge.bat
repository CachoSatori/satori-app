@echo off
REM ── PLANTILLA · agente PoS ──────────────────────────────────────────────────
REM Espeja start-bridge.bat del biotime-bridge. Ajustar la ruta si el agente no
REM queda en C:\satori\pos-bridge.
REM
REM ⚠ FASE A: el agente NO se conecta a nada. Este .bat existe para que el montaje
REM   en el Programador de tareas sea identico al del biotime-bridge cuando llegue
REM   el momento de cablearlo.
cd /d C:\satori\pos-bridge
"C:\Program Files\nodejs\node.exe" dist\index.js >> bridge.log 2>&1
