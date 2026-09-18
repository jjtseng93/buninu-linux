@echo off
call "%~dp0bun.bat" "%~dp0..\apps\jsmdcui\src\index.js" --cat "%~dp0..\README.md"
call "%~dp0bun.bat" "%~dp0..\apps\jsgotty\gotty.js" --viu "%~dp0..\icon.png"
exit /b %ERRORLEVEL%
