# Ensayo EN SECO de los bloques de PowerShell del paquete del pase. PowerShell 5.1 y 7.
# (09-nov, después del pase real) Los dobles imitan la PC del PoS como resultó ser: la tarea corre un .cmd; `npm` (el
# .ps1) está bloqueado y va `npm.cmd`; sin Docker, `functions download`/`deploy` necesitan --use-api y la descarga
# rechaza src/shared; los scripts del pase llegan por `git show` del commit del paquete (no están en el clon).
# Con el paquete del 09-nov (PASE-PROD-2026-11-09.md) este kit da FAIL justo en esos puntos; con la plantilla, 0 FAIL.
# (09-nov tarde, Grok 120/121) 1.9 se prueba con tres cuentas REALES de la máquina: SYSTEM, LOCAL SERVICE y una sin perfil
# cargado (Invitado: su NTUSER.DAT se monta y se desmonta; hace falta consola de administrador). Un secreto corto es PARADA.
# Con -Paquete docs/puente/ROTACION-SECRETO-AGENTE.md corre el procedimiento aparte de rotación (Grok 120).
# Con -Paquete docs/puente/PASE-AGENTE-PROD.md corre el pase del agente nuevo (carpeta nueva, .env copiado con la
# firma del candado, .cmd nuevo, cambio de la acción de la tarea y la vuelta atrás) y prueba que frena cuando debe.
#
# INSTRUCCIONES (5 líneas):
#  1. En una PC Windows que NO sea la del PoS (si solo hay esa: igual sirve, el kit trabaja en una carpeta temporal y
#     se niega a correr dentro de C:\satori\satori-app-prod), con el repo bajado en la rama del paquete.
#  2. Abrir «Windows PowerShell» (5.1) y correr:  powershell -NoProfile -ExecutionPolicy Bypass -File <repo>\scripts\puente\ensayo_seco_paquete.ps1
#  3. Si está PowerShell 7, repetir con:          pwsh -NoProfile -ExecutionPolicy Bypass -File <repo>\scripts\puente\ensayo_seco_paquete.ps1
#  4. Cada línea dice PASS o FAIL; al final «RESULTADO: N PASS, M FAIL». Tiene que dar 0 FAIL en las dos versiones.
#  5. Mandar a Claude la salida completa (no tiene secretos: todos los datos y el mapa son ficticios). Nada toca la red.
#
# (Este archivo va en UTF-8 CON BOM a propósito: PowerShell 5.1 lee un .ps1 sin BOM como ANSI.)
# Qué hace: lee los bloques ```powershell del paquete (por defecto docs/puente/PASE-PROD-PLANTILLA.md) TAL CUAL, cambia C:\satori
# por una carpeta temporal nueva y los corre en orden con «dobles» de git, supabase, node, npm, cmd, curl.exe y las
# tareas programadas: NADA sale a la red (ni a GitHub, ni a Supabase, ni a prod) y no se toca ninguna tarea real.
# Los .sql son ficticios: el kit pone sus md5 en lugar de los reales (lo que se prueba es el mecanismo: fail-stop,
# $LASTEXITCODE, rutas, md5 de bytes, BOM/UTF-8, temporales, huella). Después prueba que el paquete FRENA cuando debe.
param([string]$Paquete = (Join-Path $PSScriptRoot '..\..\docs\puente\PASE-PROD-PLANTILLA.md'))

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
$FMAPA = $utf8.GetBytes("// armar_mapa_secretos.mjs FICTICIO (ensayo en seco)`n")
$MD5_081 = Md5DeBytes $F081; $MD5_082 = Md5DeBytes $F082; $MD5_081RB = Md5DeBytes $F081RB; $MD5_MAPA = Md5DeBytes $FMAPA
$global:KIT = @{ falla_git = $null; huella_mal = $false; node_falla = $false; f082 = $F082; fmapa = $FMAPA; cli = '2.122.0'; tarea = 'Running'; secretos = @{}; cmd = $null; cuenta = 'SYSTEM'; corto = $false; arbol_mal = $false; medir_distinto = $false }

