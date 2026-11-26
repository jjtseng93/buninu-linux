@echo off
setlocal EnableExtensions DisableDelayedExpansion
if "%~1"=="" goto help
if "%~1"=="-h" goto help
if "%~1"=="--help" goto help
if not "%~2"=="" goto usage_error

set "tag=%~1"
if "%tag%"=="canary" goto version_ready
if "%tag:~0,4%"=="bun-" set "tag=%tag:~4%"
if "%tag:~0,1%"=="v" set "tag=%tag:~1%"
set "tag=bun-v%tag%"
:version_ready
set "base_url=https://github.com/oven-sh/bun/releases/download/%tag%"
where curl.exe >nul 2>&1
if errorlevel 1 goto missing_curl
where tar.exe >nul 2>&1
if errorlevel 1 goto missing_tar

:new_temp
set "work=%~dp0.make-bunBin-%RANDOM%-%RANDOM%"
if exist "%work%" goto new_temp
mkdir "%work%"
if errorlevel 1 exit /b 1

call :download bun-linux-aarch64 bun
if errorlevel 1 goto failed
call :download bun-linux-x64 bun
if errorlevel 1 goto failed
call :download bun-windows-x64 bun.exe
if errorlevel 1 goto failed
call :download bun-windows-aarch64 bun.exe
if errorlevel 1 goto failed
call :pack
if errorlevel 1 goto failed
move /y "%work%\bunBin.tgz" "%~dp0bunBin.tgz" >nul
if errorlevel 1 goto failed
rmdir /s /q "%work%"
echo Created "%~dp0bunBin.tgz"
tar.exe -tzvf "%~dp0bunBin.tgz"
exit /b %errorlevel%

:download
echo Downloading %1 for Bun %tag%...
curl.exe --fail --location --retry 3 --output "%work%\%1.zip" "%base_url%/%1.zip"
if errorlevel 1 exit /b 1
tar.exe -xf "%work%\%1.zip" -C "%work%" "%1/%2"
exit /b %errorlevel%

:pack
rem Windows bsdtar lacks -s. Mtree supplies names and Unix execute permissions.
pushd "%work%"
if errorlevel 1 exit /b 1
>bundle.mtree echo #mtree
>>bundle.mtree echo bun-la type=file mode=0755 contents=bun-linux-aarch64/bun
>>bundle.mtree echo bun-lx type=file mode=0755 contents=bun-linux-x64/bun
>>bundle.mtree echo bun-wx.exe type=file mode=0755 contents=bun-windows-x64/bun.exe
>>bundle.mtree echo bun-wa.exe type=file mode=0755 contents=bun-windows-aarch64/bun.exe
tar.exe -czf bunBin.tgz @bundle.mtree
set "pack_status=%errorlevel%"
popd
exit /b %pack_status%

:failed
rmdir /s /q "%work%"
exit /b 1
:missing_curl
echo Required command not found: curl.exe 1>&2
exit /b 127
:missing_tar
echo Required command not found: tar.exe 1>&2
exit /b 127
:usage_error
echo Expected one version argument. 1>&2
exit /b 2
:help
echo Usage: %~nx0 ^<version^>
echo Versions: 1.4.5, v1.4.5, bun-v1.4.5, canary
echo Uses Windows curl.exe and bsdtar tar.exe; no Bun required.
echo Creates bunBin.tgz beside this script containing bun-la, bun-lx, bun-wx.exe, bun-wa.exe.
if "%~1"=="" exit /b 2
exit /b 0
