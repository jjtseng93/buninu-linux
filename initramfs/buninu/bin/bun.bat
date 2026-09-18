@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "BUNINU_BUN_ARCHIVE=%~dp0..\apps\bun\bunBin.tgz"
set "BUNINU_BUN_WX=%~dp0bun-wx.exe"
set "BUNINU_EXTRACT_BUN="

if exist "%BUNINU_BUN_ARCHIVE%" (
  if not exist "%BUNINU_BUN_WX%" set "BUNINU_EXTRACT_BUN=1"

  if exist "%BUNINU_BUN_WX%" if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
    for /f "delims=" %%U in ('"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -Command "if ((Get-Item -LiteralPath $env:BUNINU_BUN_ARCHIVE).LastWriteTimeUtc -gt (Get-Item -LiteralPath $env:BUNINU_BUN_WX).LastWriteTimeUtc) { '1' }"') do set "BUNINU_EXTRACT_BUN=%%U"
  )
)

if defined BUNINU_EXTRACT_BUN (
  tar -xzf "%BUNINU_BUN_ARCHIVE%" -C "%~dp0"
  if errorlevel 1 (
    echo Failed to extract Bun archive: %BUNINU_BUN_ARCHIVE% 1>&2
    exit /b 1
  )
)

if exist "%~dp0bun-wx.exe" (
  "%~dp0bun-wx.exe" %*
  exit /b !ERRORLEVEL!
)

for /f "delims=" %%B in ('where bun.exe 2^>nul') do (
  if /I not "%%~dpB"=="%~dp0" (
    "%%~fB" %*
    exit /b !ERRORLEVEL!
  )
)

echo Bun Binary not found: %~dp0bun-wx.exe ^(and no external bun.exe found in PATH^) 1>&2
exit /b 127
