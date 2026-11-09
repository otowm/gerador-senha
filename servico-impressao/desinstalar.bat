@echo off
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Gerador de Senha - Impressao.lnk" 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*impressao-senha.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
rmdir /S /Q "%LOCALAPPDATA%\GeradorSenha" 2>nul
echo Servico removido.
pause
