@echo off
title MUN15H MiniDisc Player
cd /d "C:\Users\aryan\Documents\aim project\3D Music Player with CD Animation\app"

REM open the browser once the server is up (3s delay)
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"

echo Starting MUN15H MiniDisc Player on http://localhost:3000 ...
echo (keep this window open while listening - close it to stop the server)
echo.
npm run dev
