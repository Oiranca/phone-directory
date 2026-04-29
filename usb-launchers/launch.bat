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
set ELECTRON_PORTABLE=1
start "" "%APP%"
endlocal
