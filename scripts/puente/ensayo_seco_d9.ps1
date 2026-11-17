# Ensayo EN SECO de los bloques del pase D9 del agente (docs/puente/PASE-D9-AGENTE-bloques.md). PowerShell 5.1 y 7.
#
#   pwsh -NoProfile -File scripts/puente/ensayo_seco_d9.ps1                                  (Linux o Windows, 7.x)
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\puente\ensayo_seco_d9.ps1    (Windows PowerShell 5.1)
#
# Lee los bloques ```powershell del paquete TAL CUAL y:
#   1. los parsea y busca lo que no existe en PowerShell 5.1 (??, ?., &&, ||, ternario, -AsHashtable, utf8NoBOM, …);
#   2. los corre en orden con DOBLES de git, node, npm.cmd, npx.cmd, las tareas programadas y Get-CimInstance, en una
#      carpeta temporal: NADA sale a la red, no se toca ninguna tarea real ni ningún .env real (los del kit son ficticios);
#   3. prueba que FRENAN cuando deben (hora, SHA, tarea detenida, .env incompleto, dry-run en 0 o > 50 %, backfill
#      corriendo, ventana de la noche, mes con error, corte de las 05:50 y retomar);
#   4. revisa que ningún valor del .env ficticio aparezca en ninguna salida.
# Al final: «RESULTADO: N PASS, M FAIL». Tiene que dar 0 FAIL.
# (Este archivo va en UTF-8 CON BOM: PowerShell 5.1 lee un .ps1 sin BOM como ANSI.)
param([string]$Paquete = '')

$ErrorActionPreference = 'Stop'
$AQUI = $PSScriptRoot
$REPO = (Resolve-Path -LiteralPath (Join-Path (Join-Path $AQUI '..') '..')).Path
if (-not $Paquete) { $Paquete = Join-Path (Join-Path (Join-Path $REPO 'docs') 'puente') 'PASE-D9-AGENTE-bloques.md' }
$MEDIR_REAL = Join-Path (Join-Path (Join-Path $REPO 'scripts') 'puente') 'armar_mapa_secretos.mjs'

$script:pasan = 0; $script:fallan = 0
function Resultado([string]$nombre, [bool]$ok, [string]$det = '') {
  if ($ok) { $script:pasan++; Write-Host "PASS  $nombre" -ForegroundColor Green }
  else { $script:fallan++; Write-Host "FAIL  $nombre  $det" -ForegroundColor Red }
}
Write-Host "Ensayo en seco · bloques D9 · PowerShell $($PSVersionTable.PSVersion) $($PSVersionTable.PSEdition)"

# ── 1. Bloques, en orden, con su título (## A0 … ## B1) ───────────────────────────────────────────────────────────
$texto = [IO.File]::ReadAllText($Paquete)
$B = [ordered]@{}
foreach ($m in [regex]::Matches($texto, '```powershell\r?\n(.*?)```', [Text.RegularExpressions.RegexOptions]::Singleline)) {
  $antes = $texto.Substring(0, $m.Index)
  $tit = [regex]::Matches($antes, '(?m)^## ([AB]\d)\b')
  $clave = if ($B.Count -eq 0) { 'P' } elseif ($tit.Count) { $tit[$tit.Count - 1].Groups[1].Value } else { "?$($B.Count)" }
  if ($B.Contains($clave)) { $clave = "$clave+" }
  $B[$clave] = $m.Groups[1].Value
}
Resultado 'bloques encontrados: P A0 A1 A2 A3 A4 A5 A6 A7 B1' ((@($B.Keys) -join ' ') -ceq 'P A0 A1 A2 A3 A4 A5 A6 A7 B1') (@($B.Keys) -join ' ')

