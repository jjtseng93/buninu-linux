@echo off
call "%~dp0bun.bat" "%~dp0..\apps\bunx\bunx.js" %*
exit /b %ERRORLEVEL%
