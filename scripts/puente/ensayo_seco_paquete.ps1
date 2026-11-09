# Ensayo EN SECO de los bloques de PowerShell del paquete del pase (v2). PowerShell 5.1 y 7.
#
# INSTRUCCIONES (5 líneas):
#  1. En una PC Windows que NO sea la del PoS (si solo hay esa: igual sirve, el kit trabaja en una carpeta temporal y
#     se niega a correr dentro de C:\satori\satori-app-prod), con el repo bajado en la rama claude/puente-item11-prod-v2.
#  2. Abrir «Windows PowerShell» (5.1) y correr:  powershell -NoProfile -ExecutionPolicy Bypass -File <repo>\scripts\puente\ensayo_seco_paquete.ps1
#  3. Si está PowerShell 7, repetir con:          pwsh -NoProfile -ExecutionPolicy Bypass -File <repo>\scripts\puente\ensayo_seco_paquete.ps1
#  4. Cada línea dice PASS o FAIL; al final «RESULTADO: N PASS, M FAIL». Tiene que dar 0 FAIL en las dos versiones.
#  5. Mandar a Claude la salida completa (no tiene secretos: todos los datos y el mapa son ficticios). Nada toca la red.
#
# (Este archivo va en UTF-8 CON BOM a propósito: PowerShell 5.1 lee un .ps1 sin BOM como ANSI.)
# Qué hace: lee los bloques ```powershell del paquete (docs/puente/PASE-PROD-2026-11-09.md) TAL CUAL, cambia C:\satori
# por una carpeta temporal nueva y los corre en orden con «dobles» de git, supabase, node, npm, cmd, curl.exe y las
# tareas programadas: NADA sale a la red (ni a GitHub, ni a Supabase, ni a prod) y no se toca ninguna tarea real.
# Los .sql son ficticios: el kit pone sus md5 en lugar de los reales (lo que se prueba es el mecanismo: fail-stop,
# $LASTEXITCODE, rutas, md5 de bytes, BOM/UTF-8, temporales, huella). Después prueba que el paquete FRENA cuando debe.
param([string]$Paquete = (Join-Path $PSScriptRoot '..\..\docs\puente\PASE-PROD-2026-11-09.md'))

$ErrorActionPreference = 'Stop'
$script:pasan = 0; $script:fallan = 0
function Resultado([string]$nombre, [bool]$ok, [string]$det = '') {
  if ($ok) { $script:pasan++; Write-Host "PASS  $nombre" -ForegroundColor Green }
  else { $script:fallan++; Write-Host "FAIL  $nombre  $det" -ForegroundColor Red }
}
Write-Host "Ensayo en seco del paquete · PowerShell $($PSVersionTable.PSVersion) · $($PSVersionTable.PSEdition)"

