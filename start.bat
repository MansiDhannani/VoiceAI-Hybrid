@echo off
echo ============================================
echo  VoiceAI - Starting Backend + Frontend
echo ============================================

:: Kill any stale processes
taskkill /F /FI "IMAGENAME eq python.exe" >nul 2>&1
taskkill /F /FI "IMAGENAME eq ngrok.exe" >nul 2>&1
taskkill /F /FI "IMAGENAME eq node.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

:: Start backend
echo Starting backend on port 8080...
start "VoiceAI Backend" cmd /k "cd /d "C:\Users\mansimaheshwari\Desktop\voice converter\backend" && py -3.10 -m uvicorn main:app --host 0.0.0.0 --port 8080"

:: Wait for backend
timeout /t 12 /nobreak >nul

:: Start frontend on localhost
echo Starting frontend on port 3000...
start "VoiceAI Frontend" cmd /k "cd /d "C:\Users\mansimaheshwari\Desktop\voice converter\frontend" && npm run dev"

echo.
echo ============================================
echo  Open browser at: http://localhost:3000
echo ============================================
pause