# ── Dobles de los comandos (las funciones le ganan a los .exe en PowerShell) ─────────────────────────────────────
function git {
  $a = @($args); $global:LASTEXITCODE = 0
  if ($global:KIT.falla_git -and ($a -contains $global:KIT.falla_git)) { $global:LASTEXITCODE = 1; Write-Host "  (doble de git: falla «$($global:KIT.falla_git)» a propósito)"; return }
  if ($a[0] -eq 'clone') {   # el «clon» del CÓDIGO: sin scripts/puente (09-nov: los scripts salen del commit del paquete)
    $c = [string]$a[-1]; New-Item -ItemType Directory -Force (Join-Path $c 'pos-bridge') | Out-Null
    [IO.File]::WriteAllText((Join-Path $c 'pos-bridge\register.mjs'), '// ficticio', $utf8); return   # el agente del clon
  }
  $dir = ''; if ($a[0] -eq '-C') { $dir = [string]$a[1]; $a = @($a[2..($a.Count - 1)]) }
  switch ($a[0]) {
    'rev-parse' { if (($a -join ' ') -match ':pos-bridge') { if ($global:KIT.arbol_mal) { '0000000000000000000000000000000000000000' } else { '5600ebbd287559b23667f61c6e4c90181fa24b8e' }; return }
                  if ($dir -like '*ingest-ndf-v1*' -or $dir -like '*satori-app-prod*') { '4d3513a6df8e838dd5c0442b05a580e06ce9db9d' } else { '5da233a516d1a6c4c2c95eb165be448be5416697' } }
    'cat-file' { }
    'diff' { if ($a -contains 'cd6d5a1ceb7adf06a0f79b780f126a4263884ca3') { return }   # código → paquete: sin cambios en supabase/src
             if ($a -contains '--name-only') { 'src/shared/ndf/ingestNdf.test.ts'; 'src/shared/ndf/ingestNdf.ts'; 'supabase/functions/ingest-ndf/README.md'; 'supabase/functions/ingest-ndf/index.ts'; 'supabase/migrations/082_pos_ndf_ingesta_transaccional.sql' } }
    'worktree' { New-Item -ItemType Directory -Force ([string]$a[2]) | Out-Null }
    default { }
  }
}
function cmd {
  $linea = ($args -join ' '); $global:LASTEXITCODE = 0
  if ($linea -notmatch 'show\s+([0-9A-Za-z/._-]+):(\S+)\s*>\s*"([^"]+)"') { $global:LASTEXITCODE = 1; return }
  $ruta = $Matches[2]; $destino = $Matches[3]
  $b = if ($ruta -like '*081_pos_ndf*') { $F081 } elseif ($ruta -like '*082_pos_ndf*') { $global:KIT.f082 } elseif ($ruta -like '*081_rollback*') { $F081RB } elseif ($ruta -like '*ingest-ndf/index.ts') { $FINDEX } elseif ($ruta -like '*scripts/puente/armar_mapa_secretos.mjs') { $global:KIT.fmapa } else { $null }
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
  if ($a[0] -eq '--version') { $global:KIT.cli; return }
  # 09-nov: la PC no tiene Docker. Sin --use-api, download y deploy fallan.
  if ($a[0] -eq 'functions' -and $a -notcontains '--use-api') { Write-Host '  (doble de supabase: sin Docker, se necesita --use-api)'; $global:LASTEXITCODE = 1; return }
  if ($a[0] -eq 'functions' -and $a[1] -eq 'download') {   # 09-nov: baja solo el index.ts y rechaza src/shared
    $d = Join-Path (Get-Location).Path 'supabase\functions\ingest-ndf'; New-Item -ItemType Directory -Force $d | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $d 'index.ts'), $FINDEX)
    Write-Host '  (doble de supabase: refusing to extract outside supabase/functions: src/shared/...)'; $global:LASTEXITCODE = 1; return
  }
  'ok (doble de supabase)'
}
function node {
  $a = @($args); $global:LASTEXITCODE = 0
  if ($global:KIT.node_falla) { $global:LASTEXITCODE = 1; return }
  if ($a -contains '--solo-medir' -and $global:KIT.medir_distinto -and ([string]$a[[array]::IndexOf($a, '--agente') + 1] -like '*agente-prod-*')) { '{"archivo_que_manda":"pos-bridge/.env","largo_santa_teresa":63,"cumple_32":true}'; return }
  if ($a -contains '--solo-medir') { if ($global:KIT.corto) { '{"archivo_que_manda":"pos-bridge/.env","largo_santa_teresa":20,"cumple_32":false}' } else { '{"archivo_que_manda":"pos-bridge/.env","largo_santa_teresa":64,"cumple_32":true}' }; return }
  $salida = [string]$a[[array]::IndexOf($a, '--salida') + 1]
  $r = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($r); $st = -join ($r | ForEach-Object { $_.ToString('x2') })
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($r); $no = -join ($r | ForEach-Object { $_.ToString('x2') })
  $json = '{"santa-teresa":"' + $st + '","nosara":"' + $no + '"}'
  [IO.File]::WriteAllText($salida, "POS_INGEST_SECRETS='$json'`n", $utf8)
  $h = Sha256Texto $json; $camb = if ($a -contains '--nuevo-santa-teresa') { 'true' } else { 'false' }
  $completa = if ($a -contains '--huella-completa') { ',"sha256_mapa":"' + $h + '"' } else { '' }
  '{"archivo_que_manda":"pos-bridge/.env","largo_santa_teresa":64,"santa_teresa_cambiado":' + $camb + ',"huella_12":"' + $h.Substring(0, 12) + '"' + $completa + '}'
}
function npm { throw 'npm.ps1 no se puede cargar: la ejecución de scripts está deshabilitada en este sistema (doble, como la PC del PoS el 09-nov)' }
function npm.cmd { $global:LASTEXITCODE = 0; 'ok (doble de npm.cmd)' }
function curl.exe { $global:LASTEXITCODE = 0; 'HTTP/2 401 (doble)' }
function Get-ScheduledTask { param([string]$TaskName)   # SYSTEM: en el runner su entorno (HKU\S-1-5-18) existe y se lee de verdad
  [pscustomobject]@{ TaskName = $TaskName; State = $global:KIT.tarea; Principal = [pscustomobject]@{ UserId = $global:KIT.cuenta; GroupId = $null; LogonType = 'ServiceAccount' }
    Actions = @([pscustomobject]@{ Execute = $global:KIT.cmd; Arguments = $null; WorkingDirectory = $null }) } }   # 09-nov: la acción es un .cmd
