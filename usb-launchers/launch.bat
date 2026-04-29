@echo off
setlocal
set "USB_ROOT=%~dp0"
set "APP=%USB_ROOT%win-unpacked\Phone Directory.exe"
if not exist "%APP%" (
    echo ERROR: Cannot find %APP%
    echo Make sure the win-unpacked folder is present at the USB root.
    pause
    exit /b 1
)
rem ELECTRON_PORTABLE=1 and ELECTRON_PORTABLE_ROOT_PATH are inherited by the spawned child process via setlocal env block
set ELECTRON_PORTABLE=1
set "ELECTRON_PORTABLE_ROOT_PATH=%USB_ROOT%portable-data"
start "" "%APP%"
endlocal
