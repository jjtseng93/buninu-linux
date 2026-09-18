@echo off
call "%~dp0bun.bat" "%~dp0..\apps\jsmdcui\src\index.js" --cat %*
exit /b %ERRORLEVEL%
