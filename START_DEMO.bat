@echo off
echo Starting HerShield demo at http://localhost:8080  (close this window to stop)
start "" "http://localhost:8080/index.html"
cd /d "%~dp0app"
python -m http.server 8080
