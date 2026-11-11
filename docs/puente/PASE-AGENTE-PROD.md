# Pase a PROD del AGENTE NUEVO del puente (pos-bridge `4d3513a` → `5da233a`)

> **Estado: EJECUTADO el 10-nov-2026 (agente `5da233a` en prod desde las 23:37:18 -06:00, al segundo intento). El cierre queda ABIERTO: faltan 5.2/5.4 y el cierre de caja del 11-nov. Bitácora en §9; las correcciones que dejó el pase están marcadas «corrección 10-nov».**
>
> Antes: preparado. Formato de [`PASE-PROD-PLANTILLA.md`](PASE-PROD-PLANTILLA.md).
>
> **Nada de este documento se ejecuta en prod hasta que el dueño lo firme (§9).** Si algo no coincide con lo que dice
> acá, **se para y se avisa**: no se improvisa en prod. Claude no corre nada en prod.
>
> **Por qué hace falta antes del piloto:** con el agente de prod de hoy (`4d3513a`), `mesa_factura`, `consecutivo_fe`,
> `clave_fe`, `area_factura` y la apertura del pedido llegan en null.
> - Las cuentas divididas no cruzan con su pedido: la factura sin pedido no trae mesa.
> - No se puede buscar una factura por los dígitos del tiquete: no hay consecutivo.
>
> Ver [`FLUJO-SALON-cruce.md`](../club-satori/FLUJO-SALON-cruce.md) (rama del Club).

## Qué pasa y qué no
- **Pasa:** el código del agente (`pos-bridge/`) en la PC del PoS, de `4d3513a6…` a `5da233a5…`, el mismo commit del
  código del pase del puente del 09-nov. Se hace en una **carpeta nueva**, y la tarea pasa a un `.cmd` nuevo (§2–§4).
- **No pasa:**
  - nada en la base: sin migraciones, porque la 081 y la 082 v3 ya están en prod;
  - el Edge: sigue `ingest-ndf` v3, el de `5da233a`;
  - el secreto: es el mismo, de 64 caracteres, y ya está en el mapa `POS_INGEST_SECRETS`. **No se rota**;
  - el nombre de la tarea, su cuenta (SYSTEM) y su horario;
  - **`C:\satori\satori-app-prod` no se toca:** queda intacta como vuelta atrás.

### Qué cambia en el agente, en simple (4 commits, solo `pos-bridge/`; 7 archivos, sin dependencias nuevas)
| Commit | Qué hace |
|---|---|
| `1ee268b` | La factura trae **la mesa donde se cobró** (`mesa_factura`), el **consecutivo** y la **clave de la factura electrónica** (`consecutivo_fe`, `clave_fe`) y **la hora de apertura del pedido** (`pedido_abierto_en`). Lee columnas que el PoS ya tiene; si alguna falta, manda null (nunca tumba la factura). |
| `1d1016d` | El **área** de la mesa: `area_factura` en las facturas y `area` en los pedidos abiertos (la mesa 3 del área A no es la mesa 3 del área M). |
| `eee0515` | Ordena la rama: la mig 081 vive en un solo lugar. No cambia el código del agente. |
| `d531809` | (1) **Clave del pedido abierto con fecha**: `pedido:<AAAA-MM-DD>:<n>`, porque el número se reinicia cada día; la fecha sale de la apertura del pedido. (2) **Candado de prod por destino**: si `INGEST_URL` no es staging, el agente **no arranca** sin `POS_AGENTE_PROD_FIRMADO=<fecha>` en su `.env`, aunque diga `ENV=prod`. |

**Qué no cambia en el agente:**
- qué facturas lee, cada cuánto y cómo calcula el pax;
- cómo manda (mismo Edge, mismo encabezado `x-ingest-secret`);
- el cursor: lo calcula la base desde la 082 v3;
- el backfill y el replay.

Del código compartido (`src/shared/ndf/ingestNdf.ts`), en tiempo de ejecución usa solo `conOffsetCR`, **igual** en las dos
versiones. Lo demás son tipos.

## Compatibilidad con lo que está en prod
**No hace falta otro Edge ni ninguna migración.**
- Las 5 columnas nuevas existen en prod desde la **081** (09-nov 10:57).
- El Edge v3 (`5da233a`) ya normaliza esos campos: textos acotados, `consecutivo_fe` y `clave_fe` como dígitos, y una
  clave de pedido de hasta 60 caracteres. La clave nueva mide ~21.
- La **082 v3** guarda la foto de pedidos abiertos por `(local, clave)`. Con la clave nueva, el primer ciclo reemplaza la
  foto entera, y las filas con la clave vieja se borran porque ya no están en la foto.
- La app de prod usa esa clave solo como identificador de fila en «En vivo». El formato no le importa.
- **Staging:** el agente `283e3c4` manda esos campos contra el mismo Edge desde el 07-nov. Las facturas cerradas llegan con
  todos (46 de 46) y las anuladas sin consecutivo ni clave FE, como corresponde.
  - **Lo que todavía NO corrió contra el PoS real es `d531809`** (clave con fecha y candado). Por eso el prerrequisito 0.3.

## SHA y huellas
| Qué | Valor |
|---|---|
| Agente de prod hoy | `4d3513a6df8e838dd5c0442b05a580e06ce9db9d` · árbol `pos-bridge` `6ef25b90100892e0b271ed6fe2aa198947b9c582` |
| Agente nuevo | `5da233a516d1a6c4c2c95eb165be448be5416697` · árbol `pos-bridge` `5600ebbd287559b23667f61c6e4c90181fa24b8e` |
| Script de medición (del paquete del puente, `cd6d5a1`) | `scripts/puente/armar_mapa_secretos.mjs` md5 `73c4d9d207c22c13d5c42498bb63e8ca` |
| Carpeta nueva | `C:\satori\agente-prod-5da233a` |
| `.cmd` nuevo | `C:\satori\pos-agente-prod-5da233a.cmd` (copia del viejo con la carpeta cambiada) |