$prohibidos = @('QuestionQuestion', 'QuestionQuestionEquals', 'QuestionDot', 'QuestionLBracket', 'AndAnd', 'OrOr', 'QuestionMark')
foreach ($k in @($B.Keys)) {
  $tok = $null; $err = $null
  $ast = [Management.Automation.Language.Parser]::ParseInput($B[$k], [ref]$tok, [ref]$err)
  Resultado "$k parsea sin errores" ($err.Count -eq 0) (@($err | ForEach-Object { $_.Message }) -join ' | ')
  $malos = @($tok | Where-Object { $prohibidos -contains $_.Kind.ToString() } | ForEach-Object { $_.Text })
  $malos += @([regex]::Matches($B[$k], '-AsHashtable|utf8NoBOM|-AdditionalChildPath|\$PSStyle|Get-Error|ForEach-Object\s+-Parallel') | ForEach-Object { $_.Value })
  $jp = @($ast.FindAll({ param($a) $a -is [Management.Automation.Language.CommandAst] -and $a.GetCommandName() -eq 'Join-Path' }, $true) | Where-Object { $_.CommandElements.Count -gt 3 })
  if ($jp.Count) { $malos += 'Join-Path con más de 2 partes' }
  Resultado "$k solo usa lo que tiene PowerShell 5.1" ($malos.Count -eq 0) ($malos -join ', ')
  if ($k -ne 'P') { Resultado "$k va envuelto en & { … }" ($B[$k] -match '^\s*&\s*\{' -and $B[$k].TrimEnd() -match '\}$') }
  Resultado "$k sin redirecciones 2>&1 ni portapapeles ni transcript" (-not ($B[$k] -match '2>&1|Set-Clipboard|Get-Clipboard|clip\.exe|Start-Transcript|Get-Content[^\r\n]*\.env'))
}

