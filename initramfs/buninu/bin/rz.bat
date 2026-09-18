@echo off
call "%~dp0bun.bat" "%~dp0..\apps\jsgotty\rz.js" %*
exit /b %ERRORLEVEL%