## Responsables
- **Ejecución:** el dueño, en la PC del PoS, en **PowerShell como administrador**, con el preámbulo en cada consola.
- **Control:** el encargado del turno. Lee en voz alta cada resultado esperado contra el obtenido. No es la misma persona.
- **Claude no corre nada en prod.** Prepara, revisa y lee los resultados que le pasan.

## 0. Prerrequisitos
| # | Qué | Cómo se verifica |
|---|---|---|
| 0.1 | Firma del dueño en §9, con el SHA de la cabeza del PR | firma |
| 0.2 | Los dos responsables presentes | §9 |
| 0.3 | **Ensayo en STAGING con `5da233a`:** el agente de staging («Satori PoS Bridge», `C:\satori\satori-app`) corriendo con `5da233a` **al menos un día de servicio, con un cierre de caja**: latido sin error, claves con fecha en la foto de pedidos, campos nuevos en las cerradas, sin facturas ni líneas duplicadas (las consultas de §5 contra staging) | anotado en §9 |
| 0.4 | Ventana **fuera de servicio y nunca entre 17:00 y 23:00 CR**. La tarea queda detenida ~2 minutos | hora en §9 |
| 0.5 | Node del agente y `npm.cmd` (no `npm`) | `node --version; Ok 'node'` · `npm.cmd --version; Ok 'npm'` |

## Consola (en cada una, antes que nada)
**Notas de ejecución (corrección 10-nov, del pase real):**
- **PowerShell ISE:** `git` y `npm` escriben a stderr, y con `$ErrorActionPreference = 'Stop'` el ISE corta el bloque
  aunque el comando haya salido bien. En los bloques con comandos nativos (2.1, 2.3 y 2.5) se pone
  `$ErrorActionPreference = 'Continue'` antes de correrlos y se vuelve a `'Stop'` después. Los `Ok '…'` y los `throw`
  siguen frenando igual. En la consola normal de PowerShell no hace falta.
- **El SQL va en el editor SQL de Supabase**, no en PowerShell (1.3 y §5).

```powershell
$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
function Ok([string]$que) { if ($LASTEXITCODE -ne 0) { throw "falló «$que» (código $LASTEXITCODE): NO SE SIGUE" } }
function Carpeta([string]$p) { if (-not [IO.Path]::IsPathRooted($p) -or -not (Test-Path -LiteralPath $p -PathType Container)) { throw "no es una carpeta absoluta existente: $p" }; (Resolve-Path -LiteralPath $p).Path }
function Archivo([string]$p) { if (-not [IO.Path]::IsPathRooted($p) -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "no es un archivo absoluto existente: $p" }; (Resolve-Path -LiteralPath $p).Path }
function Md5Bytes([string]$p) { (Get-FileHash -Algorithm MD5 -LiteralPath (Archivo $p)).Hash.ToLower() }   # sobre los BYTES, sin decodificar
# Corrección 09-nov (hallazgo del pase, 4.1): en la PC del PoS corren DOS agentes, prod y staging, con la MISMA línea de
# comando («node … pos-bridge/agente.ts», rutas relativas). Filtrar node.exe por la palabra 'agente' agarraba los dos: el
# de prod estuvo ~40 min detenido esperando al de staging, y el «cerrar node a mano» cerró el de staging (~11:58). El
# node de un agente se identifica por su CARPETA: la nombra su línea de comando o la de un proceso padre (el .cmd de la
# tarea, que 1.9 verificó que entra a esa carpeta). Nunca por una palabra suelta. Ningún bloque cierra procesos.
function Get-NodeDe([string]$Carpeta, [string]$Cmd) {
  $todos = @(Get-CimInstance Win32_Process); $porPid = @{}; foreach ($x in $todos) { $porPid[[int]$x.ProcessId] = $x }
  $marcas = @('(?i)' + [regex]::Escape($Carpeta.TrimEnd('\')) + '(\\|"|\s|$)')
  if ($Cmd) { $marcas += '(?i)' + [regex]::Escape($Cmd) + '("|\s|$)' }
  @($todos | Where-Object { $_.Name -eq 'node.exe' } | Where-Object {
    $x = $_; $es = $false
    for ($i = 0; $x -and $i -lt 6 -and -not $es; $i++) {
      foreach ($m in $marcas) { if ([string]$x.CommandLine -match $m) { $es = $true } }
      $x = if ([int]$x.ParentProcessId -ne [int]$x.ProcessId) { $porPid[[int]$x.ParentProcessId] } else { $null }
    }
    $es })
}
# Detiene la tarea y espera a que terminen SOLO los node.exe de esa carpeta (sus PID se toman ANTES de detenerla: después,
# sin el .cmd padre, un node que tarde en cerrar ya no se podría atribuir). Los demás node.exe no se miran ni se tocan.
function Detener-Agente([string]$Tarea, [string]$Carpeta, [string]$Cmd) {
  $pids = @(Get-NodeDe $Carpeta $Cmd | ForEach-Object { [int]$_.ProcessId })
  $otros = @(Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $pids -notcontains [int]$_.ProcessId } | ForEach-Object { [int]$_.ProcessId })
  if ((Get-ScheduledTask -TaskName $Tarea).State -eq 'Running' -and -not $pids.Count) { throw "PARADA: la tarea $Tarea corre y no se encuentra su node.exe por la carpeta $Carpeta (ni por $Cmd): no se adivina cuál es" }
  "node del agente de $Carpeta : $($pids -join ', ') · otros node.exe (no se tocan): $($otros.Count)"
  Stop-ScheduledTask -TaskName $Tarea
  $t0 = Get-Date
  while ((Get-ScheduledTask -TaskName $Tarea).State -eq 'Running' -or @(Get-CimInstance Win32_Process | Where-Object { $pids -contains [int]$_.ProcessId }).Count) {
    if ((Get-Date) - $t0 -gt [TimeSpan]::FromMinutes(3)) { throw "el agente de $Carpeta (node $($pids -join ', ')) no se detuvo en 3 minutos: se avisa al dueño; si hay que cerrarlo, SOLO esos PID (Stop-Process -Id), nunca por nombre" }
    Start-Sleep -Seconds 5
  }
  "agente de $Carpeta detenido $(Get-Date -Format 'HH:mm:ss') · los otros node.exe siguen: $(@(Get-CimInstance Win32_Process | Where-Object { $otros -contains [int]$_.ProcessId }).Count) de $($otros.Count)"
}
if (Test-Path -LiteralPath C:\satori\supabase-cli -PathType Container) { $env:Path = 'C:\satori\supabase-cli;' + $env:Path }   # corrección 09-nov: el CLI del pase (0.6)
```

