@echo off
call "%~dp0bun.bat" "%~dp0..\apps\native-bridge\native-bridge.js" %*
exit /b %ERRORLEVEL%