# ── Seguridad: nunca dentro de la carpeta del agente ──────────────────────────────────────────────────────────────
$aqui = (Get-Location).Path
if ($aqui -like '*\satori-app-prod*' -or $PSScriptRoot -like '*\satori-app-prod*') { throw 'NO: este kit no se corre dentro de la carpeta del agente (satori-app-prod).' }
$RAIZ = Join-Path ([IO.Path]::GetTempPath()) ("satori-ensayo-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $RAIZ | Out-Null
$LAD_ANTES = $env:LOCALAPPDATA
$env:LOCALAPPDATA = Join-Path $RAIZ 'localappdata'; New-Item -ItemType Directory -Force $env:LOCALAPPDATA | Out-Null

# ── Datos ficticios ───────────────────────────────────────────────────────────────────────────────────────────────
$utf8 = New-Object Text.UTF8Encoding($false)
function Md5DeBytes([byte[]]$b) { -join ([Security.Cryptography.MD5]::Create().ComputeHash($b) | ForEach-Object { $_.ToString('x2') }) }
function Sha256Texto([string]$t) { -join ([Security.Cryptography.SHA256]::Create().ComputeHash($utf8.GetBytes($t)) | ForEach-Object { $_.ToString('x2') }) }
$F081 = $utf8.GetBytes("-- 081 FICTICIA (ensayo en seco)`nalter table public.ejemplo add column if not exists campo text;`n")
$F082 = $utf8.GetBytes("-- 082 FICTICIA (ensayo en seco)`nbegin;`ncreate or replace function public.ejemplo() returns int language sql as `$f`$ select 1 `$f`$;`ncommit;`n")
$F081RB = $utf8.GetBytes("-- rollback 081 FICTICIO`n")
$FINDEX = $utf8.GetBytes("// index.ts FICTICIO del Edge v1`n")
$MD5_081 = Md5DeBytes $F081; $MD5_082 = Md5DeBytes $F082; $MD5_081RB = Md5DeBytes $F081RB
$global:KIT = @{ falla_git = $null; huella_mal = $false; node_falla = $false; f082 = $F082; tarea = 'Running'; secretos = @{}; tarea_dir = 'C:\satori\satori-app-prod' }

# ── Dobles de los comandos (las funciones le ganan a los .exe en PowerShell) ─────────────────────────────────────
function git {
  $a = @($args); $global:LASTEXITCODE = 0
  if ($global:KIT.falla_git -and ($a -contains $global:KIT.falla_git)) { $global:LASTEXITCODE = 1; Write-Host "  (doble de git: falla «$($global:KIT.falla_git)» a propósito)"; return }
  if ($a[0] -eq 'clone') {   # el «clon»: solo lo que los bloques verifican que exista
    $c = [string]$a[-1]; New-Item -ItemType Directory -Force (Join-Path $c 'scripts\puente') | Out-Null
    [IO.File]::WriteAllText((Join-Path $c 'scripts\puente\armar_mapa_secretos.mjs'), '// ficticio', $utf8); return
  }
  $dir = ''; if ($a[0] -eq '-C') { $dir = [string]$a[1]; $a = @($a[2..($a.Count - 1)]) }
  switch ($a[0]) {
    'rev-parse' { if ($dir -like '*ingest-ndf-v1*' -or $dir -like '*satori-app-prod*') { '4d3513a6df8e838dd5c0442b05a580e06ce9db9d' } else { '5da233a516d1a6c4c2c95eb165be448be5416697' } }
    'diff' { if ($a -contains '--name-only') { 'src/shared/ndf/ingestNdf.test.ts'; 'src/shared/ndf/ingestNdf.ts'; 'supabase/functions/ingest-ndf/README.md'; 'supabase/functions/ingest-ndf/index.ts'; 'supabase/migrations/082_pos_ndf_ingesta_transaccional.sql' } }
    'worktree' { New-Item -ItemType Directory -Force ([string]$a[2]) | Out-Null }
    default { }
  }
}
function cmd {
  $linea = ($args -join ' '); $global:LASTEXITCODE = 0
  if ($linea -notmatch 'show\s+([0-9A-Za-z/._-]+):(\S+)\s*>\s*"([^"]+)"') { $global:LASTEXITCODE = 1; return }
  $ruta = $Matches[2]; $destino = $Matches[3]
  $b = if ($ruta -like '*081_pos_ndf*') { $F081 } elseif ($ruta -like '*082_pos_ndf*') { $global:KIT.f082 } elseif ($ruta -like '*081_rollback*') { $F081RB } elseif ($ruta -like '*ingest-ndf/index.ts') { $FINDEX } else { $null }
  if ($null -eq $b) { $global:LASTEXITCODE = 1; return }
  [IO.File]::WriteAllBytes($destino, $b)
}
function supabase {
  $a = @($args); $global:LASTEXITCODE = 0
  if ($a[0] -eq 'secrets' -and $a[1] -eq 'set') {
    $f = [string]$a[[array]::IndexOf($a, '--env-file') + 1]
    $t = [IO.File]::ReadAllText($f, $utf8).Trim()
    if ($t -match "^([A-Z_]+)='(.*)'$") { $global:KIT.secretos[$Matches[1]] = Sha256Texto $Matches[2] } else { $global:LASTEXITCODE = 1 }
    return
  }
  if ($a[0] -eq 'secrets' -and $a[1] -eq 'list') {
    $items = foreach ($k in $global:KIT.secretos.Keys) { $v = if ($global:KIT.huella_mal) { '0' * 64 } else { $global:KIT.secretos[$k] }; '{"name":"' + $k + '","value":"' + $v + '"}' }
    '[' + (@($items) -join ',') + ']'; return
  }
  if ($a[0] -eq 'functions' -and $a[1] -eq 'download') {
    $d = Join-Path (Get-Location).Path 'supabase\functions\ingest-ndf'; New-Item -ItemType Directory -Force $d | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $d 'index.ts'), $FINDEX); return
  }
  'ok (doble de supabase)'
}
function node {
  $a = @($args); $global:LASTEXITCODE = 0
  if ($global:KIT.node_falla) { $global:LASTEXITCODE = 1; return }
  if ($a -contains '--solo-medir') { '{"archivo_que_manda":"pos-bridge/.env","largo_santa_teresa":64,"cumple_32":true}'; return }
  $salida = [string]$a[[array]::IndexOf($a, '--salida') + 1]
  $r = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($r); $st = -join ($r | ForEach-Object { $_.ToString('x2') })
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($r); $no = -join ($r | ForEach-Object { $_.ToString('x2') })
  $json = '{"santa-teresa":"' + $st + '","nosara":"' + $no + '"}'
  [IO.File]::WriteAllText($salida, "POS_INGEST_SECRETS='$json'`n", $utf8)
  $h = Sha256Texto $json; $camb = if ($a -contains '--nuevo-santa-teresa') { 'true' } else { 'false' }
  $completa = if ($a -contains '--huella-completa') { ',"sha256_mapa":"' + $h + '"' } else { '' }
  '{"archivo_que_manda":"pos-bridge/.env","largo_santa_teresa":64,"santa_teresa_cambiado":' + $camb + ',"huella_12":"' + $h.Substring(0, 12) + '"' + $completa + '}'
}
function npm { $global:LASTEXITCODE = 0; 'ok (doble de npm)' }
function curl.exe { $global:LASTEXITCODE = 0; 'HTTP/2 401 (doble)' }
function Get-ScheduledTask { param([string]$TaskName)   # SYSTEM: en el runner su entorno (HKU\S-1-5-18) existe y se lee de verdad
  [pscustomobject]@{ TaskName = $TaskName; State = $global:KIT.tarea; Principal = [pscustomobject]@{ UserId = 'SYSTEM'; LogonType = 'ServiceAccount' }
    Actions = @([pscustomobject]@{ Execute = 'C:\Program Files\nodejs\node.exe'; Arguments = "$($global:KIT.tarea_dir)\pos-bridge\agente.ts"; WorkingDirectory = $global:KIT.tarea_dir }) } }
