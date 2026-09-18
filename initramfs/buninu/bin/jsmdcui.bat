@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "JSMDCUI_ENCODING="
for %%A in (%*) do (
    set "JSMDCUI_ARGUMENT=%%~A"
    if /I "%%~xA"==".md" set "JSMDCUI_ENCODING=--mdcui"
    if /I "!JSMDCUI_ARGUMENT:~0,6!"=="--demo" set "JSMDCUI_ENCODING=--mdcui"
    if /I "!JSMDCUI_ARGUMENT!"=="--cdp-maze" set "JSMDCUI_ENCODING=--mdcui"
)
call "%~dp0bun.bat" "%~dp0..\apps\jsmdcui\src\index.js" %JSMDCUI_ENCODING% %*
exit /b %ERRORLEVEL%
