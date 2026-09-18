@echo off
call "%~dp0bun.bat" "%~dp0..\apps\tts\tts.js" %*
exit /b %ERRORLEVEL%
