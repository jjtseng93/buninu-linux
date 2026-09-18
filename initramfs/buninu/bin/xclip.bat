@echo off
call "%~dp0bun.bat" "%~dp0..\apps\xclip\xclip.js" %*
exit /b %ERRORLEVEL%
