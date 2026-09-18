@echo off
call "%~dp0bun.bat" "%~dp0..\apps\bunmsh\bunmsh" %*
exit /b %ERRORLEVEL%
