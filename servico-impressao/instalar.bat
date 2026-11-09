@echo off
rem Instala o servico de impressao direta para iniciar junto com o Windows
rem (atalho na pasta Inicializar do usuario) e ja o inicia agora.
setlocal
set "DESTINO=%LOCALAPPDATA%\GeradorSenha"
if not exist "%DESTINO%" mkdir "%DESTINO%"
copy /Y "%~dp0impressao-senha.ps1" "%DESTINO%\impressao-senha.ps1" >nul

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Gerador de Senha - Impressao.lnk'); $s.TargetPath='powershell.exe'; $s.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%DESTINO%\impressao-senha.ps1\"'; $s.WindowStyle=7; $s.Save()"

start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%DESTINO%\impressao-senha.ps1"
echo.
echo Servico instalado e iniciado.
echo Teste: abra http://localhost:9110/status no navegador (deve mostrar "ok").
echo Log: %TEMP%\gerador-senha\servico.log
pause