# ── 2. Dobles (las funciones le ganan a los .exe y a los cmdlets) ──────────────────────────────────────────────────
$SECRETO = 'SECRETO-FICTICIO-DEL-KIT-0123456789abcdef0123456789abcdef'; $CLAVEPOS = 'CLAVE-POS-FICTICIA-9876'
function Nuevo-Kit {
  $raiz = Join-Path ([IO.Path]::GetTempPath()) ('satori-d9-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $vieja = Join-Path $raiz 'agente-prod-5da233a'; New-Item -ItemType Directory -Force (Join-Path $vieja 'pos-bridge') | Out-Null
  [IO.File]::WriteAllText((Join-Path (Join-Path $vieja 'pos-bridge') 'register.mjs'), '// ficticio')
  $envTxt = "# ficticio`r`nPOS_DB_HOST=equipo-ficticio\SQL`r`nPOS_DB_USER=usuario-ficticio`r`nPOS_DB_PASSWORD=$CLAVEPOS`r`nLOCAL=santa-teresa`r`nENV=prod`r`nINGEST_URL=https://yiczgdti-ficticio.supabase.co/functions/v1/ingest-ndf`r`nINGEST_SECRET=$SECRETO`r`nPOS_AGENTE_PROD_FIRMADO=2026-10-28`r`n"
  [IO.File]::WriteAllText((Join-Path (Join-Path $vieja 'pos-bridge') '.env'), $envTxt)
  $cmd = Join-Path $raiz 'pos-agente-prod-5da233a.cmd'
  [IO.File]::WriteAllText($cmd, "@echo off`r`ncd /d $vieja`r`n`"C:\Program Files\nodejs\node.exe`" --import ./pos-bridge/register.mjs pos-bridge/agente.ts`r`n")
  $script:NUEVA = Join-Path $raiz 'agente-d9'; $script:CMD_NUEVO = Join-Path $raiz 'pos-agente-prod-d9.cmd'; $script:VUELTA = Join-Path $raiz 'd9-vuelta'
  $global:KIT = @{ raiz = $raiz; vieja = $vieja; cmd = $cmd; Execute = $cmd; Arguments = $null; WorkingDirectory = $null; State = 'Running'
    ahora = [datetime]'2026-11-17 11:00:00'; sha_viejo = '5da233a516d1a6c4c2c95eb165be448be5416697'; arbol = 'd14d603a0d2458af7a81025efef688a2dfc9fed0'
    dry = @(5, 6, 7, 8, 6, 5, 7); tickets = 30; dry_sin_marca = $false; backfill_corriendo = $false; no_arranca = $false
    min_por_mes = 2; falla_mes = ''; meses = @(); git = @() }
}
function Hoy-CR-Doble { $global:KIT.ahora }
function git {
  $a = @($args | ForEach-Object { [string]$_ }); $global:LASTEXITCODE = 0; $global:KIT.git += ($a -join ' ')
  if ($a[0] -eq '--version') { 'git version 2.47.0 (doble)'; return }
  if ($a[0] -eq 'clone') {
    $c = $a[-1]; New-Item -ItemType Directory -Force (Join-Path (Join-Path $c 'scripts') 'puente') | Out-Null
    New-Item -ItemType Directory -Force (Join-Path $c 'pos-bridge') | Out-Null
    Copy-Item -LiteralPath $MEDIR_REAL -Destination (Join-Path (Join-Path (Join-Path $c 'scripts') 'puente') 'armar_mapa_secretos.mjs')
    [IO.File]::WriteAllText((Join-Path (Join-Path $c 'pos-bridge') 'register.mjs'), '// ficticio'); return
  }
  $dir = ''; if ($a[0] -eq '-C') { $dir = $a[1]; $a = @($a[2..($a.Count - 1)]) }
  switch ($a[0]) {
    'rev-parse' { if ($a[1] -eq 'HEAD:pos-bridge') { $global:KIT.arbol } elseif ($dir -like '*agente-prod-5da233a*') { $global:KIT.sha_viejo } else { '578f38c039ec232d3818c1182d69d7f78f55b371' } }
    'diff' { 'pos-bridge/backfill.test.ts'; 'pos-bridge/backfill.ts'; 'pos-bridge/consulta.test.ts'; 'pos-bridge/consulta.ts'; 'pos-bridge/esquema.ts' }
    default { }
  }
}
function npm.cmd { $global:LASTEXITCODE = 0; if ($args -contains '--version') { '10.9.0' } }
function npx.cmd { $global:LASTEXITCODE = 0; ' Test Files  11 passed (11)'; '      Tests  478 passed (478)' }
function node {
  $a = @($args | ForEach-Object { [string]$_ }); $global:LASTEXITCODE = 0
  if ($a -contains '--version') { 'v22.18.0'; return }
  if ($a -contains '-e') { 'si'; return }
  if ($a -contains '--solo-medir') { '{"archivo_que_manda":"pos-bridge\\.env","largo_santa_teresa":64,"cumple_32":true}'; return }
  if (($a -join ' ') -match 'backfill\.ts') {
    $desde = $a[[array]::IndexOf($a, '--desde') + 1]; $hasta = $a[[array]::IndexOf($a, '--hasta') + 1]
    '[t] backfill pos-ndf · local=santa-teresa · entorno=prod · ingest=yiczgdti-ficticio.supabase.co · poll 75s/300s · ventana 36h'
    if ($a -contains '--dry-run') {
      if (-not $global:KIT.dry_sin_marca) { '[t] DRY-RUN: se lee y se cuenta, NO se envía nada.' }
      $d = [datetime]::ParseExact($desde, 'yyyy-MM-dd', $null); $i = 0; $tk = 0
      foreach ($cd in $global:KIT.dry) { $tk += $global:KIT.tickets; "[t]    $($d.AddDays($i).ToString('yyyy-MM-dd'))  tickets=$($global:KIT.tickets) líneas=150 con_descuento=$cd  (dry-run: NO se envía)"; $i++ }
      "[t] TOTAL · días=7 (vacíos 0) · tickets=$tk guardados=0 · líneas=1050 · errores=0 · $desde…$hasta"; return
    }
    $global:KIT.meses += $desde.Substring(0, 7)
    $global:KIT.ahora = $global:KIT.ahora.AddMinutes($global:KIT.min_por_mes)
    "[t]  $($desde.Substring(0, 7)) · días=30 (vacíos 0) · tickets=900 guardados=900 · líneas=4000 · errores=0 · $desde…$hasta"
    if ($global:KIT.falla_mes -eq $desde.Substring(0, 7)) { $global:LASTEXITCODE = 1 }
    return
  }
  throw "doble de node: llamada no prevista: $($a -join ' ')"
}
function Get-ScheduledTask([string]$TaskName) {
  [pscustomobject]@{ TaskName = $TaskName; State = $global:KIT.State; Principal = [pscustomobject]@{ UserId = 'SYSTEM' }
    Actions = @([pscustomobject]@{ Execute = $global:KIT.Execute; Arguments = $global:KIT.Arguments; WorkingDirectory = $global:KIT.WorkingDirectory }) }
}
function Get-ScheduledTaskInfo([string]$TaskName) { [pscustomobject]@{ LastRunTime = $global:KIT.ahora; LastTaskResult = 267009 } }
function Export-ScheduledTask([string]$TaskName) { '<?xml version="1.0" encoding="UTF-16"?><Task><!-- ficticia --></Task>' }
function Stop-ScheduledTask([string]$TaskName) { $global:KIT.State = 'Ready' }
function Start-ScheduledTask([string]$TaskName) { if (-not $global:KIT.no_arranca) { $global:KIT.State = 'Running' } }
function New-ScheduledTaskAction([string]$Execute, [string]$Argument, [string]$WorkingDirectory) { [pscustomobject]@{ Execute = $Execute; Arguments = $Argument; WorkingDirectory = $WorkingDirectory } }
function Set-ScheduledTask([string]$TaskName, $Action) { $global:KIT.Execute = $Action.Execute; $global:KIT.Arguments = $Action.Arguments; $global:KIT.WorkingDirectory = $Action.WorkingDirectory }
function Get-CimInstance([string]$ClassName, [string]$Filter) {
  $p = @([pscustomobject]@{ Name = 'cmd.exe'; ProcessId = 200; ParentProcessId = 4; CommandLine = 'cmd /c "C:\satori\pos-agente-staging.cmd"' },
         [pscustomobject]@{ Name = 'node.exe'; ProcessId = 201; ParentProcessId = 200; CommandLine = 'node --import ./pos-bridge/register.mjs pos-bridge/agente.ts' })
  if ($global:KIT.State -eq 'Running') {
    $p += [pscustomobject]@{ Name = 'cmd.exe'; ProcessId = 100; ParentProcessId = 4; CommandLine = "C:\Windows\system32\cmd.exe /c `"$($global:KIT.Execute)`"" }
    $p += [pscustomobject]@{ Name = 'node.exe'; ProcessId = 101; ParentProcessId = 100; CommandLine = 'node --import ./pos-bridge/register.mjs pos-bridge/agente.ts' }
  }
  if ($global:KIT.backfill_corriendo) { $p += [pscustomobject]@{ Name = 'node.exe'; ProcessId = 300; ParentProcessId = 9; CommandLine = 'node --import ./pos-bridge/register.mjs pos-bridge/backfill.ts --desde x' } }
  if ($Filter -match "name='([^']+)'") { $n = $Matches[1]; $p = @($p | Where-Object { $_.Name -eq $n }) }
  $p
}
function Start-Sleep { }

# ── 3. El preámbulo del paquete, tal cual; después, solo la hora y el admin son del kit ────────────────────────────
. ([scriptblock]::Create($B['P']))
function Hoy-CR { Hoy-CR-Doble }
function Es-Admin { $true }
$script:SALIDAS = New-Object System.Text.StringBuilder

function Correr([string]$k) {
  $sb = [scriptblock]::Create($B[$k])
  try { $o = (& $sb *>&1 | Out-String); [void]$script:SALIDAS.Append($o); @{ ok = $true; out = $o; err = '' } }
  catch { [void]$script:SALIDAS.Append($_.Exception.Message); @{ ok = $false; out = ''; err = $_.Exception.Message } }
}
function Espera-Ok([string]$k, [string]$marca) { $r = Correr $k; Resultado "$k pasa ($marca)" ($r.ok -and $r.out -match [regex]::Escape($marca)) "$($r.err)$(if ($r.ok) { ' · salida: ' + $r.out.Trim().Split("`n")[-1] })"; $r }
function Espera-Frena([string]$k, [string]$que, [string]$patron) { $r = Correr $k; Resultado "$k FRENA: $que" ((-not $r.ok) -and $r.err -match $patron) "$(if ($r.ok) { 'no frenó' } else { $r.err })"; $r }

# ── 4. Camino feliz: A0 … A6 y B1 completo ──────────────────────────────────────────────────────────────────────────
Nuevo-Kit
[void](Espera-Ok 'A0' 'A0 ok')
[void](Espera-Ok 'A1' 'A1 ok')
Resultado 'A1 hace el checkout en el SHA exacto' (@($global:KIT.git | Where-Object { $_ -match 'checkout --detach 578f38c039ec232d3818c1182d69d7f78f55b371' }).Count -eq 1)
[void](Espera-Ok 'A2' 'A2 ok')
Resultado 'A2 copió el .env idéntico' ((Get-FileHash (Join-Path (Join-Path $NUEVA 'pos-bridge') '.env')).Hash -eq (Get-FileHash (Join-Path (Join-Path $global:KIT.vieja 'pos-bridge') '.env')).Hash)
[void](Espera-Ok 'A3' '478 pruebas en verde')
$r = Espera-Ok 'A4' 'nada enviado'
Resultado 'A4 informa 44 de 210 (21 %)' ($r.out -match 'con_descuento 44 \(21 %\)|con_descuento 44 \(21,0 %\)|con_descuento 44 \(21\.0 %\)|con_descuento 44 \(21' ) $r.out
[void](Espera-Ok 'A5' 'A5 ok')
Resultado 'A5: la tarea corre el .cmd nuevo' ($global:KIT.Execute -eq $CMD_NUEVO)
$v = [IO.File]::ReadAllText($global:KIT.cmd); $n = [IO.File]::ReadAllText($CMD_NUEVO)
Resultado 'A5: el .cmd nuevo = el viejo con solo la carpeta cambiada' ($n.Replace($NUEVA, $global:KIT.vieja) -ceq $v -and $n -ne $v)
Resultado 'A5: guardó la config vieja (json y xml)' ((Test-Path (Join-Path $VUELTA 'tarea-antes.json')) -and (Test-Path (Join-Path $VUELTA 'tarea-antes.xml')))
[void](Espera-Ok 'A6' 'A6 ok')
Espera-Frena 'A5' 'repetido (la tarea ya corre la carpeta nueva)' 'ya corre la carpeta nueva' | Out-Null
$global:KIT.ahora = [datetime]'2026-11-18 00:05:00'
$r = Espera-Ok 'B1' 'HISTÓRICO COMPLETO'
Resultado 'B1 hizo 35 meses, del más nuevo al más viejo' ($global:KIT.meses.Count -eq 35 -and $global:KIT.meses[0] -eq '2026-11' -and $global:KIT.meses[-1] -eq '2024-01') "$($global:KIT.meses.Count): $($global:KIT.meses[0]) … $($global:KIT.meses[-1])"
$r = Espera-Ok 'B1' 'ya está completo'

# ── 5. Vuelta atrás (A7) después de A5 ──────────────────────────────────────────────────────────────────────────────
Nuevo-Kit
foreach ($k in 'A0', 'A1', 'A2', 'A3', 'A4', 'A5') { [void](Correr $k) }
Resultado 'A7: arranca con la tarea en el .cmd nuevo' ($global:KIT.Execute -eq $CMD_NUEVO)
[void](Espera-Ok 'A7' 'A7 ok')
Resultado 'A7: la tarea vuelve al .cmd viejo' ($global:KIT.Execute -eq $global:KIT.cmd)
Resultado 'A7: la carpeta de vuelta queda renombrada (no se borra)' (-not (Test-Path $VUELTA) -and @(Get-ChildItem $global:KIT.raiz -Directory | Where-Object Name -like 'd9-vuelta-usada-*').Count -eq 1)

# ── 6. Frenan cuando deben ───────────────────────────────────────────────────────────────────────────────────────────
Nuevo-Kit; $global:KIT.ahora = [datetime]'2026-11-17 16:30:00'
Espera-Frena 'A0' 'entre 15:50 y 19:00' '15:50 y 19:00' | Out-Null
Nuevo-Kit; $global:KIT.State = 'Ready'
Espera-Frena 'A0' 'tarea detenida' 'no está corriendo' | Out-Null
Nuevo-Kit; $global:KIT.sha_viejo = '4d3513a6df8e838dd5c0442b05a580e06ce9db9d'
Espera-Frena 'A0' 'agente de hoy en otro SHA' 'no en 5da233a' | Out-Null
Nuevo-Kit; $global:KIT.Execute = 'C:\Program Files\nodejs\node.exe'
Espera-Frena 'A0' 'la tarea no corre un .cmd' 'no un \.cmd' | Out-Null
Nuevo-Kit; $global:KIT.arbol = 'ffffffffffffffffffffffffffffffffffffffff'
[void](Correr 'A0'); Espera-Frena 'A1' 'árbol de pos-bridge distinto' 'no es el revisado' | Out-Null
Nuevo-Kit; [void](Correr 'A0'); [void](Correr 'A1')
$f = Join-Path (Join-Path $global:KIT.vieja 'pos-bridge') '.env'
[IO.File]::WriteAllText($f, ([IO.File]::ReadAllText($f) -replace "(?m)^INGEST_SECRET=.*$", 'INGEST_SECRET='))
$r = Espera-Frena 'A2' '.env sin INGEST_SECRET (dice solo el nombre)' 'faltan o están vacías \(solo nombres\): INGEST_SECRET'
foreach ($caso in @(@{ d = @(0, 0, 0, 0, 0, 0, 0); p = 'con_descuento = 0' }, @{ d = @(20, 20, 20, 20, 20, 20, 20); p = '> 50 %' })) {
  Nuevo-Kit; foreach ($k in 'A0', 'A1', 'A2', 'A3') { [void](Correr $k) }; $global:KIT.dry = $caso.d
  Espera-Frena 'A4' $caso.p ([regex]::Escape($caso.p)) | Out-Null
}
Nuevo-Kit; foreach ($k in 'A0', 'A1', 'A2', 'A3') { [void](Correr $k) }; $global:KIT.dry_sin_marca = $true
Espera-Frena 'A4' 'sin DRY-RUN en la salida' 'no dice DRY-RUN' | Out-Null
Nuevo-Kit; foreach ($k in 'A0', 'A1', 'A2', 'A3', 'A4') { [void](Correr $k) }; $global:KIT.backfill_corriendo = $true
Espera-Frena 'A5' 'hay un backfill corriendo' 'backfill corriendo' | Out-Null
Resultado 'A5 frenado no tocó la tarea' ($global:KIT.Execute -eq $global:KIT.cmd -and $global:KIT.State -eq 'Running')
Nuevo-Kit; foreach ($k in 'A0', 'A1', 'A2', 'A3', 'A4') { [void](Correr $k) }; $global:KIT.no_arranca = $true
Espera-Frena 'A5' 'el agente nuevo no arranca' 'correr A7' | Out-Null
$global:KIT.no_arranca = $false; [void](Espera-Ok 'A7' 'A7 ok')
# B1: ventana, mes con error (y retomar), corte de las 05:50 (y retomar la noche siguiente)
Nuevo-Kit; foreach ($k in 'A0', 'A1', 'A2', 'A3', 'A4', 'A5') { [void](Correr $k) }
$global:KIT.ahora = [datetime]'2026-11-18 07:00:00'
Espera-Frena 'B1' 'fuera de 00:00–06:00' 'solo de 00:00 a 06:00' | Out-Null
$global:KIT.ahora = [datetime]'2026-11-18 00:05:00'; $global:KIT.falla_mes = '2026-09'
Espera-Frena 'B1' 'mes con error, dice dónde quedó' 'PARADA en 2026-09.*pendiente 2024-01-01 … 2026-09-30' | Out-Null
$global:KIT.falla_mes = ''; $global:KIT.meses = @()
[void](Espera-Ok 'B1' 'retoma: falta 2024-01-01 … 2026-09-30')
Resultado 'B1 retomó desde el mes que falló' ($global:KIT.meses[0] -eq '2026-09')
Nuevo-Kit; foreach ($k in 'A0', 'A1', 'A2', 'A3', 'A4', 'A5') { [void](Correr $k) }
$global:KIT.ahora = [datetime]'2026-11-18 05:20:00'; $global:KIT.min_por_mes = 8
$r = Espera-Ok 'B1' 'CORTE 05:50'
Resultado 'B1 cortó antes de las 05:50' ($global:KIT.ahora -le [datetime]'2026-11-18 05:50:00' -and $global:KIT.meses.Count -ge 1) "hora $($global:KIT.ahora) · meses $($global:KIT.meses -join ',')"
$global:KIT.ahora = [datetime]'2026-11-19 00:01:00'; $global:KIT.min_por_mes = 2; $hechos = $global:KIT.meses.Count
$r = Espera-Ok 'B1' 'HISTÓRICO COMPLETO'
Resultado 'B1 retomó la noche siguiente y completó sin repetir meses' (($global:KIT.meses | Select-Object -Unique).Count -eq 35 -and $global:KIT.meses.Count -eq 35) "$($global:KIT.meses.Count) corridas"

# ── 7. Ningún valor del .env en ninguna salida ──────────────────────────────────────────────────────────────────────
$todo = $script:SALIDAS.ToString()
Resultado 'ninguna salida muestra el secreto ni la clave del PoS' (-not ($todo.Contains($SECRETO) -or $todo.Contains($CLAVEPOS)))

Write-Host ''
Write-Host "RESULTADO: $script:pasan PASS, $script:fallan FAIL"
if ($script:fallan) { exit 1 }