## 1. Lecturas previas
**1.1 La tarea y el agente de hoy** (solo lectura):
```powershell
$t = Get-ScheduledTask -TaskName 'Satori PoS Bridge PROD'
$acciones = @($t.Actions)
if ($acciones.Count -ne 1) { throw "la tarea tiene $($acciones.Count) acciones: se esperaba una" }
$CMDV = Archivo (([string]$acciones[0].Execute).Trim('"'))
if ($CMDV -cne (Archivo C:\satori\pos-agente-prod.cmd)) { throw "la tarea no corre C:\satori\pos-agente-prod.cmd sino ${CMDV}: se para y se avisa" }
$txtV = [IO.File]::ReadAllText($CMDV)
if ($txtV -notmatch ('(?im)^\s*cd\s+/d\s+"?' + [regex]::Escape('C:\satori\satori-app-prod') + '\\?"?\s*$')) { throw 'el .cmd de la tarea no entra a C:\satori\satori-app-prod' }
$AGV = Carpeta C:\satori\satori-app-prod
$h = git -C $AGV rev-parse HEAD; Ok 'rev-parse agente'
if ($h -cne '4d3513a6df8e838dd5c0442b05a580e06ce9db9d') { throw 'el agente de prod no está en 4d3513a6…' }
$s = git -C $AGV status --porcelain --untracked-files=no; Ok 'status agente'; if ($s) { throw 'el agente de prod tiene cambios' }
$md5CmdV = Md5Bytes $CMDV
"1.1 ok · tarea → $CMDV (md5 ${md5CmdV}: anotar) · agente 4d3513a6… limpio · $($t.State)"
```

