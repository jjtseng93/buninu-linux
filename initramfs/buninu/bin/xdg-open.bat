@echo off
call "%~dp0bun.bat" "%~dp0..\apps\xdg-open\xdg-open.js" %*
exit /b %ERRORLEVEL%
