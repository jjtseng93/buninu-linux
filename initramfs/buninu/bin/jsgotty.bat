@echo off
call "%~dp0bun.bat" "%~dp0..\apps\jsgotty\gotty.js" %*
exit /b %ERRORLEVEL%