**1.2 El entorno de la cuenta de la tarea** (Grok 121, igual que la plantilla; solo lectura). Si la cuenta tuviera
variables `INGEST_…` o `POS_…`, pisarían el `.env` del agente nuevo también:
```powershell
$t = Get-ScheduledTask -TaskName 'Satori PoS Bridge PROD'
$AGDIR = 'C:\satori\satori-app-prod'
$acciones = @($t.Actions)
if ($acciones.Count -ne 1) { throw "la tarea tiene $($acciones.Count) acciones: se esperaba una" }
$ex = ([string]$acciones[0].Execute).Trim('"')
$acc = "$ex $($acciones[0].Arguments) $($acciones[0].WorkingDirectory)"
# corrección 09-nov: la acción real es un .cmd (C:\satori\pos-agente-prod.cmd: «cd /d C:\satori\satori-app-prod» y node).
# Si es .cmd o .bat, se LEE: tiene que entrar a la carpeta del agente y no definir variables del agente.
if ($ex -match '\.(cmd|bat)$') {
  $txt = [IO.File]::ReadAllText((Archivo $ex))
  if ($txt -notmatch ('(?im)^\s*cd\s+/d\s+"?' + [regex]::Escape($AGDIR) + '\\?"?\s*$')) { throw "la tarea no corre el agente de $AGDIR (el .cmd no hace cd /d ahí)" }
  if ($txt -match '(?im)^\s*set\s+"?(INGEST_|POS_)') { throw 'el .cmd de la tarea define variables del agente (INGEST_/POS_)' }
  $acc = "$acc $txt"
}
if ($acc -notmatch 'satori-app-prod') { throw 'la tarea no corre el agente de C:\satori\satori-app-prod' }
if ($acc -match 'INGEST_|POS_') { throw 'la acción de la tarea define variables del agente en la línea de comando' }
# 121 (Grok, auditoría v3): el entorno de la cuenta de la tarea, robusto. Dice QUÉ leyó y DE DÓNDE. Si no puede leer: PARADA.
$cuenta = ([string]$t.Principal.UserId).Trim()
if (-not $cuenta) { throw "PARADA 1.9: la tarea no tiene una cuenta (UserId vacío; grupo: $($t.Principal.GroupId))" }
try { $sid = (New-Object Security.Principal.NTAccount($cuenta)).Translate([Security.Principal.SecurityIdentifier]).Value }
catch { throw "PARADA 1.9: la cuenta de la tarea ($cuenta) no se puede resolver a un SID" }
$claves = '^(INGEST_|POS_)'
$maq = @([Environment]::GetEnvironmentVariables('Machine').Keys | Where-Object { $_ -match $claves })
$leido = @('máquina: HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment')
$usr = @()
if (Test-Path -LiteralPath "Registry::HKEY_USERS\$sid") {
  # Perfil CARGADO: SYSTEM (S-1-5-18), LOCAL SERVICE (S-1-5-19) y NETWORK SERVICE (S-1-5-20) lo están siempre; un usuario, si tiene sesión.
  $ent = "Registry::HKEY_USERS\$sid\Environment"
  if (Test-Path -LiteralPath $ent) { $usr = @((Get-Item -LiteralPath $ent).Property | Where-Object { $_ -match $claves }); $leido += "cuenta: HKEY_USERS\$sid\Environment (perfil cargado)" }
  else { $leido += "cuenta: HKEY_USERS\$sid sin clave Environment (perfil cargado; 0 variables de la cuenta)" }
} else {
  # Perfil NO cargado (cuenta de servicio o usuario sin sesión): se monta su NTUSER.DAT, se lee y se desmonta.
  # Si la cuenta todavía no tiene perfil, Windows se lo crea desde el perfil Default: se lee ese.
  $PL = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList'
  if (Test-Path -LiteralPath "$PL\$sid") { $perfil = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath "$PL\$sid").ProfileImagePath); $cual = 'perfil de la cuenta, no cargado' }
  else { $perfil = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath $PL).Default); $cual = 'la cuenta no tiene perfil: perfil Default, del que se le crearía' }
  $dat = Join-Path $perfil 'NTUSER.DAT'
  if (-not (Test-Path -LiteralPath $dat -PathType Leaf)) { throw "PARADA 1.9: no se encuentra $dat ($cual) de la cuenta $cuenta" }
  $HIVE = 'satori-pase-1-9'
  if (Test-Path -LiteralPath "Registry::HKEY_USERS\$HIVE") { throw "PARADA 1.9: HKEY_USERS\$HIVE ya está montado (corrida anterior): desmontarlo con «reg.exe unload HKU\$HIVE» y repetir" }
  reg.exe load "HKU\$HIVE" "$dat" | Out-Null; Ok "reg load de $dat (hace falta una consola de administrador)"
  try {
    $ent = "Registry::HKEY_USERS\$HIVE\Environment"
    if (Test-Path -LiteralPath $ent) { $k = Get-Item -LiteralPath $ent; $usr = @($k.Property | Where-Object { $_ -match $claves }); $k.Close() }
    $leido += "cuenta: $dat ($cual), montado en HKEY_USERS\$HIVE y desmontado"
  } finally { $k = $null; [GC]::Collect(); [GC]::WaitForPendingFinalizers(); reg.exe unload "HKU\$HIVE" | Out-Null; Ok 'reg unload' }
}
if ($maq.Count -or $usr.Count) { throw "variables que pisan el .env del agente (solo nombres): $(@($maq + $usr) -join ', ')" }
"1.9 entorno ok · cuenta $cuenta ($sid) · sin INGEST_/POS_ · leído de: $($leido -join ' | ')"
```

**1.3 En el editor SQL de PROD** (solo lectura). La foto de antes:
```sql
begin read only;
select local, last_factura, last_poll_at, now() - last_poll_at as hace, last_error from public.pos_ndf_cursor;   -- hace < 2 min, sin error
select count(*) as cerradas_24h,
       count(*) filter (where mesa_factura is not null)   as con_mesa_factura,     -- hoy 0 (agente viejo)
       count(*) filter (where consecutivo_fe is not null) as con_consecutivo,      -- hoy 0
       count(*) filter (where clave_fe is not null)       as con_clave_fe          -- hoy 0
  from public.pos_ndf_tickets where local = 'santa-teresa' and estado = 'C' and fecha_registra >= now() - interval '24 hours';
select count(*) as abiertos, count(*) filter (where clave ~ '^pedido:[0-9]+$') as clave_vieja from public.pos_ndf_open;
rollback;
```
**Para** si: el cursor no late o tiene error; 1.1 o 1.2 cortan.

