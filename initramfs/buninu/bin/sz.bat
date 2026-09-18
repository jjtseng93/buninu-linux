@echo off
call "%~dp0bun.bat" "%~dp0..\apps\jsgotty\sz.js" %*
exit /b %ERRORLEVEL%
