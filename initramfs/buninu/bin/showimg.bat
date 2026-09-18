@echo off
call "%~dp0bun.bat" "%~dp0..\apps\jsgotty\gotty.js" --viu %*
exit /b %ERRORLEVEL%
