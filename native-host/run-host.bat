@echo off
:: Launcher for the SecurePass native messaging host.
:: Uses the absolute node path so Chrome's stripped PATH is not a problem.
"C:\nvm4w\nodejs\node.exe" "%~dp0host.js" 2>> "%~dp0host-error.log"
