# Servico de impressao direta do Gerador de Senha
# ------------------------------------------------
# Recebe o cupom (HTML) do userscript em http://localhost:9110/imprimir,
# gera um PDF 73x100 mm com o Edge/Chrome em modo headless e imprime na
# impressora padrao com o SumatraPDF, do mesmo jeito que o totem:
#   SumatraPDF -print-to-default -print-settings "noscale" arquivo.pdf
#
# So aceita conexoes deste computador (localhost) e so pedidos com o
# cabecalho X-Gerador-Senha (navegadores nao conseguem envia-lo de outros sites).

param(
  [int]$Porta = 9110,
  [string]$Sumatra = '',
  [string]$Impressora = ''   # vazio = impressora padrao do Windows
)

$ErrorActionPreference = 'Stop'
$pasta = Join-Path $env:TEMP 'gerador-senha'
New-Item -ItemType Directory -Force -Path $pasta | Out-Null
$log = Join-Path $pasta 'servico.log'
function Log($m) { $l = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m"; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }

function Achar($lista) { foreach ($c in $lista) { if ($c -and (Test-Path $c)) { return $c } }; return $null }

if (-not $Sumatra) {
  $Sumatra = Achar @(
    "$env:ProgramFiles\SumatraPDF\SumatraPDF.exe",
    "${env:ProgramFiles(x86)}\SumatraPDF\SumatraPDF.exe",
    "$env:LOCALAPPDATA\SumatraPDF\SumatraPDF.exe")
}
$navegador = Achar @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")

if (-not $Sumatra) { Log 'ERRO: SumatraPDF.exe nao encontrado. Use -Sumatra "C:\caminho\SumatraPDF.exe"'; exit 1 }
if (-not $navegador) { Log 'ERRO: Edge/Chrome nao encontrado.'; exit 1 }
Log "SumatraPDF: $Sumatra"
Log "Navegador:  $navegador"

$perfil = Join-Path $pasta 'perfil-headless'
$http = New-Object System.Net.HttpListener
$http.Prefixes.Add("http://localhost:$Porta/")
try { $http.Start() } catch { Log "ERRO: nao consegui abrir a porta $Porta ($($_.Exception.Message)). O servico ja esta rodando?"; exit 1 }
Log "Ouvindo em http://localhost:$Porta/"

function Responder($ctx, [int]$status, [string]$texto) {
  $b = [Text.Encoding]::UTF8.GetBytes($texto)
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = 'text/plain; charset=utf-8'
  $ctx.Response.ContentLength64 = $b.Length
  $ctx.Response.OutputStream.Write($b, 0, $b.Length)
  $ctx.Response.Close()
}

while ($http.IsListening) {
  $ctx = $http.GetContext()
  $req = $ctx.Request
  try {
    if ($req.HttpMethod -eq 'GET' -and $req.Url.AbsolutePath -eq '/status') { Responder $ctx 200 'ok'; continue }
    if ($req.HttpMethod -ne 'POST' -or $req.Url.AbsolutePath -ne '/imprimir') { Responder $ctx 404 'nao encontrado'; continue }
    if (-not $req.IsLocal -or $req.Headers['X-Gerador-Senha'] -ne '1') { Responder $ctx 403 'proibido'; continue }
    if ($req.ContentLength64 -gt 2MB) { Responder $ctx 413 'cupom grande demais'; continue }

    $leitor = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
    $html = $leitor.ReadToEnd(); $leitor.Close()

    $id = [Guid]::NewGuid().ToString('N')
    $arqHtml = Join-Path $pasta "$id.html"
    $arqPdf = Join-Path $pasta "$id.pdf"
    [IO.File]::WriteAllText($arqHtml, $html, (New-Object Text.UTF8Encoding($false)))

    $urlHtml = ([Uri]$arqHtml).AbsoluteUri
    $nargs = @('--headless', '--disable-gpu', '--no-first-run', '--no-pdf-header-footer',
      "--user-data-dir=`"$perfil`"", '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=3000', "--print-to-pdf=`"$arqPdf`"", $urlHtml)
    $p = Start-Process -FilePath $navegador -ArgumentList $nargs -PassThru -WindowStyle Hidden
    if (-not $p.WaitForExit(30000)) { try { $p.Kill() } catch {} }
    if (-not (Test-Path $arqPdf)) { throw 'o navegador nao gerou o PDF' }

    if ($Impressora) { $alvo = @('-print-to', "`"$Impressora`"") } else { $alvo = @('-print-to-default') }
    $sargs = $alvo + @('-silent', '-print-settings', '"noscale"', "`"$arqPdf`"")
    $s = Start-Process -FilePath $Sumatra -ArgumentList $sargs -PassThru -WindowStyle Hidden
    if (-not $s.WaitForExit(30000)) { try { $s.Kill() } catch {} }

    Log "impresso ($id)"
    Responder $ctx 200 'ok'
    Remove-Item -Force -ErrorAction SilentlyContinue $arqHtml, $arqPdf
  } catch {
    Log "ERRO: $($_.Exception.Message)"
    try { Responder $ctx 500 $_.Exception.Message } catch {}
  }
}