## 2. Preparar la carpeta nueva (con la tarea ANDANDO)
**2.1 Clon en el SHA, con el árbol del agente verificado, y dependencias** (en la raíz **y dentro de `pos-bridge\`**, que
tiene su propio `package.json`):
```powershell
$NUEVA = 'C:\satori\agente-prod-5da233a'
if (Test-Path -LiteralPath $NUEVA) { throw "$NUEVA ya existe: revisarlo o borrarlo antes" }
git clone https://github.com/CachoSatori/satori-app.git $NUEVA; Ok 'clone'
$NUEVA = Carpeta $NUEVA
git -C $NUEVA fetch origin claude/puente-item11-prod-v2; Ok 'fetch'
git -C $NUEVA checkout --detach 5da233a516d1a6c4c2c95eb165be448be5416697; Ok 'checkout'
$h = git -C $NUEVA rev-parse HEAD; Ok 'rev-parse'
if ($h -cne '5da233a516d1a6c4c2c95eb165be448be5416697') { throw 'la carpeta nueva no está en 5da233a5…' }
$arbol = git -C $NUEVA rev-parse 'HEAD:pos-bridge'; Ok 'árbol pos-bridge'
if ($arbol -cne '5600ebbd287559b23667f61c6e4c90181fa24b8e') { throw 'pos-bridge de la carpeta nueva no es el revisado' }
Push-Location $NUEVA; try { npm.cmd ci; Ok 'npm ci' } finally { Pop-Location }
# Corrección 10-nov (hallazgo del pase): pos-bridge tiene su PROPIO package.json (mssql). Sin `npm.cmd ci` ahí adentro el
# agente nuevo no arranca (LastTaskResult 1). Se instala y se comprueba que `mssql` carga DESDE pos-bridge.
Push-Location (Carpeta (Join-Path $NUEVA 'pos-bridge')); try {
  npm.cmd ci; Ok 'npm ci (pos-bridge)'
  $m = node -e "import('mssql').then(() => console.log('si'), () => { console.log('no'); process.exit(1) })"; Ok "import('mssql') desde pos-bridge"
  if ("$m".Trim() -cne 'si') { throw "mssql no carga desde pos-bridge: NO SE SIGUE" }
} finally { Pop-Location }
"2.1 ok · carpeta nueva en 5da233a5… · pos-bridge $($arbol.Substring(0,12))… · dependencias instaladas (raíz y pos-bridge) · mssql carga"
```

**2.2 El `.env` del agente, copiado sin mostrarlo, y la firma del candado** (CLUB-AUD-32). Se copian los mismos archivos
que tiene la carpeta de prod, idénticos byte a byte. La firma se agrega **solo** en la carpeta nueva. **Si la firma ya
viene en el `.env` de prod, no es un error** (corrección 10-nov: en el pase real ya estaba, con fecha 2026-10-28): se
anota su fecha y se sigue. El 2.3 prueba el candado con esa firma:
```powershell
$VIEJA = Carpeta C:\satori\satori-app-prod; $NUEVA = Carpeta C:\satori\agente-prod-5da233a
$copiados = @()
foreach ($e in @('.env', '.env.local', 'pos-bridge\.env')) {
  $o = Join-Path $VIEJA $e
  if (Test-Path -LiteralPath $o -PathType Leaf) {
    $d = Join-Path $NUEVA $e
    if (Test-Path -LiteralPath $d) { throw "en la carpeta nueva ya existe $e" }
    Copy-Item -LiteralPath $o -Destination $d
    if ((Md5Bytes $o) -cne (Md5Bytes $d)) { throw "la copia de $e no es idéntica" }
    $copiados += $e
  }
}
if (-not $copiados.Count) { throw 'no se encontró ningún .env en la carpeta de prod' }
$f = Join-Path $NUEVA 'pos-bridge\.env'
$prev = if (Test-Path -LiteralPath $f) { [IO.File]::ReadAllText($f) } else { '' }
$ya = [regex]::Matches($prev, '(?m)^\s*POS_AGENTE_PROD_FIRMADO\s*=\s*(\S*)')
if ($ya.Count -gt 1) { throw 'la firma está más de una vez en el .env: revisarlo' }
if ($ya.Count -eq 1) {
  "2.2 ok · copiados idénticos: $($copiados -join ', ') · la firma YA VENÍA en el .env de prod (fecha $($ya[0].Groups[1].Value)): no se agrega otra; anotar la fecha en §9"
} else {
  $sep = if ($prev -and -not $prev.EndsWith("`n")) { "`r`n" } else { '' }
  [IO.File]::AppendAllText($f, "${sep}POS_AGENTE_PROD_FIRMADO=$(Get-Date -Format 'yyyy-MM-dd')`r`n", (New-Object Text.UTF8Encoding($false)))
  "2.2 ok · copiados idénticos: $($copiados -join ', ') · firma agregada en pos-bridge\.env de la carpeta nueva"
}
```

**2.3 El agente nuevo arranca con esta configuración y manda el MISMO secreto.** Se mide con el parser del propio agente:
`loadAgenteConfig` de cada carpeta, que en la nueva **ejecuta el candado**. Si falta la firma o el destino no cuadra, falla
acá, antes de tocar la tarea. No se muestra ningún valor:
```powershell
$VIEJA = Carpeta C:\satori\satori-app-prod; $NUEVA = Carpeta C:\satori\agente-prod-5da233a
# 135: los scripts de ESTE pase van a una carpeta NUEVA, C:\satori\pase-scripts\agente-<fecha y hora>. No se borra nada: en
# C:\satori\pase-scripts quedan los del pase del puente (0.5b de la plantilla). Si la carpeta ya existiera, se para.
$SCR = "C:\satori\pase-scripts\agente-$(Get-Date -Format 'yyyy-MM-dd_HHmmss')"
if (Test-Path -LiteralPath $SCR) { throw "ya existe ${SCR}: no se pisa ni se borra nada; esperar un segundo y repetir" }
New-Item -ItemType Directory -Path $SCR | Out-Null; $SCR = Carpeta $SCR
cmd /c "git -C `"$NUEVA`" show cd6d5a1ceb7adf06a0f79b780f126a4263884ca3:scripts/puente/armar_mapa_secretos.mjs > `"$SCR\armar_mapa_secretos.mjs`""; Ok 'show armar_mapa'
if ((Md5Bytes "$SCR\armar_mapa_secretos.mjs") -cne '73c4d9d207c22c13d5c42498bb63e8ca') { throw 'armar_mapa_secretos.mjs: md5 distinto' }
$regV = 'file:///' + ((Archivo "$VIEJA\pos-bridge\register.mjs") -replace '\\','/')
$mV = node --import $regV (Archivo "$SCR\armar_mapa_secretos.mjs") --agente $VIEJA --clon $NUEVA --solo-medir; Ok 'medir carpeta vieja'
$regN = 'file:///' + ((Archivo "$NUEVA\pos-bridge\register.mjs") -replace '\\','/')
$mN = node --import $regN (Archivo "$SCR\armar_mapa_secretos.mjs") --agente $NUEVA --clon $NUEVA --solo-medir; Ok 'medir carpeta nueva (candado)'
$v = $mV | ConvertFrom-Json; $n = $mN | ConvertFrom-Json
if ($n.archivo_que_manda -cne $v.archivo_que_manda -or $n.largo_santa_teresa -ne $v.largo_santa_teresa) { throw 'la carpeta nueva no manda el mismo secreto que la vieja' }
if (-not $n.cumple_32) { throw 'PARADA (Grok 120): el secreto mide menos de 32' }
"2.3 ok · las dos carpetas mandan $($n.archivo_que_manda) · largo $($n.largo_santa_teresa) · el candado del agente nuevo pasa"
```

**2.4 El `.cmd` nuevo:** es una copia del viejo con **solo** la carpeta cambiada, byte a byte en lo demás:
```powershell
$CMDV = Archivo C:\satori\pos-agente-prod.cmd
$CMDN = 'C:\satori\pos-agente-prod-5da233a.cmd'
if (Test-Path -LiteralPath $CMDN) { throw "$CMDN ya existe" }
$lat = [Text.Encoding]::GetEncoding('ISO-8859-1')                 # 1 byte = 1 carácter: no cambia ningún otro byte
$txtV = $lat.GetString([IO.File]::ReadAllBytes($CMDV))
$txtN = $txtV.Replace('C:\satori\satori-app-prod', 'C:\satori\agente-prod-5da233a')
if ($txtN -ceq $txtV) { throw 'el .cmd viejo no menciona C:\satori\satori-app-prod' }
if ($txtN.Replace('C:\satori\agente-prod-5da233a', 'C:\satori\satori-app-prod') -cne $txtV) { throw 'el .cmd nuevo cambió algo más que la carpeta' }
[IO.File]::WriteAllBytes($CMDN, $lat.GetBytes($txtN))
"2.4 ok · $CMDN = $CMDV con la carpeta cambiada"
```

**2.5 Las dependencias del agente cargan desde la carpeta nueva** (corrección 10-nov). El candado del 2.3 no prueba que
el agente pueda arrancar: en el pase real pasó el candado y el agente no arrancó, porque faltaba `mssql` en `pos-bridge\`.
Justo antes del cambio se vuelve a comprobar, desde `pos-bridge\` de la carpeta nueva:
```powershell
$NUEVA = Carpeta C:\satori\agente-prod-5da233a
Push-Location (Carpeta (Join-Path $NUEVA 'pos-bridge')); try {
  $m = node -e "import('mssql').then(() => console.log('si'), () => { console.log('no'); process.exit(1) })"; Ok "import('mssql') desde pos-bridge (2.5)"
  if ("$m".Trim() -cne 'si') { throw "mssql no carga desde pos-bridge: NO SE HACE EL CAMBIO" }
} finally { Pop-Location }
"2.5 ok · mssql carga desde pos-bridge de la carpeta nueva"
```

## 3. El cambio (la tarea queda detenida ~2 minutos)
Se cambia **solo la acción** de la tarea: el `.cmd`. La cuenta, los disparadores y la configuración no se tocan.
```powershell
$t = Get-ScheduledTask -TaskName 'Satori PoS Bridge PROD'
$a0 = @($t.Actions)[0]
$CMDV = Archivo C:\satori\pos-agente-prod.cmd; $CMDN = Archivo C:\satori\pos-agente-prod-5da233a.cmd
if ((Md5Bytes $CMDV) -cne $md5CmdV) { throw 'el .cmd viejo cambió desde 1.1: se para y se avisa' }
if ((([string]$a0.Execute).Trim('"')) -cne $CMDV) { throw 'la tarea ya no corre el .cmd viejo' }
Detener-Agente 'Satori PoS Bridge PROD' (Carpeta C:\satori\satori-app-prod) $CMDV   # por su carpeta y su .cmd, nunca por una palabra
$detenida = Get-Date
$p = @{ Execute = $CMDN }
if ($a0.Arguments) { $p.Argument = $a0.Arguments }
if ($a0.WorkingDirectory) { $p.WorkingDirectory = $a0.WorkingDirectory }
Set-ScheduledTask -TaskName 'Satori PoS Bridge PROD' -Action (New-ScheduledTaskAction @p) | Out-Null
if ((([string]@((Get-ScheduledTask -TaskName 'Satori PoS Bridge PROD').Actions)[0].Execute).Trim('"')) -cne $CMDN) { throw 'la acción no quedó en el .cmd nuevo' }
Start-ScheduledTask -TaskName 'Satori PoS Bridge PROD'; Start-Sleep -Seconds 20
if ((Get-ScheduledTask -TaskName 'Satori PoS Bridge PROD').State -ne 'Running') { throw 'el agente nuevo no arrancó: vuelta atrás (§6)' }
"3 ok · tarea → $CMDN · detenida $([math]::Round(((Get-Date) - $detenida).TotalSeconds)) s · HORA_CAMBIO $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')-06:00 (anotar)"
```
**Cómo se identifica el agente de prod (hallazgo del pase del 09-nov, 4.1).** El agente de **staging**
(`C:\satori\satori-app`) corre en la misma PC con **la misma línea de comando** (rutas relativas): ni la palabra
`agente` ni `satori-app-prod` sirven para filtrar `node.exe`. El 09-nov el filtro por `agente` dejó al de prod ~40 min
detenido, y el «cerrar node a mano» cerró probablemente el de staging. `Detener-Agente` (preámbulo) toma los `node.exe`
cuya línea de comando, o la de un proceso padre (el `.cmd` de la tarea, que entra a la carpeta), nombra la carpeta; anota
sus PID **antes** de detener la tarea y espera solo esos. Si la tarea corre y no los encuentra: PARADA. **Ningún bloque
cierra procesos**; si el de prod no se detiene en 3 minutos, se avisa y se cierra **solo por PID**.

## 4. Prueba de humo (los primeros 5 minutos)
1. **El agente entra:** en el editor SQL de PROD, el cursor late (`hace` < 2 min) **sin error**, dos veces, con 2 minutos de
   diferencia. El último corte sigue avanzando.
2. **Edge → Logs:** cada `200` trae `invalid = 0`. Sin `401` y sin `ingest-ndf: excepción`.
3. **Si el agente no arranca** (la tarea no queda `Running`, o el cursor no late en 3 minutos), **vuelta atrás (§6)**.
   El candado ya se probó en 2.3, así que esto no debería pasar por la firma.

## 5. Primera hora (cada 15 minutos, 4 veces; SOLO LECTURA)
Con `<HORA_CAMBIO>` de §3, escrito `'AAAA-MM-DD HH:MM:SS-06:00'::timestamptz`:
```sql
begin read only;
-- 5.1 latido
select last_factura, now() - last_poll_at as hace, last_error from public.pos_ndf_cursor where local = 'santa-teresa';
-- 5.2 los campos nuevos llegan en lo que entró después del cambio (R y C; las X no traen consecutivo ni clave FE)
select estado, count(*) as n,
       count(*) filter (where mesa_factura is not null)   as con_mesa_factura,
       count(*) filter (where area_factura is not null)   as con_area,
       count(*) filter (where consecutivo_fe is not null) as con_consecutivo,
       count(*) filter (where clave_fe is not null)       as con_clave_fe,
       count(*) filter (where numero_pedido is not null)  as con_pedido,
       count(*) filter (where numero_pedido is not null and pedido_abierto_en is not null) as con_apertura
  from public.pos_ndf_tickets
 where local = 'santa-teresa' and ingested_at >= '<HORA_CAMBIO>'::timestamptz
 group by estado order by estado;
-- 5.3 la foto de pedidos abiertos con la clave nueva
select count(*) as abiertos, count(*) filter (where clave ~ '^pedido:[0-9]{4}-[0-9]{2}-[0-9]{2}:') as clave_con_fecha,
       count(*) filter (where clave ~ '^pedido:[0-9]+$') as clave_vieja
  from public.pos_ndf_open where local = 'santa-teresa';
-- 5.4 sin duplicados: las líneas de cada factura NO cambian entre dos lecturas (anotar y comparar con la de 15 min antes)
select t.numero_factura, t.estado, count(l.*) as lineas, coalesce(sum(l.monto), 0) as suma_lineas
  from public.pos_ndf_tickets t left join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
 where t.local = 'santa-teresa' and t.ingested_at >= '<HORA_CAMBIO>'::timestamptz - interval '2 hours'
 group by t.id order by t.fecha_registra desc limit 20;
rollback;
```
**Esperado:**
- **5.1:** late sin error.
- **5.2:**
  - las **C** traen `mesa_factura`, `area`, `consecutivo` y `clave_fe` (como staging, 46 de 46);
  - las **R** traen mesa y área. **El consecutivo y la clave FE de una R se confirman en el cierre de caja**, cuando pasa a
    C: en staging no hubo R para verlo;
  - las **X** no traen consecutivo ni clave FE;
  - `con_apertura = con_pedido`.
- **5.3:** `clave_vieja = 0` desde el primer ciclo y todas con fecha.
- **5.4:**
  - las mismas `lineas` y `suma_lineas` en cada lectura para la misma factura;
  - **la primera factura que se cobre**, comparada con su tiquete: líneas y total iguales;
  - `numero_factura` no puede repetirse: la tabla tiene clave única `(local, numero_factura)`.
- **Al cierre de caja** (16:00 o ~23:00): repetir 5.2. Las que pasaron de R a C traen consecutivo y clave FE.

## 6. Vuelta atrás (la carpeta vieja está intacta; ~2 minutos)
```powershell
$CMDV = Archivo C:\satori\pos-agente-prod.cmd
Detener-Agente 'Satori PoS Bridge PROD' (Carpeta C:\satori\agente-prod-5da233a) (Archivo C:\satori\pos-agente-prod-5da233a.cmd)
Set-ScheduledTask -TaskName 'Satori PoS Bridge PROD' -Action (New-ScheduledTaskAction -Execute $CMDV) | Out-Null
if ((([string]@((Get-ScheduledTask -TaskName 'Satori PoS Bridge PROD').Actions)[0].Execute).Trim('"')) -cne $CMDV) { throw 'la acción no volvió al .cmd viejo' }
Start-ScheduledTask -TaskName 'Satori PoS Bridge PROD'; Start-Sleep -Seconds 20
if ((Get-ScheduledTask -TaskName 'Satori PoS Bridge PROD').State -ne 'Running') { throw 'el agente viejo no arrancó: se avisa' }
"6 ok · tarea → $CMDV (agente 4d3513a6…)"
```
- **Lo que queda en la base del agente nuevo no se borra:** los campos extra son informativos y el agente viejo no los
  pisa. La foto de pedidos abiertos vuelve a la clave vieja en el primer ciclo.
- **El cursor** lo calcula la base: el agente viejo arranca desde el corte guardado, como en el pase del 09-nov.
- Después, 5.1 y 5.4 con el agente viejo.

## 7. Criterios de parada → vuelta atrás (§6)
- La tarea no queda `Running`, o el cursor no late en 3 minutos, o late con `last_error`.
- 5.4: una factura cambia de líneas o de suma entre dos lecturas sin que haya cambiado en el PoS, o la primera factura
  no coincide con su tiquete.
- Edge con `invalid > 0` o `401`.
- 5.2: alguna **C** sin `mesa_factura`, o ninguna con `consecutivo_fe` **después de un cierre de caja**. No es parada
  inmediata, pero se avisa.

## 8. Después del pase
- **ESTADO.md:** el agente de prod pasa a `5da233a` (carpeta `C:\satori\agente-prod-5da233a`, tarea → `.cmd` nuevo).
- **La carpeta vieja** (`C:\satori\satori-app-prod`) y el `.cmd` viejo se quedan **7 días** como vuelta atrás. Después,
  el dueño decide si se borran.
- **Opcional, con firma aparte:** el replay (`npm.cmd run pos:backfill`, desde la carpeta nueva) de los últimos días, para
  llenar `mesa_factura` y `consecutivo_fe` en facturas viejas. No hace falta para el piloto.
- **Nosara:** su agente, su secreto en el mapa y el script que conserve el secreto de cada local al rotar. Va aparte.

## 9. Firma y bitácora
| Paso | Esperado | Obtenido |
|---|---|---|
| Firma del dueño (fecha y hora `-06:00`, SHA de la cabeza del PR) | | 10-nov: firma del dueño sobre el PR #83 @ `a5a3104` (agente `5da233a`); el texto está en su conversación con Claude, fuera del repo. Restaurante cerrado |
| Responsables (ejecución / control) | | el dueño, en la PC del PoS / la encargada |
| 0.3 ensayo en staging con `5da233a` (fechas, un cierre de caja, 5.1–5.4 contra staging) | latido sin error · claves con fecha · campos nuevos en las C · cierre de caja con R→C | **Hecho (staging, solo lectura).** El agente de staging corre `5da233a` desde el **09-nov 16:01**. Cierre de caja de las **16:06:11**: 9 facturas pasaron de R a C. Cierre de las **23:07:08**: **32 facturas en C (112548–112583), 0 en R**; la **112548**, que a las 16:36 estaba en R, pasó a C. **Las 41 C del día traen `mesa_factura`, `consecutivo_fe` y `clave_fe`**; las **6 X** traen `mesa_factura` sin consecutivo (esperado). Claves de los pedidos abiertos con fecha (`pedido:2026-11-09:11`, 16:36). **Latido sin error** (23:19:40, cursor 112583). Revisiones del 09-nov a las 16:36 y a las 23:20 CR |
| 1.1 tarea → `pos-agente-prod.cmd` (md5) · agente `4d3513a6…` limpio | | ok: tarea → `C:\satori\pos-agente-prod.cmd`, md5 `71d7c1b0f875a817c563ea6e4ba05aea` · agente `4d3513a6` limpio · Running |
| 1.2 entorno de la cuenta: «leído de» entero, sin `INGEST_`/`POS_` | | ok: cuenta SYSTEM (S-1-5-18), sin `INGEST_`/`POS_`; leído de máquina + `HKEY_USERS\S-1-5-18\Environment` |
| 1.3 cursor sano · campos nuevos en 0 · claves viejas | | cursor 112615, latiendo (40 s) sin error · cerradas en 24 h: 29, campos nuevos 0 · pedidos abiertos 0 (restaurante cerrado) |
| 2.1 carpeta nueva `5da233a5…` · árbol `5600ebbd…` · `npm.cmd ci` | | ok: `5da233a5`, árbol `5600ebbd`, `npm ci` en la raíz. **Faltó el `npm ci` dentro de `pos-bridge\`** (el paquete no lo pedía): ver el paso 3 |
| 2.2 `.env` copiados idénticos (cuáles) · firma agregada | | `pos-bridge\.env` copiado idéntico. **La firma `POS_AGENTE_PROD_FIRMADO` ya existía en el `.env` de prod (2026-10-28):** no se agregó otra (el bloque frenó por su guarda anti-duplicado). El camino «la firma ya viene» (corrección 10-nov del 2.2) **no está en el ensayo en seco del kit**, pero se ejecutó de hecho en prod el 10-nov: lectura de la firma 2026-10-28 y 2.3 con el candado OK |
| 2.3 mismo archivo que manda y mismo largo (64) · candado OK | | ok: mismo archivo, largo 64; el candado pasa con la firma del 28-oct |
| 2.4 `.cmd` nuevo = viejo con la carpeta cambiada | | ok |
| 3 `HORA_CAMBIO` · segundos detenida | | **Primer intento (23:32): el agente nuevo no arrancó** (`LastTaskResult` 1). **Vuelta atrás §6 ok a las 23:33:24**; el agente viejo latió a los 44 s. Causa: faltaba `npm ci` dentro de `pos-bridge\` (`mssql` sin instalar). Se corrió ahí (`mssql` antes: no; después: sí). **Segundo intento: ok**, detenida 21 s, `HORA_CAMBIO` **2026-11-10 23:37:18 -06:00** |
| 4 latido · Edge sin `invalid` ni `401` | | dos latidos sin error (23:39:58 y 23:42:31); `last_factura` 112615 (sin ventas). **Logs del Edge:** no revisados el 10-nov; se revisan el 11-nov con las primeras facturas, junto con 5.2/5.4 |
| 5 +15 / +30 / +45 / +60 (5.1–5.4) | | **pendiente:** 5.2 y 5.4 el 11-nov, con las primeras facturas |
| Cierre de caja: 5.2 con consecutivo y clave FE en las que pasaron a C | | **pendiente:** el cierre de caja del 11-nov |
| Gate de CI en la cabeza del PR (o la aceptación explícita del dueño) | | aceptación del dueño en la firma, textual: «Acepto sin CI de pruebas en el PR (el repo no corre pruebas en PRs; el agente corre en staging desde el 09-nov).» |
| Cierre: pasa / vuelta atrás | | **el agente nuevo corre en prod desde el 10-nov 23:37:18.** El cierre queda **abierto** hasta 5.2/5.4 y el cierre de caja del 11-nov |
