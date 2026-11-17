# Bloques del pase D9 · agente del PoS que lee el descuento por línea (`5da233a` → `578f38c`)

> Paquete de PowerShell del [PASE D9](../pases/PASE-D9-descuento-linea-pos.md) (§5 y §7). La guía de una página para el
> dueño es [`GUIA-D9-agente-descuento.md`](GUIA-D9-agente-descuento.md). Si algo no coincide con lo que dice acá, **se
> para y se avisa**: no se improvisa en prod. Mismo estilo que [`PASE-AGENTE-PROD.md`](PASE-AGENTE-PROD.md) (en `main`)
> y [`PASE-PROD-2026-11-09.md`](PASE-PROD-2026-11-09.md).
>
> Repo público: sin secretos, sin nombres de equipo, sin montos. Ningún bloque muestra, copia ni registra el `.env`.

## Qué pasa y qué no
- **Pasa (parte A, hoy, fuera de 15:50–19:00):** el agente de prod pasa de `5da233a` a
  `578f38c039ec232d3818c1182d69d7f78f55b371` en una **carpeta nueva** (`C:\satori\agente-d9`), y la tarea programada pasa a
  un `.cmd` nuevo, copia del de hoy con solo la carpeta cambiada.
- **Pasa (parte B, esta noche, 00:00–06:00):** el re-backfill del histórico, mes por mes, del más nuevo al más viejo.
- **No pasa:** migraciones, Edge, secretos (el `.env` se copia idéntico), la cuenta, los disparadores y el nombre de la
  tarea. **La carpeta de hoy no se toca:** es la vuelta atrás.
- **Qué cambia en el agente:** contra `5da233a`, solo 5 archivos de `pos-bridge/` (3 de código: `esquema.ts`,
  `consulta.ts` y `backfill.ts`; 2 de pruebas). Lee `FAC_FacturasDet.Descuento` y manda su suma por factura en
  `descuento`. Si la columna faltara, manda 0 como antes. El backfill en seco cuenta `con_descuento`.

**Por qué un `.cmd` y no «Iniciar en»:** desde el pase del 10-nov la tarea corre un `.cmd` (cuenta SYSTEM) que hace
`cd /d <carpeta>` y arranca node. La carpeta la decide esa línea, no el campo «Iniciar en». Por eso el bloque A5 hace
lo mismo que el pase del 10-nov: un `.cmd` nuevo y la acción de la tarea apuntando a él. Si la tarea no corre un `.cmd`,
el bloque A0 para.

## Valores fijos
| Qué | Valor |
|---|---|
| Agente de prod hoy | `5da233a516d1a6c4c2c95eb165be448be5416697` · árbol `pos-bridge` `5600ebbd287559b23667f61c6e4c90181fa24b8e` |
| Agente D9 | `578f38c039ec232d3818c1182d69d7f78f55b371` · árbol `pos-bridge` `d14d603a0d2458af7a81025efef688a2dfc9fed0` |
| Script de medición del `.env` (el del pase del 10-nov) | `scripts/puente/armar_mapa_secretos.mjs` md5 `73c4d9d207c22c13d5c42498bb63e8ca` |
| Carpeta nueva · `.cmd` nuevo | `C:\satori\agente-d9` · `C:\satori\pos-agente-prod-d9.cmd` |
| Carpeta de la vuelta atrás (config vieja, progreso y logs; **sin secretos**) | `C:\satori\d9-vuelta` |
| Pruebas del puente en la carpeta nueva | 478 (`pos-bridge` + `src/shared/ndf`) |

## Responsables
- **Ejecución:** el dueño, en la PC del PoS, en **Windows PowerShell 5.1 (o 7) como administrador**. **No el ISE**:
  ahí `git` y `npm` cortan los bloques aunque salgan bien.
- **Control:** otra persona (la encargada) o Claude por chat. Lee la última línea de cada bloque contra lo esperado de
  esta tabla y corre las consultas SQL de **solo lectura**. No es la misma persona que ejecuta.

## Consola: preámbulo (en cada consola nueva, antes que nada)
Fail-stop: cada comando nativo va con `; Ok '<qué>'`; un bloque que tira error **no se sigue**. Cada bloque va
envuelto en `& { … }`: un error corta **todo** el bloque, no solo una línea. Si se cierra la consola, se abre otra, se
carga este preámbulo y se sigue con el bloque que tocaba: cada bloque vuelve a leer lo que necesita.

**Cómo se carga (método por defecto por escritorio remoto):** pegar bloques largos con clic derecho en la consola los
desordena, y Ctrl+C / Ctrl+V no llegan por el escritorio remoto. Se hace así, con el preámbulo y con cada bloque:
1. Pegar el texto del bloque (sin las líneas de las tres comillas invertidas) en el **Bloc de notas**.
2. Guardar como `C:\satori\paso.ps1`: *Tipo* = «Todos los archivos», *Codificación* = **UTF-8 con BOM** (sin BOM,
   PowerShell 5.1 rompe las tildes).
3. Una sola vez por consola: `Set-ExecutionPolicy -Scope Process Bypass -Force`.
4. Cargarlo con **punto y espacio** (dot-source): `. C:\satori\paso.ps1`. Así el preámbulo deja sus funciones y
   variables cargadas en la consola; con `& C:\satori\paso.ps1` o `.\paso.ps1` se perderían al terminar.