function Stop-ScheduledTask { param([string]$TaskName) $global:KIT.tarea = 'Ready' }
function New-ScheduledTaskAction { param([string]$Execute, [string]$Argument, [string]$WorkingDirectory)
  [pscustomobject]@{ Execute = $Execute; Arguments = $Argument; WorkingDirectory = $WorkingDirectory } }
function Set-ScheduledTask { param([string]$TaskName, $Action) $global:KIT.cmd = [string]$Action.Execute; [pscustomobject]@{ TaskName = $TaskName } }
function Start-ScheduledTask { param([string]$TaskName) $global:KIT.tarea = 'Running' }
function Get-CimInstance { @() }

# ── Bloques del paquete ───────────────────────────────────────────────────────────────────────────────────────────
$doc = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Paquete).Path, $utf8)
$bloques = @([regex]::Matches($doc, '(?s)```powershell\r?\n(.*?)```') | ForEach-Object { $_.Groups[1].Value })
$esRotacion = ([IO.Path]::GetFileName($Paquete) -like 'ROTACION*')
$esAgente = ([IO.Path]::GetFileName($Paquete) -like 'PASE-AGENTE*')
if ($bloques.Count -lt $(if ($esRotacion -or $esAgente) { 6 } else { 10 })) { throw "el paquete tiene solo $($bloques.Count) bloques de PowerShell: ¿es el archivo correcto?" }
function Preparar([string]$t, [string]$raiz) {
  $t.Replace('C:\satori', $raiz).Replace('73c4d9d207c22c13d5c42498bb63e8ca', $MD5_MAPA).Replace('d4acf8dafc964ed23072aa49098f5b42', $MD5_081).Replace('edb7ffc58976804e55968f75df530a05', $MD5_082).Replace('5faa677d99f68c9c16dbd3a8a1c804d0', $MD5_081RB)
}
function Nombre([string]$t) { ($t -split "`n" | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') } | Select-Object -First 1).Trim() }
function Preparar-Agente([string]$raiz) {   # la carpeta del agente FICTICIA (solo lo que los bloques miran)
  New-Item -ItemType Directory -Force (Join-Path $raiz 'satori-app-prod\pos-bridge') | Out-Null
  [IO.File]::WriteAllText((Join-Path $raiz 'satori-app-prod\pos-bridge\register.mjs'), '// ficticio', $utf8)
  [IO.File]::WriteAllText((Join-Path $raiz 'satori-app-prod\pos-bridge\.env.antes-pase'), "INGEST_SECRET=ficticio`n", $utf8)   # 9.0 la borra
  [IO.File]::WriteAllText((Join-Path $raiz 'satori-app-prod\pos-bridge\.env'), "LOCAL=santa-teresa`r`nINGEST_SECRET=ficticio-ficticio-ficticio-ficticio-0123`r`n", $utf8)   # el .env del agente (ficticio)
  New-Item -ItemType Directory -Force (Join-Path $raiz 'satori-app\pos-bridge') | Out-Null                                        # agente de STAGING (rotación R1)
  [IO.File]::WriteAllText((Join-Path $raiz 'satori-app\pos-bridge\register.mjs'), '// ficticio', $utf8)
  [IO.File]::WriteAllText((Join-Path $raiz 'satori-app\pos-bridge\.env.antes-pase'), "INGEST_SECRET=ficticio`n", $utf8)        # R6 la borra
  # 09-nov: la tarea corre C:\satori\pos-agente-prod.cmd (cd /d a la carpeta del agente y node)
  $global:KIT.cmd = Join-Path $raiz 'pos-agente-prod.cmd'
  [IO.File]::WriteAllText($global:KIT.cmd, "@echo off`r`ncd /d $raiz\satori-app-prod`r`n`"C:\Program Files\nodejs\node.exe`" --import ./pos-bridge/register.mjs pos-bridge/agente.ts`r`n", $utf8)
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
  # 2) el paquete FRENA cuando debe (cada caso en una carpeta temporal nueva)
  function Frena([string]$caso, [int]$nBloque, [string]$espera, [scriptblock]$preparar) {
    $r2 = Join-Path ([IO.Path]::GetTempPath()) ("satori-ensayo-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force $r2 | Out-Null; Preparar-Agente $r2
    $global:KIT.falla_git = $null; $global:KIT.huella_mal = $false; $global:KIT.node_falla = $false; $global:KIT.f082 = $F082; $global:KIT.fmapa = $FMAPA; $global:KIT.cli = '2.122.0'; $global:KIT.tarea = 'Running'; $global:KIT.corto = $false; $global:KIT.cuenta = 'SYSTEM'; $global:KIT.arbol_mal = $false; $global:KIT.medir_distinto = $false
    try {
      . ([scriptblock]::Create((Preparar $bloques[0] $r2)))          # el preámbulo fail-stop
      for ($kitK = 1; $kitK -lt $nBloque - 1; $kitK++) { . ([scriptblock]::Create((Preparar $bloques[$kitK] $r2))) }   # nombre propio: los bloques corren en este ámbito   # lo previo, bien
      & $preparar $r2
      . ([scriptblock]::Create((Preparar $bloques[$nBloque - 1] $r2)))
      Resultado "frena: $caso" $false 'el bloque NO cortó'
    } catch { Resultado "frena: $caso" ($_.Exception.Message -like "*$espera*") $_.Exception.Message }
    finally { Remove-Item -LiteralPath $r2 -Recurse -Force -ErrorAction SilentlyContinue }
  }
  if ($esRotacion) {
    # ── Rotación del secreto del agente (Grok 120): procedimiento aparte, con su vuelta atrás ──
    $quedan = @(Get-ChildItem -LiteralPath $env:LOCALAPPDATA -Filter 'satori-rotacion*.env' -ErrorAction SilentlyContinue)
    Resultado 'rotación: no quedó ningún archivo del mapa en LOCALAPPDATA' ($quedan.Count -eq 0) "$($quedan.Count) archivos"
    Resultado 'rotación: R6 borró la copia .antes-pase del agente (ficticia)' (-not (Test-Path -LiteralPath (Join-Path $RAIZ 'satori-app\pos-bridge\.env.antes-pase')))
    $nR4 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'secrets set --env-file' } | Select-Object -First 1))
    Frena 'rotación: la huella del panel no coincide' $nR4 'huella del panel' { param($r) $global:KIT.huella_mal = $true }
    Frena 'rotación: R4 con la tarea andando' $nR4 'la tarea no está detenida' { param($r) $global:KIT.tarea = 'Running' }
    $nR1 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match '\$ENTORNO = ' } | Select-Object -First 1))
    try { . ([scriptblock]::Create((Preparar $bloques[0] $RAIZ))); . ([scriptblock]::Create(((Preparar $bloques[$nR1 - 1] $RAIZ) -replace "\`$ENTORNO = 'staging'", "`$ENTORNO = 'otro'")))
          Resultado 'frena: rotación con ENTORNO que no es staging ni prod' $false 'no cortó' }
    catch { Resultado 'frena: rotación con ENTORNO que no es staging ni prod' ($_.Exception.Message -like '*tiene que ser*') $_.Exception.Message }
  } elseif ($esAgente) {
    # ── Pase del agente nuevo: lo que queda después de correr TODO (incluida la vuelta atrás de §6) ──
    $nueva = Join-Path $RAIZ 'agente-prod-5da233a'
    Resultado 'agente: después de la vuelta atrás, la tarea corre otra vez el .cmd viejo' ($global:KIT.cmd -eq (Join-Path $RAIZ 'pos-agente-prod.cmd')) $global:KIT.cmd
    Resultado 'agente: la carpeta vieja quedó intacta (.env igual)' (([IO.File]::ReadAllText((Join-Path $RAIZ 'satori-app-prod\pos-bridge\.env'))) -ceq "LOCAL=santa-teresa`r`nINGEST_SECRET=ficticio-ficticio-ficticio-ficticio-0123`r`n")
    $envN = [IO.File]::ReadAllText((Join-Path $nueva 'pos-bridge\.env'))
    Resultado 'agente: el .env nuevo tiene el mismo secreto y la firma UNA vez' (($envN -match '(?m)^INGEST_SECRET=ficticio-ficticio-ficticio-ficticio-0123\r?$') -and ([regex]::Matches($envN, '(?m)^POS_AGENTE_PROD_FIRMADO=\d{4}-\d{2}-\d{2}\r?$').Count -eq 1))
    $cmdN = [IO.File]::ReadAllText((Join-Path $RAIZ 'pos-agente-prod-5da233a.cmd'))
    Resultado 'agente: el .cmd nuevo entra a la carpeta nueva y no a la vieja' (($cmdN -like '*agente-prod-5da233a*') -and ($cmdN -notlike '*satori-app-prod*'))
    $nA11 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'rev-parse agente' } | Select-Object -First 1))
    $nA21 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'npm.cmd ci' } | Select-Object -First 1))
    $nA23 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'medir carpeta nueva' } | Select-Object -First 1))
    $nA3  = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'New-ScheduledTaskAction @p' } | Select-Object -First 1))
    Frena 'agente 1.1: la tarea corre otro .cmd' $nA11 'la tarea no corre' { param($r) $global:KIT.cmd = Join-Path $r 'otro.cmd'; [IO.File]::WriteAllText($global:KIT.cmd, "@echo off`r`n", $utf8) }
    Frena 'agente 2.1: la carpeta nueva ya existe' $nA21 'ya existe' { param($r) New-Item -ItemType Directory -Force (Join-Path $r 'agente-prod-5da233a') | Out-Null }
    Frena 'agente 2.1: el árbol de pos-bridge no es el revisado' $nA21 'no es el revisado' { param($r) $global:KIT.arbol_mal = $true }
    Frena 'agente 2.3: la carpeta nueva manda otro secreto' $nA23 'no manda el mismo secreto' { param($r) $global:KIT.medir_distinto = $true }
    Frena 'agente 3: el .cmd viejo cambió desde 1.1' $nA3 'cambió desde 1.1' { param($r) [IO.File]::AppendAllText((Join-Path $r 'pos-agente-prod.cmd'), "rem cambio`r`n", $utf8) }
  } else {
  # ── 1.9 con tres cuentas REALES de esta máquina (Grok 121): SYSTEM, cuenta de servicio y una sin perfil cargado ──
  $n19 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'Principal.UserId' } | Select-Object -First 1))
  function Correr19([string]$cuenta) {
    $global:KIT.cuenta = $cuenta
    try { (. ([scriptblock]::Create((Preparar $bloques[$n19 - 1] $RAIZ)))) | Out-String } finally { $global:KIT.cuenta = 'SYSTEM' }
  }
  try { $o = Correr19 'SYSTEM'; Write-Host "  $($o.Trim())"; Resultado '1.9 (121): SYSTEM se lee de HKEY_USERS\S-1-5-18 (perfil cargado)' ($o -like '*S-1-5-18*HKEY_USERS\S-1-5-18*perfil cargado*') $o }
  catch { Resultado '1.9 (121): SYSTEM' $false $_.Exception.Message }
  $ls = (New-Object Security.Principal.SecurityIdentifier('S-1-5-19')).Translate([Security.Principal.NTAccount]).Value
  try { $o = Correr19 $ls; Write-Host "  $($o.Trim())"; Resultado "1.9 (121): cuenta de servicio ($ls) se lee y dice de dónde" (($o -like '*S-1-5-19*') -and (($o -like '*perfil cargado*') -or ($o -like '*montado en HKEY_USERS*'))) $o }
  catch { Resultado "1.9 (121): cuenta de servicio ($ls)" $false $_.Exception.Message }
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $inv = @(CimCmdlets\Get-CimInstance Win32_UserAccount -Filter 'LocalAccount=True' | Where-Object { $_.SID -like '*-501' } | Select-Object -First 1)
  if (-not $inv.Count) { Resultado '1.9 (121): hay una cuenta local sin perfil cargado para probar (Invitado, RID 501)' $false 'no se encontró' }
  elseif (-not $admin -and -not $env:GITHUB_ACTIONS) { Write-Host 'SKIP  1.9 (121): usuario sin perfil cargado (montar NTUSER.DAT pide consola de administrador; en el workflow corre)' -ForegroundColor Yellow }
  else {
    $cu = "$($inv[0].Domain)\$($inv[0].Name)"
    try { $o = Correr19 $cu; Write-Host "  $($o.Trim())"; Resultado "1.9 (121): usuario sin perfil cargado ($cu): monta el NTUSER.DAT, lee y desmonta" ($o -like '*montado en HKEY_USERS\satori-pase-1-9 y desmontado*') $o }
    catch { Resultado "1.9 (121): usuario sin perfil cargado ($cu)" $false $_.Exception.Message }
    Resultado '1.9 (121): no quedó montado HKEY_USERS\satori-pase-1-9' (-not (Test-Path -LiteralPath 'Registry::HKEY_USERS\satori-pase-1-9'))
  }
  try { $o = Correr19 ''; Resultado 'frena: 1.9 con la tarea sin cuenta' $false 'no cortó' } catch { Resultado 'frena: 1.9 con la tarea sin cuenta' ($_.Exception.Message -like '*PARADA 1.9*no tiene una cuenta*') $_.Exception.Message }
  try { $o = Correr19 'KITNOEXISTE\nadie-xyz'; Resultado 'frena: 1.9 con una cuenta que no se resuelve' $false 'no cortó' } catch { Resultado 'frena: 1.9 con una cuenta que no se resuelve' ($_.Exception.Message -like '*PARADA 1.9*no se puede resolver*') $_.Exception.Message }

  $quedan = @(Get-ChildItem -LiteralPath $env:LOCALAPPDATA -Filter 'satori-pase*.env' -ErrorAction SilentlyContinue)
  Resultado 'no quedó ningún archivo del mapa de secretos en LOCALAPPDATA' ($quedan.Count -eq 0) "$($quedan.Count) archivos"
  Resultado '9.0 borró la copia .antes-pase del agente (ficticia)' (-not (Test-Path -LiteralPath (Join-Path $RAIZ 'satori-app-prod\pos-bridge\.env.antes-pase')))
  Resultado 'los dos bloques del ledger se generaron (bloque_081.sql y bloque_082.sql)' ((Test-Path (Join-Path $RAIZ 'pase-sql\bloque_081.sql')) -and (Test-Path (Join-Path $RAIZ 'pase-sql\bloque_082.sql')))
  $b2 = [IO.File]::ReadAllText((Join-Path $RAIZ 'pase-sql\bloque_082.sql'), $utf8)
  Resultado 'bloque_082: un solo begin/commit, con los dos timeouts, y el archivo original en el ledger' (([regex]::Matches($b2, '(?m)^begin;$').Count -eq 2) -and $b2.StartsWith("begin;`nset local lock_timeout = '5s';") -and $b2.TrimEnd().EndsWith('commit;'))
  $bytes = [IO.File]::ReadAllBytes((Join-Path $RAIZ 'pase-sql\bloque_082.sql'))
  Resultado 'bloque_082 sin BOM' (-not ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF))

  $n04 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'git clone' } | Select-Object -First 1))
  $n05 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'Get-ChildItem -LiteralPath \$SQL -File' } | Select-Object -First 1))
  $n2  = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'function Armar-Bloque' } | Select-Object -First 1))
  $n32 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'secrets set --env-file' } | Select-Object -First 1))
  Frena 'un comando nativo que falla (git fetch) corta con su código' $n04 'falló «fetch»' { param($r) $global:KIT.falla_git = 'fetch' }
  Frena 'la 082 con otros bytes: md5 distinto antes de seguir' $n05 '082: md5 distinto' { param($r) $global:KIT.f082 = $utf8.GetBytes("-- otra cosa`n") }
  Frena 'generar con un .sql con BOM no genera nada' $n2 'md5 distinto' { param($r) [IO.File]::WriteAllBytes((Join-Path $r 'pase-sql\082.sql'), [byte[]](@(0xEF, 0xBB, 0xBF) + $F082)) }
  Frena 'la huella del panel no coincide con la del mapa' $n32 'huella del panel' { param($r) $global:KIT.huella_mal = $true }
  Frena 'el armado del mapa falla (node con error)' $n32 'armar mapa' { param($r) $global:KIT.node_falla = $true }
  $n05b = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'show armar_mapa' } | Select-Object -First 1))
  $n06 = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match 'supabase --version' } | Select-Object -First 1))
  Frena '1.9: el .cmd de la tarea no entra a la carpeta del agente' $n19 'la tarea no corre' { param($r) [IO.File]::WriteAllText($global:KIT.cmd, "@echo off`r`ncd /d C:\otra\carpeta`r`nnode agente.ts`r`n", $utf8) }
  Frena '1.9: el .cmd de la tarea define una variable del agente' $n19 'define variables del agente' { param($r) [IO.File]::WriteAllText($global:KIT.cmd, "@echo off`r`nset INGEST_SECRET=x`r`ncd /d $r\satori-app-prod`r`nnode agente.ts`r`n", $utf8) }
  Frena '0.5b: el script del paquete con otros bytes' $n05b 'armar_mapa_secretos.mjs: md5 distinto' { param($r) $global:KIT.fmapa = $utf8.GetBytes("// otro`n") }
  Frena '0.6: Supabase CLI de otra versión' $n06 'se esperaba 2.122.0' { param($r) $global:KIT.cli = '2.99.0' }
  $n19m = 1 + [array]::IndexOf($bloques, ($bloques | Where-Object { $_ -match '--solo-medir' } | Select-Object -First 1))
  Frena '1.9 (120): un secreto corto es PARADA limpia (no hay camino 4.3b)' $n19m 'PARADA 1.9 (Grok 120)' { param($r) $global:KIT.corto = $true }
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
  }
} finally {
  $env:LOCALAPPDATA = $LAD_ANTES
  Remove-Item -LiteralPath $RAIZ -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host "RESULTADO: $script:pasan PASS, $script:fallan FAIL  (PowerShell $($PSVersionTable.PSVersion))"
if ($script:fallan -gt 0) { exit 1 } else { exit 0 }