function Stop-ScheduledTask { param([string]$TaskName) $global:KIT.tarea = 'Ready' }
function Start-ScheduledTask { param([string]$TaskName) $global:KIT.tarea = 'Running' }
function Get-CimInstance { @() }

# ── Bloques del paquete ───────────────────────────────────────────────────────────────────────────────────────────
$doc = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Paquete).Path, $utf8)
$bloques = @([regex]::Matches($doc, '(?s)```powershell\r?\n(.*?)```') | ForEach-Object { $_.Groups[1].Value })
if ($bloques.Count -lt 10) { throw "el paquete tiene solo $($bloques.Count) bloques de PowerShell: ¿es el archivo correcto?" }
function Preparar([string]$t, [string]$raiz) {
  $t.Replace('C:\satori', $raiz).Replace('d4acf8dafc964ed23072aa49098f5b42', $MD5_081).Replace('edb7ffc58976804e55968f75df530a05', $MD5_082).Replace('5faa677d99f68c9c16dbd3a8a1c804d0', $MD5_081RB)
}
function Nombre([string]$t) { ($t -split "`n" | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') } | Select-Object -First 1).Trim() }
function Preparar-Agente([string]$raiz) {   # la carpeta del agente FICTICIA (solo lo que los bloques miran)
  New-Item -ItemType Directory -Force (Join-Path $raiz 'satori-app-prod\pos-bridge') | Out-Null
  [IO.File]::WriteAllText((Join-Path $raiz 'satori-app-prod\pos-bridge\register.mjs'), '// ficticio', $utf8)
  [IO.File]::WriteAllText((Join-Path $raiz 'satori-app-prod\pos-bridge\.env.antes-pase'), "INGEST_SECRET=ficticio`n", $utf8)   # 9.0 la borra
}
Preparar-Agente $RAIZ

try {
  # 1) todos los bloques, en orden, en el mismo ámbito (como en una consola)
  $i = 0
  foreach ($b in $bloques) {
    $i++
    try { . ([scriptblock]::Create((Preparar $b $RAIZ))); Resultado ("bloque {0,2}: {1}" -f $i, (Nombre $b).Substring(0, [Math]::Min(70, (Nombre $b).Length))) $true }
    catch { Resultado ("bloque {0,2}: {1}" -f $i, (Nombre $b)) $false $_.Exception.Message }
  }
  $quedan = @(Get-ChildItem -LiteralPath $env:LOCALAPPDATA -Filter 'satori-pase*.env' -ErrorAction SilentlyContinue)
  Resultado 'no quedó ningún archivo del mapa de secretos en LOCALAPPDATA' ($quedan.Count -eq 0) "$($quedan.Count) archivos"
  Resultado '9.0 borró la copia .antes-pase del agente (ficticia)' (-not (Test-Path -LiteralPath (Join-Path $RAIZ 'satori-app-prod\pos-bridge\.env.antes-pase')))
  Resultado 'los dos bloques del ledger se generaron (bloque_081.sql y bloque_082.sql)' ((Test-Path (Join-Path $RAIZ 'pase-sql\bloque_081.sql')) -and (Test-Path (Join-Path $RAIZ 'pase-sql\bloque_082.sql')))
  $b2 = [IO.File]::ReadAllText((Join-Path $RAIZ 'pase-sql\bloque_082.sql'), $utf8)
  Resultado 'bloque_082: un solo begin/commit, con los dos timeouts, y el archivo original en el ledger' (([regex]::Matches($b2, '(?m)^begin;$').Count -eq 2) -and $b2.StartsWith("begin;`nset local lock_timeout = '5s';") -and $b2.TrimEnd().EndsWith('commit;'))
  $bytes = [IO.File]::ReadAllBytes((Join-Path $RAIZ 'pase-sql\bloque_082.sql'))
  Resultado 'bloque_082 sin BOM' (-not ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF))

  # 2) el paquete FRENA cuando debe (cada caso en una carpeta temporal nueva)
  function Frena([string]$caso, [int]$nBloque, [string]$espera, [scriptblock]$preparar) {
    $r2 = Join-Path ([IO.Path]::GetTempPath()) ("satori-ensayo-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force $r2 | Out-Null; Preparar-Agente $r2
    $global:KIT.falla_git = $null; $global:KIT.huella_mal = $false; $global:KIT.node_falla = $false; $global:KIT.f082 = $F082
    try {
      . ([scriptblock]::Create((Preparar $bloques[0] $r2)))          # el preámbulo fail-stop
      for ($kitK = 1; $kitK -lt $nBloque - 1; $kitK++) { . ([scriptblock]::Create((Preparar $bloques[$kitK] $r2))) }   # nombre propio: los bloques corren en este ámbito   # lo previo, bien
      & $preparar $r2
      . ([scriptblock]::Create((Preparar $bloques[$nBloque - 1] $r2)))
      Resultado "frena: $caso" $false 'el bloque NO cortó'
    } catch { Resultado "frena: $caso" ($_.Exception.Message -like "*$espera*") $_.Exception.Message }
    finally { Remove-Item -LiteralPath $r2 -Recurse -Force -ErrorAction SilentlyContinue }
  }
  $n04 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'git clone' } | Select-Object -First 1))
  $n05 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'Get-ChildItem -LiteralPath \$SQL -File' } | Select-Object -First 1))
  $n2  = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'function Armar-Bloque' } | Select-Object -First 1))
  $n32 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'secrets set --env-file' } | Select-Object -First 1))
  $n19 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'Principal.UserId' } | Select-Object -First 1))
  Frena 'un comando nativo que falla (git fetch) corta con su código' $n04 'falló «fetch»' { param($r) $global:KIT.falla_git = 'fetch' }
  Frena 'la 082 con otros bytes: md5 distinto antes de seguir' $n05 '082: md5 distinto' { param($r) $global:KIT.f082 = $utf8.GetBytes("-- otra cosa`n") }
  Frena 'generar con un .sql con BOM no genera nada' $n2 'md5 distinto' { param($r) [IO.File]::WriteAllBytes((Join-Path $r 'pase-sql\082.sql'), [byte[]](@(0xEF, 0xBB, 0xBF) + $F082)) }
  Frena 'la huella del panel no coincide con la del mapa' $n32 'huella del panel' { param($r) $global:KIT.huella_mal = $true }
  Frena 'el armado del mapa falla (node con error)' $n32 'armar mapa' { param($r) $global:KIT.node_falla = $true }
  Frena '1.9: la tarea no corre el agente de satori-app-prod' $n19 'la tarea no corre' { param($r) $global:KIT.tarea_dir = 'C:\otra\carpeta' }
  $global:KIT.tarea_dir = 'C:\satori\satori-app-prod'
  # el generador no deja NADA si algo falla (082 alterada en la carpeta del ensayo principal)
  $SQLD = Join-Path $RAIZ 'pase-sql'
  Get-ChildItem -LiteralPath $SQLD -Filter 'bloque_*' | Remove-Item -Force
  [IO.File]::WriteAllBytes((Join-Path $SQLD '082.sql'), [byte[]](@(0xEF, 0xBB, 0xBF) + $F082))
  try { . ([scriptblock]::Create((Preparar $bloques[$n2 - 1] $RAIZ))); Resultado 'frena: el generador con la 082 alterada' $false }
  catch { Resultado 'frena: el generador con la 082 alterada' $true }
  Resultado 'y no dejó bloque_*.sql ni temporales' (@(Get-ChildItem -LiteralPath $SQLD -Filter 'bloque_*').Count -eq 0)
  # funciones sueltas del preámbulo y del generador
  . ([scriptblock]::Create((Preparar $bloques[0] $RAIZ)))
  try { Carpeta 'pase-v2' | Out-Null; Resultado 'frena: ruta relativa en Carpeta' $false } catch { Resultado 'frena: ruta relativa en Carpeta' ($_.Exception.Message -like '*absoluta*') }
  . ([scriptblock]::Create(((Preparar $bloques[$n2 - 1] $RAIZ) -split "`n" | Where-Object { $_ -notmatch '^\$(b1|b2|u) =|WriteAllText|Move-Item|"bloques ok"' }) -join "`n"))
  $bom = Join-Path $RAIZ 'con_bom.sql'; [IO.File]::WriteAllBytes($bom, [byte[]](@(0xEF, 0xBB, 0xBF) + $F082))
  try { Armar-Bloque $bom '082' 'x' (Md5DeBytes ([IO.File]::ReadAllBytes($bom))) | Out-Null; Resultado 'frena: BOM detectado (con su md5 correcto)' $false } catch { Resultado 'frena: BOM detectado (con su md5 correcto)' ($_.Exception.Message -like '*BOM*') }
  $mal = Join-Path $RAIZ 'utf8_malo.sql'; [IO.File]::WriteAllBytes($mal, [byte[]](0x2D, 0x2D, 0x20, 0xC3, 0x28, 0x0A))
  try { Armar-Bloque $mal '082' 'x' (Md5DeBytes ([IO.File]::ReadAllBytes($mal))) | Out-Null; Resultado 'frena: UTF-8 inválido' $false } catch { Resultado 'frena: UTF-8 inválido' $true }
} finally {
  $env:LOCALAPPDATA = $LAD_ANTES
  Remove-Item -LiteralPath $RAIZ -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host "RESULTADO: $script:pasan PASS, $script:fallan FAIL  (PowerShell $($PSVersionTable.PSVersion))"
if ($script:fallan -gt 0) { exit 1 } else { exit 0 }