Para el siguiente bloque se reemplaza el contenido de `paso.ps1` (el preámbulo se carga una vez por consola).
`paso.ps1` no lleva secretos (ningún bloque los trae).
```powershell
$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)          # node escribe en UTF-8
$TAREA = 'Satori PoS Bridge PROD'
$SHA = '578f38c039ec232d3818c1182d69d7f78f55b371'; $SHA_PROD = '5da233a516d1a6c4c2c95eb165be448be5416697'
$ARBOL = 'd14d603a0d2458af7a81025efef688a2dfc9fed0'
$NUEVA = 'C:\satori\agente-d9'; $CMD_NUEVO = 'C:\satori\pos-agente-prod-d9.cmd'; $VUELTA = 'C:\satori\d9-vuelta'
$INV = [Globalization.CultureInfo]::InvariantCulture
function Ok([string]$que) { if ($LASTEXITCODE -ne 0) { throw "falló «$que» (código $LASTEXITCODE): NO SE SIGUE" } }
function Carpeta([string]$p) { if (-not [IO.Path]::IsPathRooted($p) -or -not (Test-Path -LiteralPath $p -PathType Container)) { throw "no es una carpeta absoluta existente: $p" }; (Resolve-Path -LiteralPath $p).Path }
function Archivo([string]$p) { if (-not [IO.Path]::IsPathRooted($p) -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "no es un archivo absoluto existente: $p" }; (Resolve-Path -LiteralPath $p).Path }
# Vitest/npx en la consola de Windows mete códigos de color (ANSI) y rompen los regex: se apagan y, por las dudas, se quitan.
function Sin-Ansi([string]$t) { $t -replace "$([char]27)\[[0-9;]*[A-Za-z]", '' }
function Md5Bytes([string]$p) { (Get-FileHash -Algorithm MD5 -LiteralPath (Archivo $p)).Hash.ToLower() }
function Bajo([string]$base, [string]$rel) { foreach ($x in ($rel -split '[\\/]')) { if ($x) { $base = Join-Path $base $x } }; $base }
function Hoy-CR { [DateTime]::UtcNow.AddHours(-6) }                       # Costa Rica = UTC-6, sin horario de verano
function Es-Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
# La tarea, SOLO LECTURA: su .cmd y la carpeta a la que entra («cd /d»). Nunca un valor del .env.
function Leer-Tarea {
  $t = Get-ScheduledTask -TaskName $TAREA
  $acc = @($t.Actions); if ($acc.Count -ne 1) { throw "la tarea tiene $($acc.Count) acciones: se esperaba una" }
  $ex = ([string]$acc[0].Execute).Trim('"')
  if ($ex -notmatch '\.cmd$') { throw "la tarea corre «$ex» y no un .cmd (como desde el 10-nov): se para y se avisa" }
  $cmd = Archivo $ex; $txt = [IO.File]::ReadAllText($cmd)
  $m = [regex]::Matches($txt, '(?im)^[ \t]*cd[ \t]+/d[ \t]+"?([^"\r\n]+?)\\?"?[ \t]*\r?$')
  if ($m.Count -ne 1) { throw "el .cmd de la tarea tiene $($m.Count) líneas «cd /d»: se esperaba una" }
  if ($txt -match '(?im)^\s*set\s+"?(INGEST_|POS_)') { throw 'el .cmd de la tarea define variables del agente (INGEST_/POS_)' }
  if ("$([string]$acc[0].Arguments)" -match 'INGEST_|POS_') { throw 'la acción de la tarea define variables del agente' }
  $dirTxt = $m[0].Groups[1].Value.Trim()
  New-Object PSObject -Property ([ordered]@{ Execute = [string]$acc[0].Execute; Arguments = [string]$acc[0].Arguments
    WorkingDirectory = [string]$acc[0].WorkingDirectory; Cmd = $cmd; Md5Cmd = (Md5Bytes $cmd); CarpetaTexto = $dirTxt
    Carpeta = (Carpeta $dirTxt); Estado = [string]$t.State; Cuenta = [string]$t.Principal.UserId })
}
# Nombres de las claves CON valor, con las mismas reglas que pos-bridge/config.ts (el último archivo gana). Nunca valores.
function Claves-Env([string[]]$archivos) {
  $n = New-Object 'System.Collections.Generic.Dictionary[string,bool]'
  foreach ($f in $archivos) {
    foreach ($crudo in [IO.File]::ReadAllLines((Archivo $f))) {
      $l = $crudo.Trim(); if (-not $l -or $l.StartsWith('#')) { continue }
      $eq = $l.IndexOf('='); if ($eq -lt 0) { continue }
      $v = $l.Substring($eq + 1).Trim()
      if (-not ($v.StartsWith('"') -or $v.StartsWith("'"))) { $h = $v.IndexOf(' #'); if ($h -ge 0) { $v = $v.Substring(0, $h).Trim() } }
      if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1, $v.Length - 2) }
      $n[$l.Substring(0, $eq).Trim()] = ($v.Length -gt 0); $v = $null
    }
  }
  @($n.Keys | Where-Object { $n[$_] } | Sort-Object)
}
# La salida del backfill en seco → conteos (sin montos: el backfill nunca los imprime).
function Resumen-DryRun([string[]]$lineas) {
  $dias = @(); $tot = $null
  foreach ($l in $lineas) {
    $m = [regex]::Match($l, '(\d{4}-\d{2}-\d{2})\s+tickets=(\d+)\s+\S+=(\d+)\s+con_descuento=(\d+)')
    if ($m.Success) { $dias += New-Object PSObject -Property ([ordered]@{ Dia = $m.Groups[1].Value; Tickets = [int]$m.Groups[2].Value; ConDescuento = [int]$m.Groups[4].Value }) }
    $t = [regex]::Match($l, 'TOTAL\b.*?tickets=(\d+)\s+guardados=(\d+).*?errores=(\d+)')
    if ($t.Success) { $tot = $t }
  }
  if (-not $tot) { throw 'la salida no trae la línea TOTAL: el backfill no terminó' }
  $tk = [int]$tot.Groups[1].Value; $cd = 0; foreach ($d in $dias) { $cd += $d.ConDescuento }
  New-Object PSObject -Property ([ordered]@{ Dias = $dias; Tickets = $tk; ConDescuento = $cd
    Guardados = [int]$tot.Groups[2].Value; Errores = [int]$tot.Groups[3].Value
    Pct = $(if ($tk) { [math]::Round(100.0 * $cd / $tk, 1) } else { 0 })
    EsDry = [bool](@($lineas | Where-Object { $_ -cmatch 'DRY-RUN: ' }).Count)
    Prod = [bool](@($lineas | Where-Object { $_ -match 'ingest=yiczgdti' }).Count) })
}
# Los tramos del backfill: un mes por tramo, del más nuevo al más viejo, recortados a [desde, hasta].
function Meses-Backfill([string]$desde, [string]$hasta) {
  $d = [datetime]::ParseExact($desde, 'yyyy-MM-dd', $INV); $h = [datetime]::ParseExact($hasta, 'yyyy-MM-dd', $INV)
  while ($h -ge $d) {
    $ini = New-Object DateTime($h.Year, $h.Month, 1); if ($ini -lt $d) { $ini = $d }
    New-Object PSObject -Property ([ordered]@{ Mes = $h.ToString('yyyy-MM', $INV); Desde = $ini.ToString('yyyy-MM-dd', $INV); Hasta = $h.ToString('yyyy-MM-dd', $INV) })
    $h = $ini.AddDays(-1)
  }
}
# (Del pase del 10-nov.) El node de un agente se identifica por su CARPETA o por su .cmd, en su línea de comando o en la
# de un proceso padre: en esta PC corren dos agentes (prod y staging) con la MISMA línea de node. Nunca por una palabra.
function Get-NodeDe([string]$Carpeta, [string]$Cmd) {
  $todos = @(Get-CimInstance Win32_Process); $porPid = @{}; foreach ($x in $todos) { $porPid[[int]$x.ProcessId] = $x }
  $marcas = @('(?i)' + [regex]::Escape($Carpeta.TrimEnd('\')) + '(\\|"|\s|$)')
  if ($Cmd) { $marcas += '(?i)' + [regex]::Escape($Cmd) + '("|\s|$)' }
  @($todos | Where-Object { $_.Name -eq 'node.exe' } | Where-Object {
    $x = $_; $es = $false
    for ($i = 0; $x -and $i -lt 6 -and -not $es; $i++) {
      foreach ($mk in $marcas) { if ([string]$x.CommandLine -match $mk) { $es = $true } }
      $x = if ([int]$x.ParentProcessId -ne [int]$x.ProcessId) { $porPid[[int]$x.ParentProcessId] } else { $null }
    }
    $es })
}
function Detener-Agente([string]$Carpeta, [string]$Cmd) {
  $pids = @(Get-NodeDe $Carpeta $Cmd | ForEach-Object { [int]$_.ProcessId })
  if ((Get-ScheduledTask -TaskName $TAREA).State -eq 'Running' -and -not $pids.Count) { throw "PARADA: la tarea corre y no se encuentra su node.exe por $Carpeta ni por $Cmd" }
  Stop-ScheduledTask -TaskName $TAREA
  $t0 = Get-Date
  while ((Get-ScheduledTask -TaskName $TAREA).State -eq 'Running' -or @(Get-CimInstance Win32_Process | Where-Object { $pids -contains [int]$_.ProcessId }).Count) {
    if ((Get-Date) - $t0 -gt [TimeSpan]::FromMinutes(3)) { throw "el agente (node $($pids -join ', ')) no se detuvo en 3 minutos: se avisa; si hay que cerrarlo, SOLO esos PID" }
    Start-Sleep -Seconds 5
  }
  "agente de $Carpeta detenido $(Get-Date -Format 'HH:mm:ss') (node $($pids -join ', '))"
}
function Backfill-Corriendo { @(Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { [string]$_.CommandLine -match 'backfill' }).Count }
"preámbulo ok · PowerShell $($PSVersionTable.PSVersion) $($PSVersionTable.PSEdition)"
```
**Ve:** `preámbulo ok · PowerShell 5.1… Desktop` (o `7.x Core`). Si dice otra versión, se para.

---

# Parte A · HOY, fuera de 15:50–19:00 (unos 25–35 min; la tarea queda detenida ~30 s)

## A0 · Comprobaciones (solo lectura · 2 min)
```powershell
& {
if (-not (Es-Admin)) { throw 'la consola no es de administrador: abrir «Windows PowerShell» como administrador' }
$h = (Hoy-CR).ToString('HH:mm', $INV); if ($h -ge '15:50' -and $h -lt '19:00') { throw "son las $h CR: la parte A no se hace entre 15:50 y 19:00" }
$v = node --version; Ok 'node'
if ($v -notmatch '^v(\d+)\.(\d+)' -or [int]$Matches[1] -lt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 18)) { throw "Node $v`: hace falta 22.18 o más" }
npm.cmd --version | Out-Null; Ok 'npm'
git --version | Out-Null; Ok 'git'
$T = Leer-Tarea
if ($T.Estado -ne 'Running') { throw "la tarea no está corriendo ($($T.Estado)): se para y se avisa" }
if ($T.Carpeta -ieq $NUEVA) { throw 'la tarea YA corre la carpeta nueva: A5 ya se hizo' }
$hh = git -C $T.Carpeta rev-parse HEAD; Ok 'rev-parse agente de hoy'
if ($hh -cne $SHA_PROD) { throw "el agente de hoy está en $hh y no en 5da233a…: se para y se avisa" }
$s = git -C $T.Carpeta status --porcelain --untracked-files=no; Ok 'status agente de hoy'; if ($s) { throw 'el agente de hoy tiene cambios' }
$n = @(Get-NodeDe $T.Carpeta $T.Cmd); if (-not $n.Count) { throw 'no se encuentra el node del agente de hoy' }
if (Backfill-Corriendo) { throw 'hay un backfill corriendo' }
if (Test-Path -LiteralPath $NUEVA) { throw "$NUEVA ya existe: revisarlo antes (no se pisa nada)" }
if (Test-Path -LiteralPath $VUELTA) { throw "$VUELTA ya existe: hay un cambio anterior sin cerrar" }
$i = Get-ScheduledTaskInfo -TaskName $TAREA
"A0 ok · $h CR · node $v · agente de hoy 5da233a… limpio · tarea Running (cuenta $($T.Cuenta), node $(@($n | ForEach-Object { $_.ProcessId }) -join ', ')) · última corrida $($i.LastRunTime) · resultado $($i.LastTaskResult)"
}
```
**Ve:** `A0 ok · … agente de hoy 5da233a… limpio · tarea Running …`.
**Control:** corre §1 de [`scripts/sql/descuento_pos_agente_d9.sql`](../../scripts/sql/descuento_pos_agente_d9.sql) en
prod (`yiczgdti…`): `hace` < 2 min de 10:00 a 02:00 (< 6 min de madrugada) y `sin_error = true`. **Si no, se para.**

## A1 · Clon nuevo en el SHA exacto (con la tarea andando · 3–5 min)
```powershell
& {
if (Test-Path -LiteralPath $NUEVA) { throw "$NUEVA ya existe" }
git clone --no-checkout https://github.com/CachoSatori/satori-app.git $NUEVA; Ok 'clone'
$N = Carpeta $NUEVA
git -C $N fetch origin claude/puente-item11-prod-v2; Ok 'fetch'
git -C $N checkout --detach $SHA; Ok 'checkout'
$h = git -C $N rev-parse HEAD; Ok 'rev-parse'; if ($h -cne $SHA) { throw 'la carpeta nueva no está en 578f38c…' }
$a = git -C $N rev-parse 'HEAD:pos-bridge'; Ok 'árbol'; if ($a -cne $ARBOL) { throw 'pos-bridge no es el revisado' }
$d = git -C $N diff --name-only $SHA_PROD $SHA -- pos-bridge src supabase package.json package-lock.json; Ok 'diff contra el agente de hoy'
if ((@($d) -join ',') -cne 'pos-bridge/backfill.test.ts,pos-bridge/backfill.ts,pos-bridge/consulta.test.ts,pos-bridge/consulta.ts,pos-bridge/esquema.ts') { throw "contra 5da233a cambió otra cosa: $(@($d) -join ', ')" }
$s = git -C $N status --porcelain; Ok 'status'; if ($s) { throw 'el clon no está limpio' }
"A1 ok · $N en 578f38c… · árbol pos-bridge d14d603a… · contra 5da233a solo cambian los 5 archivos de pos-bridge"
}
```

## A2 · El `.env`, copiado sin mostrarlo (1 min · se puede repetir)
Se copian los mismos archivos que tiene la carpeta de hoy, idénticos byte a byte. **Nadie abre el `.env`**: el bloque
solo dice los **nombres** que faltan y mide con el parser del propio agente (archivo que manda, largo, candado de prod).
**Se puede correr de nuevo:** si la copia ya existe y es **idéntica** al original, no copia y sigue; si existe y
**difiere**, frena. El script de medición se valida por su **blob de git** (`hash-object --path` contra
`rev-parse HEAD:<ruta>`), no por el md5 del archivo en disco: en Windows git hace el checkout con CRLF
(`core.autocrlf`) y el md5 en disco cambia. Además se acepta el md5 con LF (`73c4d9d2…`) o con CRLF (`fcb5f2df…`).
```powershell
& {
$T = Leer-Tarea; $N = Carpeta $NUEVA
$copiados = @(); $yaEstaban = @()
foreach ($e in @('.env', '.env.local', 'pos-bridge/.env')) {
  $o = Bajo $T.Carpeta $e
  if (Test-Path -LiteralPath $o -PathType Leaf) {
    $dd = Bajo $N $e
    if (Test-Path -LiteralPath $dd) {
      if ((Md5Bytes $o) -cne (Md5Bytes $dd)) { throw "en la carpeta nueva ya existe $e y DIFIERE del de hoy: no se pisa, se para y se avisa" }
      $yaEstaban += $e
    } else {
      Copy-Item -LiteralPath $o -Destination $dd
      if ((Md5Bytes $o) -cne (Md5Bytes $dd)) { throw "la copia de $e no es idéntica" }
    }
    $copiados += $e
  }
}
if (-not $copiados.Count) { throw 'no se encontró ningún .env en la carpeta de hoy' }
$con = Claves-Env @($copiados | ForEach-Object { Bajo $N $_ })
$faltan = @(@('LOCAL', 'ENV', 'INGEST_URL', 'INGEST_SECRET', 'POS_DB_HOST', 'POS_DB_USER', 'POS_DB_PASSWORD', 'POS_AGENTE_PROD_FIRMADO') | Where-Object { $con -cnotcontains $_ })
if ($faltan.Count) { throw "faltan o están vacías (solo nombres): $($faltan -join ', ')" }
$s = git -C $N status --porcelain; Ok 'status'; if ($s) { throw 'git ve un .env: no está en el .gitignore' }
# El script de medición: por blob de git (--path aplica el mismo filtro de fin de línea del checkout) y md5 LF o CRLF.
$REL = 'scripts/puente/armar_mapa_secretos.mjs'
$MED = Archivo (Bajo $N $REL)
$bDisco = git -C $N hash-object "--path=$REL" $MED; Ok 'hash-object del script'
$bRepo = git -C $N rev-parse "HEAD:$REL"; Ok 'rev-parse del script'
if ("$bDisco".Trim() -cne "$bRepo".Trim()) { throw 'armar_mapa_secretos.mjs: el contenido no es el del commit 578f38c… (blob distinto)' }
$mm = Md5Bytes $MED
if (@('73c4d9d207c22c13d5c42498bb63e8ca', 'fcb5f2df5059905a1515d7cd404896f0') -cnotcontains $mm) { throw 'armar_mapa_secretos.mjs: md5 distinto (ni LF ni CRLF)' }
$rV = 'file:///' + ((Archivo (Bajo $T.Carpeta 'pos-bridge/register.mjs')) -replace '\\', '/')
$rN = 'file:///' + ((Archivo (Bajo $N 'pos-bridge/register.mjs')) -replace '\\', '/')
$mV = node --import $rV $MED --agente $T.Carpeta --clon $N --solo-medir; Ok 'medir carpeta de hoy'
$mN = node --import $rN $MED --agente $N --clon $N --solo-medir; Ok 'medir carpeta nueva (candado de prod)'
$v = $mV | ConvertFrom-Json; $w = $mN | ConvertFrom-Json
if ($w.archivo_que_manda -cne $v.archivo_que_manda -or $w.largo_santa_teresa -ne $v.largo_santa_teresa) { throw 'la carpeta nueva no manda lo mismo que la de hoy' }
if (-not $w.cumple_32) { throw 'PARADA: el secreto mide menos de 32' }
$fin = if ($mm -ceq '73c4d9d207c22c13d5c42498bb63e8ca') { 'LF' } else { 'CRLF' }
"A2 ok · idénticos: $($copiados -join ', ') (ya estaban: $($yaEstaban.Count)) · claves presentes: $($con.Count) (ninguna falta) · script = blob del commit ($fin) · las dos carpetas mandan $($w.archivo_que_manda), largo $($w.largo_santa_teresa) · candado ok"
}
```

## A3 · Dependencias, typecheck y pruebas del puente (6–10 min)
`npm ci` en la raíz **y dentro de `pos-bridge\`** (tiene su propio `package.json`: sin él falta `mssql` y el agente no
arranca, lección del 10-nov). La salida de vitest se lee **sin colores**: en la consola de Windows mete códigos ANSI y
el regex no encontraba el «478» aunque pasaran; por eso `NO_COLOR`/`FORCE_COLOR=0`, `2>&1`, se quitan los escapes y el
regex usa `\s+`.
```powershell
& {
$N = Carpeta $NUEVA; $PB = Carpeta (Bajo $N 'pos-bridge')
Push-Location $N; try { npm.cmd ci --no-audit --no-fund; Ok 'npm ci (raíz)' } finally { Pop-Location }
Push-Location $PB; try {
  npm.cmd ci --no-audit --no-fund; Ok 'npm ci (pos-bridge)'
  $m = node -e "import('mssql').then(() => console.log('si'), () => { console.log('no'); process.exit(1) })"; Ok "import('mssql')"
  if ("$m".Trim() -cne 'si') { throw 'mssql no carga desde pos-bridge' }
  npm.cmd run typecheck; Ok 'typecheck del puente'
} finally { Pop-Location }
$nc = $env:NO_COLOR; $fc = $env:FORCE_COLOR; $eap = $ErrorActionPreference
$env:NO_COLOR = '1'; $env:FORCE_COLOR = '0'
Push-Location $N; try {
  $ErrorActionPreference = 'Continue'   # el stderr de vitest no debe cortar el bloque; el código de salida manda
  $P = @(npx.cmd vitest run pos-bridge src/shared/ndf 2>&1 | ForEach-Object { Sin-Ansi ([string]$_) }); $c = $LASTEXITCODE
  $ErrorActionPreference = $eap
  $P | Select-Object -Last 6; $global:LASTEXITCODE = $c; Ok 'pruebas del puente'
} finally { $ErrorActionPreference = $eap; Pop-Location; $env:NO_COLOR = $nc; $env:FORCE_COLOR = $fc }
$txt = $P -join "`n"
$t = [regex]::Match($txt, 'Tests\s+(\d+)\s+passed')
if ($txt -match 'Tests\s+\d+\s+failed') { throw 'hay pruebas que fallan' }
if (-not $t.Success -or [int]$t.Groups[1].Value -ne 478) { throw 'se esperaban 478 pruebas en verde' }
"A3 ok · dependencias (raíz y pos-bridge) · mssql carga · typecheck ok · 478 pruebas en verde"
}
```

## A4 · Prueba en seco: backfill de los últimos 7 días con `--dry-run` (2–3 min)
`--dry-run` **no hace ningún POST**: en `pos-bridge/backfill.ts`, `correrDia` vuelve antes de `puertos.enviar(...)`
cuando `dryRun` es verdadero (lo cubre `backfill.test.ts`). El bloque además exige `guardados=0` en el total. Lee el PoS
en solo lectura, como el agente. Se llama a node directo (lo mismo que `npm run pos:backfill`, sin el `--` de npm).
```powershell
& {
$N = Carpeta $NUEVA
$ay = (Hoy-CR).Date.AddDays(-1); $HASTA = $ay.ToString('yyyy-MM-dd', $INV); $DESDE = $ay.AddDays(-6).ToString('yyyy-MM-dd', $INV)
$t0 = Get-Date
$nc = $env:NO_COLOR; $fc = $env:FORCE_COLOR; $env:NO_COLOR = '1'; $env:FORCE_COLOR = '0'
Push-Location $N; try { node --import ./pos-bridge/register.mjs pos-bridge/backfill.ts --desde $DESDE --hasta $HASTA --dry-run --pausa-ms 800 | Tee-Object -Variable SAL; Ok 'backfill en seco' } finally { Pop-Location; $env:NO_COLOR = $nc; $env:FORCE_COLOR = $fc }
$seg = ((Get-Date) - $t0).TotalSeconds
$R = Resumen-DryRun @($SAL | ForEach-Object { Sin-Ansi ([string]$_) })
if (-not $R.EsDry) { throw 'PARADA: la salida no dice DRY-RUN' }
if ($R.Guardados -ne 0) { throw 'PARADA: el total dice guardados distinto de 0' }
if (-not $R.Prod) { throw 'PARADA: el .env no apunta al ingest de prod (yiczgdti…)' }
if ($R.Errores -ne 0) { throw "PARADA: $($R.Errores) día(s) con error" }
if ($R.Tickets -le 0) { throw 'PARADA: 0 facturas en 7 días' }
$R.Dias | ForEach-Object { '{0}  tickets={1,4}  con_descuento={2,4}  {3,5:N1} %' -f $_.Dia, $_.Tickets, $_.ConDescuento, $(if ($_.Tickets) { 100.0 * $_.ConDescuento / $_.Tickets } else { 0 }) }
if ($R.ConDescuento -eq 0) { throw 'PARADA: con_descuento = 0 en los 7 días (el agente no lee el descuento)' }
if ($R.Pct -gt 50) { throw "PARADA: con_descuento = $($R.Pct) % (> 50 %)" }
$aviso = if ($R.Pct -lt 15 -or $R.Pct -gt 30) { ' · AVISO: fuera de 15–30 %, Claude lo mira antes de A5' } else { '' }
$est = [math]::Ceiling($seg / 7 * 1100 / 60 * 1.5)
"A4 ok · $DESDE … $HASTA · tickets $($R.Tickets) · con_descuento $($R.ConDescuento) ($($R.Pct) %) · nada enviado$aviso · histórico estimado ~$est min"
}
```
**Ve:** una línea por día y `A4 ok · … con_descuento N (P %) · nada enviado`. Esperado: **15–30 %**.
**Parada:** 0 o más de 50 %. Entre 0 y 15 % o entre 30 y 50 %: se sigue solo si Claude lo da por bueno.

## A5 · Cambiar la tarea a la carpeta nueva (2 min · detenida ~30 s)
Primero guarda la config vieja en `C:\satori\d9-vuelta` (sin secretos: la acción y el XML de la tarea). Después: `.cmd`
nuevo = el de hoy con **solo** la carpeta cambiada; detener; cambiar la acción; arrancar.
```powershell
& {
$T = Leer-Tarea; $N = Carpeta $NUEVA
if ($T.Carpeta -ieq $N) { throw 'la tarea ya corre la carpeta nueva' }
$h = git -C $N rev-parse HEAD; Ok 'rev-parse'; if ($h -cne $SHA) { throw 'la carpeta nueva no está en 578f38c…' }
Push-Location (Carpeta (Bajo $N 'pos-bridge')); try { $m = node -e "import('mssql').then(() => console.log('si'), () => process.exit(1))"; Ok 'mssql' } finally { Pop-Location }
if (Backfill-Corriendo) { throw 'hay un backfill corriendo' }
if (Test-Path -LiteralPath $VUELTA) { throw "$VUELTA ya existe: hay un cambio anterior sin cerrar" }
if (Test-Path -LiteralPath $CMD_NUEVO) { throw "$CMD_NUEVO ya existe" }
# 1) config vieja (para A7)
New-Item -ItemType Directory -Path $VUELTA | Out-Null; $V = Carpeta $VUELTA
[IO.File]::WriteAllText((Join-Path $V 'tarea-antes.xml'), (Export-ScheduledTask -TaskName $TAREA), [Text.Encoding]::Unicode)
[IO.File]::WriteAllText((Join-Path $V 'tarea-antes.json'), ($T | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
$J = [IO.File]::ReadAllText((Join-Path $V 'tarea-antes.json')) | ConvertFrom-Json
if ($J.Execute -cne $T.Execute -or $J.Md5Cmd -cne $T.Md5Cmd) { throw 'la config vieja no quedó guardada bien' }
# 2) .cmd nuevo: byte a byte igual al viejo salvo la carpeta
$lat = [Text.Encoding]::GetEncoding('ISO-8859-1')
$txtV = $lat.GetString([IO.File]::ReadAllBytes($T.Cmd))
$txtN = $txtV.Replace($T.CarpetaTexto, $N)
if ($txtN -ceq $txtV) { throw 'el .cmd de hoy no menciona su carpeta' }
if ($txtN.Replace($N, $T.CarpetaTexto) -cne $txtV) { throw 'el .cmd nuevo cambiaría algo más que la carpeta' }
[IO.File]::WriteAllBytes($CMD_NUEVO, $lat.GetBytes($txtN))
# 3) el cambio
Detener-Agente $T.Carpeta $T.Cmd
$detenida = Get-Date
$p = @{ Execute = (Archivo $CMD_NUEVO) }
if ($T.Arguments) { $p.Argument = $T.Arguments }
if ($T.WorkingDirectory) { $p.WorkingDirectory = $T.WorkingDirectory }
Set-ScheduledTask -TaskName $TAREA -Action (New-ScheduledTaskAction @p) | Out-Null
$T2 = Leer-Tarea; if ($T2.Carpeta -ine $N) { throw 'la tarea no quedó en la carpeta nueva: correr A7' }
Start-ScheduledTask -TaskName $TAREA; Start-Sleep -Seconds 20
if ((Get-ScheduledTask -TaskName $TAREA).State -ne 'Running') { throw 'el agente nuevo no arrancó: correr A7 YA' }
if (-not @(Get-NodeDe $N $T2.Cmd).Count) { throw 'no se ve el node de la carpeta nueva: correr A7 YA' }
$HC = (Hoy-CR).ToString('yyyy-MM-dd HH:mm:ss', $INV) + '-06:00'
[IO.File]::WriteAllText((Join-Path $V 'hora-cambio.txt'), $HC)
"A5 ok · tarea → $CMD_NUEVO · detenida $([math]::Round(((Get-Date) - $detenida).TotalSeconds)) s · HORA_CAMBIO $HC (pasársela a Claude)"
}
```

## A6 · Verificar latido y descuento en lo nuevo (5–10 min, y otra vez al cierre de caja)
En la PC (solo lectura):
```powershell
& {
$T = Leer-Tarea; $N = Carpeta $NUEVA
if ($T.Carpeta -ine $N) { throw 'la tarea no corre la carpeta nueva' }
if ($T.Estado -ne 'Running') { throw 'la tarea no está corriendo: A7' }
$n = @(Get-NodeDe $N $T.Cmd); if (-not $n.Count) { throw 'no se ve el node del agente nuevo: A7' }
$i = Get-ScheduledTaskInfo -TaskName $TAREA
"A6 ok · Running · node $(@($n | ForEach-Object { $_.ProcessId }) -join ', ') · resultado $($i.LastTaskResult) · HORA_CAMBIO $([IO.File]::ReadAllText((Archivo (Join-Path $VUELTA 'hora-cambio.txt'))))"
}
```
**Control (Claude, prod, solo lectura):** [`scripts/sql/descuento_pos_agente_d9.sql`](../../scripts/sql/descuento_pos_agente_d9.sql)
con `HORA_CAMBIO`. §1 dos veces con 2 min de diferencia: late, `sin_error = true`. §2: las facturas que entraron desde
el cambio, por estado, con `con_descuento` (Claude le pasa al dueño el conteo, sin montos). Esperado: `descuento_negativo
= 0` y, en cuanto haya unas 10 facturas cerradas, alguna con descuento. **Parada → A7:** no late en 3 min, late con
error, `descuento_negativo > 0`, o la primera factura cobrada no coincide con su tiquete (líneas y total).

## A7 · Vuelta atrás (2 min; la carpeta de hoy está intacta)
```powershell
& {
$V = Carpeta $VUELTA
$J = [IO.File]::ReadAllText((Archivo (Join-Path $V 'tarea-antes.json'))) | ConvertFrom-Json
$viejo = Archivo (([string]$J.Execute).Trim('"'))
if ((Md5Bytes $viejo) -cne $J.Md5Cmd) { 'AVISO: el .cmd viejo cambió desde A5 (se usa igual; avisar a Claude)' }
$T = Leer-Tarea
if ($T.Estado -eq 'Running') { Detener-Agente $T.Carpeta $T.Cmd }
$p = @{ Execute = $J.Execute }
if ($J.Arguments) { $p.Argument = $J.Arguments }
if ($J.WorkingDirectory) { $p.WorkingDirectory = $J.WorkingDirectory }
Set-ScheduledTask -TaskName $TAREA -Action (New-ScheduledTaskAction @p) | Out-Null
$T2 = Leer-Tarea; if ($T2.Carpeta -ine $J.Carpeta) { throw 'la tarea no volvió a la carpeta vieja: se avisa' }
Start-ScheduledTask -TaskName $TAREA; Start-Sleep -Seconds 20
if ((Get-ScheduledTask -TaskName $TAREA).State -ne 'Running') { throw 'el agente viejo no arrancó: se avisa' }
if (-not @(Get-NodeDe $T2.Carpeta $T2.Cmd).Count) { throw 'no se ve el node de la carpeta vieja: se avisa' }
Rename-Item -LiteralPath $V -NewName ('d9-vuelta-usada-' + (Hoy-CR).ToString('yyyyMMdd-HHmm', $INV))
"A7 ok · tarea → $($J.Execute) (5da233a…) · $(Get-Date -Format 'HH:mm:ss')"
}
```
Después, §1 del SQL: late sin error. Las facturas que entraron con descuento se quedan (el agente viejo no las vuelve a
leer). Nada se borra: la carpeta nueva y el `.cmd` nuevo quedan para mirar.

---

# Parte B · ESTA NOCHE, 00:00–06:00 (≈ lo que estimó A4; se corta solo)

Orden: **(1) humo antes** → **(2) B1** → **(3) humo después**. Si B1 se cortó por la hora, la noche siguiente: humo
antes, B1 otra vez (retoma solo) y humo después.

**(1) Humo antes (Claude, prod `yiczgdti…`, solo lectura):** [`scripts/sql/descuento_pos_humo.sql`](../../scripts/sql/descuento_pos_humo.sql)
con el corte `2026-11-17 00:00:00-06:00` (el de §6 del PASE D9; **el mismo antes y después, todas las noches**). Se
anotan los valores; tienen que coincidir con los de §6 «Antes» del PASE (`facturas` 41.045, `h_facturas`
`e3b6557b3e3d`, …). Si no coinciden, Claude lo mira antes de B1.

## B1 · Backfill mes por mes, del más nuevo al más viejo (se corta solo a las 05:50)
Rango: de **ayer** hacia atrás hasta `2024-01-01`, un mes por corrida, con `--pausa-ms 800`. Antes de cada mes mira la
hora: si el mes que sigue no termina antes de las **05:50** (según lo que tardó el anterior), **para y dice dónde
quedó**. El progreso queda en `C:\satori\d9-vuelta\backfill-progreso.json`; el mismo bloque, la noche siguiente,
**retoma solo**. Reenviar un mes no duplica (upsert por factura; las líneas se reemplazan). Log sin secretos:
`C:\satori\d9-vuelta\backfill-<fecha>.log`.
```powershell
& {
$N = Carpeta $NUEVA; $V = Carpeta $VUELTA; $T = Leer-Tarea
$ahora = Hoy-CR
if ($ahora.Hour -ge 6) { throw "son las $($ahora.ToString('HH:mm', $INV)) CR: el backfill corre solo de 00:00 a 06:00" }
if ($T.Carpeta -ine $N -or $T.Estado -ne 'Running') { throw 'el agente en vivo no es el D9 o no está corriendo' }
if (Backfill-Corriendo) { throw 'ya hay un backfill corriendo' }
$h = git -C $N rev-parse HEAD; Ok 'rev-parse'; if ($h -cne $SHA) { throw 'la carpeta nueva no está en 578f38c…' }
$DESDE_MIN = '2024-01-01'
$CORTE = $ahora.Date.AddHours(5).AddMinutes(50)
$PROG = Join-Path $V 'backfill-progreso.json'
$hasta = $ahora.Date.AddDays(-1).ToString('yyyy-MM-dd', $INV)
if (Test-Path -LiteralPath $PROG) { $pg = [IO.File]::ReadAllText($PROG) | ConvertFrom-Json; $hasta = [string]$pg.siguiente_hasta; "retoma: falta $DESDE_MIN … $hasta" }
if ($hasta -lt $DESDE_MIN) { 'B1: el histórico ya está completo. Nada que hacer.'; return }
$LOG = Join-Path $V ('backfill-' + $ahora.ToString('yyyy-MM-dd_HHmm', $INV) + '.log')
$dur = [TimeSpan]::FromMinutes(5); $hechos = @()
foreach ($m in @(Meses-Backfill $DESDE_MIN $hasta)) {
  if ((Hoy-CR) + $dur + [TimeSpan]::FromMinutes(1) -gt $CORTE) { "CORTE 05:50: no se empieza $($m.Mes). Quedó pendiente $DESDE_MIN … $($m.Hasta): mañana a las 00:00, humo antes y este mismo bloque."; break }
  if ((Get-ScheduledTask -TaskName $TAREA).State -ne 'Running' -or -not @(Get-NodeDe $N $T.Cmd).Count) { throw "PARADA: el agente en vivo dejó de correr. Quedó pendiente $DESDE_MIN … $($m.Hasta)" }
  $t0 = Hoy-CR
  $nc = $env:NO_COLOR; $fc = $env:FORCE_COLOR; $env:NO_COLOR = '1'; $env:FORCE_COLOR = '0'
  Push-Location $N; try {
    node --import ./pos-bridge/register.mjs pos-bridge/backfill.ts --desde $m.Desde --hasta $m.Hasta --pausa-ms 800 | Tee-Object -FilePath $LOG -Append
    if ($LASTEXITCODE -ne 0) { throw "PARADA en $($m.Mes) (código $LASTEXITCODE). Quedó pendiente $DESDE_MIN … $($m.Hasta): re-correr este bloque (reenviar no duplica)" }
  } finally { Pop-Location; $env:NO_COLOR = $nc; $env:FORCE_COLOR = $fc }
  $dur = (Hoy-CR) - $t0; $hechos += $m.Mes
  $sig = ([datetime]::ParseExact($m.Desde, 'yyyy-MM-dd', $INV)).AddDays(-1).ToString('yyyy-MM-dd', $INV)
  $js = (New-Object PSObject -Property ([ordered]@{ ultimo_mes_hecho = $m.Mes; siguiente_hasta = $sig; desde_min = $DESDE_MIN; hora_cr = (Hoy-CR).ToString('yyyy-MM-dd HH:mm', $INV) })) | ConvertTo-Json
  [IO.File]::WriteAllText("$PROG.tmp", $js, (New-Object Text.UTF8Encoding($false))); Move-Item -LiteralPath "$PROG.tmp" -Destination $PROG -Force
  "── $($m.Mes) ok en $([math]::Round($dur.TotalMinutes, 1)) min · siguiente: $sig"
}
$pg = [IO.File]::ReadAllText((Archivo $PROG)) | ConvertFrom-Json
$fin = if ([string]$pg.siguiente_hasta -lt $DESDE_MIN) { 'HISTÓRICO COMPLETO' } else { "falta $DESDE_MIN … $($pg.siguiente_hasta) (sigue la noche siguiente)" }
"B1 · meses hechos esta noche: $($hechos.Count) ($($hechos -join ', ')) · $fin · log $LOG"
}
```
**Ve:** por cada mes, las líneas del backfill (`tickets=… guardados=… líneas=…`) y `── AAAA-MM ok en N min`. Al final
`B1 · … HISTÓRICO COMPLETO` o `falta … (sigue la noche siguiente)`.
**Parada (el bloque para solo):** un mes con error, el agente en vivo que deja de correr. **Además (a ojo):** `inválidos=`
en alguna línea o `guardados` menor que `tickets` → **cerrar la ventana de PowerShell con la X** (corta el backfill; reenviar no
duplica) y avisar.

**(3) Humo después (Claude, mismo corte):** mismo SQL. Regla del PASE D9 §6/§8: `facturas`, `lineas`, `h_facturas`,
`h_lineas` y `h_item11_existentes` **iguales**; `descuento_negativo = 0`; `con_descuento` sube (en el histórico completo,
~15–30 %); `item11_en_null` y `lineas_sin_mesero` bajan o quedan igual. Con el histórico a medias, las huellas tienen que
dar igual igual. Si una no coincide, bloque 2 del humo por mes antes y después, y se para.

**Vuelta atrás de los datos** (PASE D9 §8): re-backfill del mismo rango desde la carpeta del agente de hoy (`5da233a`),
con su propio bloque y firma. Sin SQL a mano.

## Ensayo de los bloques
`scripts/puente/ensayo_seco_d9.ps1` lee los bloques de este archivo **tal cual**: los parsea, mira que no usen nada que
falte en PowerShell 5.1 y los corre en orden con dobles de `git`, `node`, `npm.cmd`, `npx.cmd` y las tareas programadas
(nada sale a la red, no toca ninguna tarea real). Prueba también que **frenan** cuando deben.
```
pwsh -NoProfile -File scripts/puente/ensayo_seco_d9.ps1                                   # Linux o Windows, PowerShell 7
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\puente\ensayo_seco_d9.ps1     # Windows PowerShell 5.1
```

## Bitácora
Parte A hecha el 17-nov (preámbulo y bloques cargados por el método del Bloc de notas; A2 y A3 con los ajustes ya incorporados arriba).
| Paso | Esperado | Obtenido |
|---|---|---|
| A0 · hora CR · agente de hoy · latido (SQL §1) | `5da233a…` limpio · Running · late sin error | **ok** · 06:56 CR · agente `5da233a` limpio · latido sin error |
| A1 · clon | `578f38c…` · árbol `d14d603a…` · 5 archivos | **ok** · `578f38c` · árbol `d14d603a` · 5 archivos |
| A2 · `.env` | copiados idénticos · ninguna clave falta · mismo archivo y largo · candado ok | **ok** tras ajuste de CRLF (el md5 del script en disco difiere por `core.autocrlf`) · 14 claves, ninguna falta · largo 64 · candado ok |
| A3 · dependencias y pruebas | `mssql` carga · typecheck ok · 478 en verde | **ok** tras ajuste de ANSI (vitest metía colores y el regex no veía el 478) · 478 en verde |
| A4 · en seco (7 días) | `con_descuento` 15–30 % · nada enviado | **ok** · 7 días (10–16 nov) · 215 facturas · 41 con descuento (19,1 %) · nada enviado · el día 12-nov salió bajo (2,4 %): se mira en el humo |
| A5 · `HORA_CAMBIO` · segundos detenida | `-06:00` · ~30 s | **ok** · 09:25:34 CR · detenido 21 s |
| A6 · latido ×2 · facturas nuevas con descuento (SQL §2) | late sin error · `descuento_negativo` 0 | **ok** · primer latido 09:25:17 sin error · segundo 09:45:23 sin error · `descuento_negativo` 0. **Pendiente:** el conteo con facturas cerradas del servicio y al cierre de caja |
| B · humo antes | huellas = a §6 | **ok** · 09:58 CR · iguales a las de §6 |
| B1 · meses (de día, con firma del dueño) | histórico completo · errores 0 | **ok** · 09:58–10:29 CR · 35 meses · errores 0 · HISTÓRICO COMPLETO. Ventana cambiada por firma del dueño (17-nov): 09:00–13:50 con corte automático, en vez de 00:00–06:00, porque el personal usa la app desde las 14:00 |
| B · humo después (corte 17-nov 00:00 −06:00) | huellas iguales · `con_descuento` sube | `facturas` 41.045 (=) · `lineas` 231.217 (=) · `h_lineas` `0ff0e84ea80a` (=) · `con_descuento` 8.038 (19,6 %) · `descuento_negativo` 0 · `item11_en_null` 8 (antes 40.859) · `lineas_sin_mesero` 10 (=) · clases: cobrada 30.941 · cortesía 1.005 · descuento 7.288 · dueños 311 · mixta 750 · null 732 · sin_cobro 18. **Distintas:** `h_facturas` `e3b6557b3e3d` → `0b1f3ec1449b` y `h_item11_existentes` `f4126335550d` → `67e4a8e25ca3` |
| Diferencia de noviembre | solo cambia lo esperado | Por mes: los 34 meses 2024-01…2026-10 dan `h_facturas` idéntica al antes; solo 2026-11 cambió (`7410050f0cce` → `5b759c6ab00f`). Contra staging (mismo PoS, ingestado @`14bd278`), columna por columna: todo igual (incluidas área, mesa, FE, apertura, total y pagos) salvo `descuento_crc` y `clase_ingreso` (esperados) y `servicio_crc` con ±1 céntimo en 2 facturas del 15–16 nov (una +0,01, otra −0,01). **Decisión del dueño, 17-nov: aceptado, sin impacto en ventas, totales ni pagos.** Causa: ver comentario del PR #252 |
