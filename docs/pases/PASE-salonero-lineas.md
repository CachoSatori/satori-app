# ⛔ firma — PASE salonero por líneas · el puente acredita al mesero de las líneas cuando el pedido no lo trae

> Repo público: sin montos, nombres, rutas reales de datos, hosts ni secretos. Las verificaciones son conteos y huellas
> (md5). Mismo formato y mismos bloques que el [PASE D9](PASE-D9-descuento-linea-pos.md) y sus bloques de PowerShell
> (`docs/puente/PASE-D9-AGENTE-bloques.md`, rama `claude/puente-d9-agente-descuento`); acá van **adaptados**: si algo
> no coincide con lo que dice este archivo, **se para y se avisa**.

## 0. Qué pasa y qué no
- **Pasa:** el agente del PoS (`pos-bridge/`) pasa de `578f38c` (el del pase D9) a la cabeza firmada de este PR. Cuando
  el salonero del **pedido** falta (cuenta dividida: la factura no tiene pedido) o es un **cajero/sistema** (`111`,
  `222`, `388`, `002`, `01`, `02`) y las **líneas** (`FAC_FacturasDet.UsuarioRegistra`) con mesero son de **uno solo**,
  ese es el salonero: `salonero_login` = ese login y `registrado_por = 'salonero'`. Dos o más meseros en las líneas, o
  ninguno → sigue sin salonero (no se adivina). Si el pedido **ya** trae un salonero válido, no cambia nada.
- **Después**, un re-backfill del histórico (2024 → ayer) con el agente nuevo rellena `salonero_login` de las facturas
  viejas.
- **No pasa:** sin migraciones, sin desplegar Edge, sin tocar `main`, sin sagrados. Ninguna plata cambia: `total_crc`,
  `valor_servido_crc`, `iva_crc`, `servicio_crc`, `regalia_crc`, `descuento_crc`, `clase_ingreso`, `pax`, `turno`,
  `canal`, `cajero_login` y las líneas **no cambian**.
- **No incluye** guardar `salonero_origen` (`pedido` / `lineas`): viaja en el lote pero el Edge no lo guarda (pide una
  columna nueva en `pos_ndf_tickets`, migración aparte, §9). Hasta entonces, en la base no se distingue una factura
  acreditada por el pedido de una acreditada por las líneas.

## 1. Diagnóstico (17-nov, prod, solo lectura, 90 días, salón)
| Hecho | Número |
|---|---|
| Facturas de salón con `salonero_login` null | 374 de 1.760 (21 %) |
| … cuentas divididas (factura sin pedido; `consulta.ts` busca el pedido por número de factura y no lo encuentra) | 211 |
| … registradas por cajero (111/222) | 163 |
| … en las que TODAS las líneas no-cajero tienen un único `usuario_registra` | **202** |

Esperado tras el re-backfill: en esa ventana, `salon_90d_null` baja de ~374 a ~172 (el número exacto depende del corte).

## 2. SHA y huellas
- Rama `claude/puente-salonero-lineas`, base `claude/puente-item11-prod-v2` @ `578f38c` (la del agente de prod; `pos-bridge/`
  no está en `main`).
- La firma va sobre el **SHA de la cabeza del PR**, anotado en §10 al firmar. Ese SHA se pega en `$SHA` del preámbulo.
- Árboles del código a la fecha de este archivo (si el PR cambia después de la revisión, se recalculan al firmar):
  `pos-bridge` `acbef1f22003e9a7e2cfed7a96a88927354a8c7d` · `src/shared/ndf` `244b0d0530676e3da8c7fa0835ca901354671045`.
- Contra `578f38c` cambian solo 8 archivos: `pos-bridge/{README.md, backfill.ts, backfill.test.ts, consulta.ts,
  consulta.test.ts, consultaAgente.test.ts}` y `src/shared/ndf/{mapTicket.ts, mapTicket.test.ts}`.
- Agente de prod hoy: `578f38c` en `C:\satori\agente-d9` (su carpeta queda como vuelta atrás).

## 3. Responsables
- **Ejecución:** el dueño en la PC del PoS (carpeta nueva del agente + backfill). **Control:** otra persona (p. ej. la
  encargada) o una sesión de Claude que corre [`scripts/sql/salonero_lineas_humo.sql`](../../scripts/sql/salonero_lineas_humo.sql)
  y compara. No la misma persona.

## 4. Prerrequisitos
- [ ] PR revisado (`satori-revision-pr`) y gate verde; firma del dueño con el SHA.
- [ ] Pase D9 cerrado: la tarea corre `C:\satori\pos-agente-prod-d9.cmd` → `C:\satori\agente-d9` en `578f38c`.
- [ ] Latido del agente de prod al día y sin error (bloque 1 del SQL).
- [ ] **Ventana:** de mañana **antes de las 14:00 CR** o de **00:00 a 06:00**. Nunca de 14:00 a 24:00 (el personal usa
      la app). Los bloques A0 y B1 lo controlan solos: A0 no arranca después de las 13:50; B1 no empieza un mes que no
      termine antes de las 13:50 (o de las 05:50 si arrancó de madrugada).

## 5. Prueba antes de prod (bloque A4, sin enviar nada)
`--dry-run` de los últimos 7 días: por día imprime `salonero_por_lineas=N salonero_por_lineas_no_salon=M salonero_null=K`.
**Esperado:** `N` entre ~3 % y ~20 % de `tickets` (en 90 días de salón fue 202 de 1.760 ≈ 11 %); `K` = lo que queda sin
salonero. **Parar** si `N = 0` los 7 días o `N` > 30 % de las facturas. **`M` > 0** (facturas de delivery, llevar o barra
que ganan salonero): se sigue solo si Claude lo da por bueno (ver §8, riesgo del balde de cajeros).

## 6. Humo antes y después ([`scripts/sql/salonero_lineas_humo.sql`](../../scripts/sql/salonero_lineas_humo.sql), bloques 3–5)
`begin read only … rollback`, mismo corte antes y después: **corte CERRADO = dos días antes del pase, a las 00:00 −06:00**
(pase el 18-nov → `2026-11-16 00:00:00-06:00`). B1 lo fija en su progreso la primera vez y lo imprime (`CORTE_HUMO`).

**Por qué dos días y no «hoy»:** desde A5 el agente nuevo ya acredita por líneas todo lo que relee, y relee las últimas
**36 h** (`rangoLectura`): con A5 después de las 00:00 del día del pase, nada anterior a «pase − 2 días 00:00» lo puede
tocar el agente en vivo. Así, entre el humo antes y el después, lo único que mueve facturas anteriores al corte es B1, y
N (el conteo de B1) se toma **solo de los días anteriores al corte**. **A y B van el mismo día** (decisión del dueño,
18-nov de mañana, antes de las 14:00).

**Las huellas:**
- `h_facturas_sin_salonero` = md5 por factura de **todas** las columnas de `pos_ndf_tickets` salvo `id`, `ingested_at`,
  **`salonero_login`** y **`registrado_por`**. `registrado_por` se excluye también porque cambia JUNTO con
  `salonero_login` (una factura que gana salonero pasa de `cajero` / `sistema` / `sin_pedido` a `salonero`; sin eso la app
  no se la acredita). **Tiene que dar igual.**
- `h_lineas` = la **misma** definición que el humo del PASE D9 (código, cantidad, monto, familia, precio y banderas de
  cada línea). **Tiene que dar igual.**

| Campo | Antes | Después esperado |
|---|---|---|
| `facturas` · `lineas` | _(se anota)_ | **=** |
| `h_facturas_sin_salonero` | _(se anota)_ | **=** |
| `h_lineas` | _(se anota)_ | **=** |
| `salonero_null` | _(se anota)_ | **baja exactamente N** = Σ `salonero_por_lineas` de B1 en los días anteriores al corte (B1 lo imprime, sin duplicar meses) |
| `salonero_null_salon` · `salon_90d_null` | _(se anota)_ | **bajan** (en 90 días de salón, ~200 menos) |
| `incoherentes` (salonero no null con `registrado_por` ≠ salonero) | 0 | **0** |
| `registrado_por` | _(se anota)_ | `salonero` sube lo mismo que bajan `cajero` + `sistema` + `sin_pedido`; el total no cambia |
| Bloque 4, por login (solo en el chat, **no** en la bitácora) | _(se compara)_ | **ningún login baja**; los que suben suman lo que bajó `salonero_null` |

**Cambios esperados (fuera de las huellas):** `salonero_login`, `registrado_por`, `ingested_at` y los `id` de las líneas.
Cualquier otra diferencia es parada.

## 7. Orden y horario
**Ventana:** de mañana antes de las 14:00 CR (corte automático 13:50) o 00:00–06:00 (corte 05:50). **Parte A y parte B el
mismo día** (18-nov de mañana). Si B1 se corta por la hora, retoma solo en la ventana siguiente con el mismo
`CORTE_HUMO` (queda en el progreso) y N se sigue sumando sin duplicar.

0. Preámbulo + A0–A6 (abajo): carpeta nueva `C:\satori\agente-sal` con el SHA firmado, `.env` copiado idéntico,
   `npm ci` en la raíz **y** en `pos-bridge\`, pruebas, prueba en seco, cambio de la tarea, verificación.
1. Humo «antes» (§6) con `CORTE_HUMO` (dos días antes del pase, 00:00 −06:00).
2. B1: backfill por mes, del más nuevo al más viejo, `--pausa-ms 800`, hasta `2024-01-01`.
3. Humo «después» (mismo corte). Si una huella no coincide, bloque 5 antes y después para ver el mes.
4. Bitácora en §10.

## 8. Criterios de parada, riesgos y vuelta atrás
- **Parar** si cambia `h_facturas_sin_salonero`, `h_lineas`, `facturas` o `lineas`; si `salonero_null` **sube** o no
  baja lo que dice el log de B1; si `incoherentes` > 0; si algún login **baja** en el bloque 4; o si el agente deja de
  latir. No se improvisa: se avisa.
- **Riesgo · balde de cajeros:** «Cajeros» en Ventas = `registrado_por = 'cajero'` **y** `canal <> 'salon'`. Una factura
  de delivery/llevar/barra registrada por un cajero pero con líneas de un solo mesero pasa a ese mesero y sale del balde.
  A4 y B1 lo cuentan (`salonero_por_lineas_no_salon`). Si no es 0, el dueño decide si se acepta o si la regla se limita
  a salón (cambio de una línea, con PR aparte).
- **Riesgo · `MIN` del pedido:** con varios pedidos, el pedido acredita al login menor. **No se toca** en este pase (se
  mide aparte, decisión del dueño).
- **Vuelta atrás del agente:** A7 (la tarea vuelve a `C:\satori\agente-d9`, `578f38c`).
- **Vuelta atrás de los datos:** re-backfill del mismo rango desde `C:\satori\agente-d9` (`578f38c`): vuelve
  `salonero_login` a null y `registrado_por` a lo de antes. Sin SQL a mano.

## 9. Fuera de este pase (propuesto, con firma aparte)
- **Columna `pos_ndf_tickets.salonero_origen`** (`pedido` | `lineas` | null): migración aditiva + `pos_ndf_ingestar` +
  `normalizarTicket` + Edge (regla 2, ítem 11). Sin ella, la app no puede marcar «acreditado por líneas».
- **Mesas abiertas** (`pos_ndf_open`): siguen con el salonero del pedido. Ahí no hay líneas de factura todavía.

---

# Bloques de PowerShell

**Método (el del pase D9, por escritorio remoto):** pegar el bloque (sin las líneas de las tres comillas invertidas) en
el **Bloc de notas** → guardar como `C:\satori\paso.ps1` (*Tipo* «Todos los archivos», *Codificación* **UTF-8 con BOM**)
→ una vez por consola `Set-ExecutionPolicy -Scope Process Bypass -Force` → cargar con **punto y espacio**:
`. C:\satori\paso.ps1`. Windows PowerShell 5.1 (o 7) **como administrador**, no el ISE. Si un bloque termina en rojo,
**no se sigue**. Ningún bloque muestra, copia ni registra el `.env`.

## Valores fijos
| Qué | Valor |
|---|---|
| Agente de prod hoy (vuelta atrás) | `578f38c039ec232d3818c1182d69d7f78f55b371` en `C:\satori\agente-d9` · árbol `pos-bridge` `d14d603a0d2458af7a81025efef688a2dfc9fed0` |
| Agente nuevo | **SHA firmado (§10)** · árbol `pos-bridge` `acbef1f2…` · árbol `src/shared/ndf` `244b0d05…` (§2) |
| Script de medición del `.env` | `scripts/puente/armar_mapa_secretos.mjs` (blob `c1e56c3c…`, md5 LF `73c4d9d2…` / CRLF `fcb5f2df…`) |
| Carpeta nueva · `.cmd` nuevo | `C:\satori\agente-sal` · `C:\satori\pos-agente-prod-sal.cmd` |
| Carpeta de la vuelta atrás (config vieja, progreso y logs; **sin secretos**) | `C:\satori\sal-vuelta` |
| Pruebas del puente en la carpeta nueva | **496** (`pos-bridge` + `src/shared/ndf`) |

## Preámbulo (en cada consola nueva)
Igual al del pase D9, con otros valores y otro `Resumen-DryRun`. **Antes de guardarlo, pegar el SHA firmado en `$SHA`.**
```powershell
$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$TAREA = 'Satori PoS Bridge PROD'
$SHA = 'PEGAR-ACA-EL-SHA-FIRMADO'; $SHA_PROD = '578f38c039ec232d3818c1182d69d7f78f55b371'
if ($SHA -notmatch '^[0-9a-f]{40}$') { throw 'falta pegar el SHA firmado (40 caracteres) en $SHA' }
$ARBOL = 'acbef1f22003e9a7e2cfed7a96a88927354a8c7d'; $ARBOL_NDF = '244b0d0530676e3da8c7fa0835ca901354671045'
$RAMA = 'claude/puente-salonero-lineas'; $PRUEBAS = 496
$NUEVA = 'C:\satori\agente-sal'; $CMD_NUEVO = 'C:\satori\pos-agente-prod-sal.cmd'; $VUELTA = 'C:\satori\sal-vuelta'
$INV = [Globalization.CultureInfo]::InvariantCulture
function Ok([string]$que) { if ($LASTEXITCODE -ne 0) { throw "falló «$que» (código $LASTEXITCODE): NO SE SIGUE" } }
function Carpeta([string]$p) { if (-not [IO.Path]::IsPathRooted($p) -or -not (Test-Path -LiteralPath $p -PathType Container)) { throw "no es una carpeta absoluta existente: $p" }; (Resolve-Path -LiteralPath $p).Path }
function Archivo([string]$p) { if (-not [IO.Path]::IsPathRooted($p) -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "no es un archivo absoluto existente: $p" }; (Resolve-Path -LiteralPath $p).Path }
function Sin-Ansi([string]$t) { $t -replace "$([char]27)\[[0-9;]*[A-Za-z]", '' }
function Md5Bytes([string]$p) { (Get-FileHash -Algorithm MD5 -LiteralPath (Archivo $p)).Hash.ToLower() }
function Bajo([string]$base, [string]$rel) { foreach ($x in ($rel -split '[\\/]')) { if ($x) { $base = Join-Path $base $x } }; $base }
function Hoy-CR { [DateTime]::UtcNow.AddHours(-6) }
function Es-Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
# Ventana del pase: 00:00–13:50 CR. Devuelve la hora de corte de hoy (05:50 si es de madrugada, si no 13:50).
function Corte-Ventana {
  $a = Hoy-CR
  if ($a.Hour -lt 6) { return $a.Date.AddHours(5).AddMinutes(50) }
  $c = $a.Date.AddHours(13).AddMinutes(50)
  if ($a -ge $c) { throw "son las $($a.ToString('HH:mm', $INV)) CR: este pase solo corre de 00:00 a 13:50" }
  $c
}
function Leer-Tarea {
  $t = Get-ScheduledTask -TaskName $TAREA
  $acc = @($t.Actions); if ($acc.Count -ne 1) { throw "la tarea tiene $($acc.Count) acciones: se esperaba una" }
  $ex = ([string]$acc[0].Execute).Trim('"')
  if ($ex -notmatch '\.cmd$') { throw "la tarea corre «$ex» y no un .cmd: se para y se avisa" }
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
# La salida del backfill en seco → conteos de salonero (sin logins ni montos: el backfill nunca los imprime).
function Resumen-DryRun([string[]]$lineas) {
  $dias = @(); $tot = $null
  foreach ($l in $lineas) {
    $m = [regex]::Match($l, '(\d{4}-\d{2}-\d{2})\s+tickets=(\d+)\s.*?salonero_por_lineas=(\d+)\s+salonero_por_lineas_no_salon=(\d+)\s+salonero_null=(\d+)')
    if ($m.Success) { $dias += New-Object PSObject -Property ([ordered]@{ Dia = $m.Groups[1].Value; Tickets = [int]$m.Groups[2].Value
      PorLineas = [int]$m.Groups[3].Value; NoSalon = [int]$m.Groups[4].Value; Null = [int]$m.Groups[5].Value }) }
    $t = [regex]::Match($l, 'TOTAL\b.*?tickets=(\d+)\s+guardados=(\d+).*?errores=(\d+)')
    if ($t.Success) { $tot = $t }
  }
  if (-not $tot) { throw 'la salida no trae la línea TOTAL: el backfill no terminó' }
  $tk = [int]$tot.Groups[1].Value; $pl = 0; $ns = 0; $nu = 0
  foreach ($d in $dias) { $pl += $d.PorLineas; $ns += $d.NoSalon; $nu += $d.Null }
  New-Object PSObject -Property ([ordered]@{ Dias = $dias; Tickets = $tk; PorLineas = $pl; NoSalon = $ns; Null = $nu
    Guardados = [int]$tot.Groups[2].Value; Errores = [int]$tot.Groups[3].Value
    Pct = $(if ($tk) { [math]::Round(100.0 * $pl / $tk, 1) } else { 0 })
    EsDry = [bool](@($lineas | Where-Object { $_ -cmatch 'DRY-RUN: ' }).Count)
    Prod = [bool](@($lineas | Where-Object { $_ -match 'ingest=yiczgdti' }).Count) })
}
function Meses-Backfill([string]$desde, [string]$hasta) {
  $d = [datetime]::ParseExact($desde, 'yyyy-MM-dd', $INV); $h = [datetime]::ParseExact($hasta, 'yyyy-MM-dd', $INV)
  while ($h -ge $d) {
    $ini = New-Object DateTime($h.Year, $h.Month, 1); if ($ini -lt $d) { $ini = $d }
    New-Object PSObject -Property ([ordered]@{ Mes = $h.ToString('yyyy-MM', $INV); Desde = $ini.ToString('yyyy-MM-dd', $INV); Hasta = $h.ToString('yyyy-MM-dd', $INV) })
    $h = $ini.AddDays(-1)
  }
}
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
"preámbulo ok · PowerShell $($PSVersionTable.PSVersion) $($PSVersionTable.PSEdition) · SHA $($SHA.Substring(0, 8))…"
```
**Ve:** `preámbulo ok · PowerShell 5.1… · SHA xxxxxxxx…` (los 8 primeros del SHA firmado).

---

# Parte A · en la ventana (00:00–13:50 CR) · 25–35 min, la tarea queda detenida ~30 s

## A0 · Comprobaciones (solo lectura · 2 min)
```powershell
& {
if (-not (Es-Admin)) { throw 'la consola no es de administrador' }
$c = Corte-Ventana; $h = (Hoy-CR).ToString('HH:mm', $INV)
$v = node --version; Ok 'node'
if ($v -notmatch '^v(\d+)\.(\d+)' -or [int]$Matches[1] -lt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 18)) { throw "Node $v`: hace falta 22.18 o más" }
npm.cmd --version | Out-Null; Ok 'npm'
git --version | Out-Null; Ok 'git'
$T = Leer-Tarea
if ($T.Estado -ne 'Running') { throw "la tarea no está corriendo ($($T.Estado)): se para y se avisa" }
if ($T.Carpeta -ieq $NUEVA) { throw 'la tarea YA corre la carpeta nueva: A5 ya se hizo' }
$hh = git -C $T.Carpeta rev-parse HEAD; Ok 'rev-parse agente de hoy'
if ($hh -cne $SHA_PROD) { throw "el agente de hoy está en $hh y no en 578f38c…: se para y se avisa" }
$s = git -C $T.Carpeta status --porcelain --untracked-files=no; Ok 'status agente de hoy'; if ($s) { throw 'el agente de hoy tiene cambios' }
$n = @(Get-NodeDe $T.Carpeta $T.Cmd); if (-not $n.Count) { throw 'no se encuentra el node del agente de hoy' }
if (Backfill-Corriendo) { throw 'hay un backfill corriendo' }
if (Test-Path -LiteralPath $NUEVA) { throw "$NUEVA ya existe: revisarlo antes (no se pisa nada)" }
if (Test-Path -LiteralPath $VUELTA) { throw "$VUELTA ya existe: hay un cambio anterior sin cerrar" }
$i = Get-ScheduledTaskInfo -TaskName $TAREA
"A0 ok · $h CR (corte $($c.ToString('HH:mm', $INV))) · node $v · agente de hoy 578f38c… limpio · tarea Running (cuenta $($T.Cuenta), node $(@($n | ForEach-Object { $_.ProcessId }) -join ', ')) · resultado $($i.LastTaskResult)"
}
```
**Ve:** `A0 ok · … agente de hoy 578f38c… limpio · tarea Running …`.
**Control:** bloque 1 del SQL en prod (`yiczgdti…`): `hace` < 2 min de 10:00 a 02:00 (< 6 min de madrugada) y
`sin_error = true`. **Si no, se para.**

## A1 · Clon nuevo en el SHA exacto (con la tarea andando · 3–5 min)
```powershell
& {
if (Test-Path -LiteralPath $NUEVA) { throw "$NUEVA ya existe" }
git clone --no-checkout https://github.com/CachoSatori/satori-app.git $NUEVA; Ok 'clone'
$N = Carpeta $NUEVA
git -C $N fetch origin $RAMA claude/puente-item11-prod-v2; Ok 'fetch'
git -C $N checkout --detach $SHA; Ok 'checkout'
$h = git -C $N rev-parse HEAD; Ok 'rev-parse'; if ($h -cne $SHA) { throw 'la carpeta nueva no está en el SHA firmado' }
$a = git -C $N rev-parse 'HEAD:pos-bridge'; Ok 'árbol pos-bridge'; if ($a -cne $ARBOL) { throw 'pos-bridge no es el revisado' }
$b = git -C $N rev-parse 'HEAD:src/shared/ndf'; Ok 'árbol ndf'; if ($b -cne $ARBOL_NDF) { throw 'src/shared/ndf no es el revisado' }
$d = git -C $N diff --name-only $SHA_PROD $SHA -- pos-bridge src supabase package.json package-lock.json; Ok 'diff contra el agente de hoy'
$esp = 'pos-bridge/README.md,pos-bridge/backfill.test.ts,pos-bridge/backfill.ts,pos-bridge/consulta.test.ts,pos-bridge/consulta.ts,pos-bridge/consultaAgente.test.ts,src/shared/ndf/mapTicket.test.ts,src/shared/ndf/mapTicket.ts'
if ((@($d) -join ',') -cne $esp) { throw "contra 578f38c cambió otra cosa: $(@($d) -join ', ')" }
$s = git -C $N status --porcelain; Ok 'status'; if ($s) { throw 'el clon no está limpio' }
"A1 ok · $N en $($SHA.Substring(0, 8))… · árboles pos-bridge y ndf = los revisados · contra 578f38c solo cambian los 8 archivos"
}
```

## A2 · El `.env`, copiado sin mostrarlo (1 min · se puede repetir)
Idéntico al A2 del pase D9 (copia byte a byte, solo nombres de claves, medición con el parser del agente, candado de prod).
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
$REL = 'scripts/puente/armar_mapa_secretos.mjs'
$MED = Archivo (Bajo $N $REL)
$bDisco = git -C $N hash-object "--path=$REL" $MED; Ok 'hash-object del script'
$bRepo = git -C $N rev-parse "HEAD:$REL"; Ok 'rev-parse del script'
if ("$bDisco".Trim() -cne "$bRepo".Trim()) { throw 'armar_mapa_secretos.mjs: el contenido no es el del commit firmado (blob distinto)' }
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
  $ErrorActionPreference = 'Continue'
  $P = @(npx.cmd vitest run pos-bridge src/shared/ndf 2>&1 | ForEach-Object { Sin-Ansi ([string]$_) }); $c = $LASTEXITCODE
  $ErrorActionPreference = $eap
  $P | Select-Object -Last 6; $global:LASTEXITCODE = $c; Ok 'pruebas del puente'
} finally { $ErrorActionPreference = $eap; Pop-Location; $env:NO_COLOR = $nc; $env:FORCE_COLOR = $fc }
$txt = $P -join "`n"
$t = [regex]::Match($txt, 'Tests\s+(\d+)\s+passed')
if ($txt -match 'Tests\s+\d+\s+failed') { throw 'hay pruebas que fallan' }
if (-not $t.Success -or [int]$t.Groups[1].Value -ne $PRUEBAS) { throw "se esperaban $PRUEBAS pruebas en verde" }
"A3 ok · dependencias (raíz y pos-bridge) · mssql carga · typecheck ok · $PRUEBAS pruebas en verde"
}
```

## A4 · Prueba en seco: backfill de los últimos 7 días con `--dry-run` (2–3 min, no envía nada)
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
if (@($R.Dias).Count -eq 0) { throw 'PARADA: ningún día trae salonero_por_lineas (¿es el agente nuevo?)' }
$R.Dias | ForEach-Object { '{0}  tickets={1,4}  por_lineas={2,4}  no_salon={3,3}  null={4,4}' -f $_.Dia, $_.Tickets, $_.PorLineas, $_.NoSalon, $_.Null }
if ($R.PorLineas -eq 0) { throw 'PARADA: salonero_por_lineas = 0 en los 7 días' }
if ($R.Pct -gt 30) { throw "PARADA: salonero_por_lineas = $($R.Pct) % (> 30 %)" }
$aviso = ''
if ($R.Pct -lt 3 -or $R.Pct -gt 20) { $aviso += ' · AVISO: fuera de 3–20 %, Claude lo mira antes de A5' }
if ($R.NoSalon -gt 0) { $aviso += " · AVISO: $($R.NoSalon) fuera de salón (balde de cajeros, §8): Claude lo mira antes de A5" }
$est = [math]::Ceiling($seg / 7 * 1100 / 60 * 1.5)
"A4 ok · $DESDE … $HASTA · tickets $($R.Tickets) · por_lineas $($R.PorLineas) ($($R.Pct) %) · no_salon $($R.NoSalon) · null $($R.Null) · nada enviado$aviso · histórico estimado ~$est min"
}
```
**Ve:** una línea por día y `A4 ok · … por_lineas N (P %) · … nada enviado`. Esperado **3–20 %**.
**Parada:** 0 o más de 30 %. Con `AVISO`: se sigue solo si Claude lo da por bueno.

## A5 · Cambiar la tarea a la carpeta nueva (2 min · detenida ~30 s)
```powershell
& {
$c = Corte-Ventana
$T = Leer-Tarea; $N = Carpeta $NUEVA
if ($T.Carpeta -ieq $N) { throw 'la tarea ya corre la carpeta nueva' }
$h = git -C $N rev-parse HEAD; Ok 'rev-parse'; if ($h -cne $SHA) { throw 'la carpeta nueva no está en el SHA firmado' }
Push-Location (Carpeta (Bajo $N 'pos-bridge')); try { $m = node -e "import('mssql').then(() => console.log('si'), () => process.exit(1))"; Ok 'mssql' } finally { Pop-Location }
if (Backfill-Corriendo) { throw 'hay un backfill corriendo' }
if (Test-Path -LiteralPath $VUELTA) { throw "$VUELTA ya existe: hay un cambio anterior sin cerrar" }
if (Test-Path -LiteralPath $CMD_NUEVO) { throw "$CMD_NUEVO ya existe" }
New-Item -ItemType Directory -Path $VUELTA | Out-Null; $V = Carpeta $VUELTA
[IO.File]::WriteAllText((Join-Path $V 'tarea-antes.xml'), (Export-ScheduledTask -TaskName $TAREA), [Text.Encoding]::Unicode)
[IO.File]::WriteAllText((Join-Path $V 'tarea-antes.json'), ($T | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
$J = [IO.File]::ReadAllText((Join-Path $V 'tarea-antes.json')) | ConvertFrom-Json
if ($J.Execute -cne $T.Execute -or $J.Md5Cmd -cne $T.Md5Cmd) { throw 'la config vieja no quedó guardada bien' }
$lat = [Text.Encoding]::GetEncoding('ISO-8859-1')
$txtV = $lat.GetString([IO.File]::ReadAllBytes($T.Cmd))
$txtN = $txtV.Replace($T.CarpetaTexto, $N)
if ($txtN -ceq $txtV) { throw 'el .cmd de hoy no menciona su carpeta' }
if ($txtN.Replace($N, $T.CarpetaTexto) -cne $txtV) { throw 'el .cmd nuevo cambiaría algo más que la carpeta' }
[IO.File]::WriteAllBytes($CMD_NUEVO, $lat.GetBytes($txtN))
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

## A6 · Verificar latido y salonero en lo nuevo (5–10 min, y otra vez al cierre de caja)
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
**Control (Claude, prod, solo lectura):** SQL bloque 1 dos veces con 2 min de diferencia (late, `sin_error = true`) y
bloques 2 y 2b con `HORA_CAMBIO`: facturas nuevas, `salonero_null` y `registrado_por` (conteos, sin montos).
**Parada → A7:** no late en 3 min, late con error, o la primera factura cobrada no coincide con su tiquete (líneas y total).

## A7 · Vuelta atrás (2 min; la carpeta `agente-d9` está intacta)
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
Rename-Item -LiteralPath $V -NewName ('sal-vuelta-usada-' + (Hoy-CR).ToString('yyyyMMdd-HHmm', $INV))
"A7 ok · tarea → $($J.Execute) (578f38c…) · $(Get-Date -Format 'HH:mm:ss')"
}
```
Después, bloque 1 del SQL: late sin error. Las facturas que entraron con el agente nuevo se quedan con su salonero
(para devolverlas: re-backfill de esos días desde `agente-d9`, §8).

---

# Parte B · en la ventana (00:00–13:50 CR) · ≈ lo que estimó A4

Orden: **(1) humo antes** → **(2) B1** → **(3) humo después**. Si B1 se cortó por la hora: en la ventana siguiente,
humo antes, B1 otra vez (retoma solo) y humo después.

**(1) Humo antes (Claude, prod `yiczgdti…`, solo lectura):** bloques 3 y 4 del SQL con el corte = **`CORTE_HUMO`, dos días antes del
pase a las 00:00 −06:00** (el mismo antes y después, todas las ventanas). Se anotan en §10 (el bloque 4 solo en el chat).

## B1 · Re-backfill mes por mes, del más nuevo al más viejo (se corta solo)
Rango: de **ayer** hacia atrás hasta `2024-01-01`, un mes por corrida, con `--pausa-ms 800`. Antes de cada mes mira la
hora: si el mes que sigue no termina antes del corte (13:50, o 05:50 de madrugada), **para y dice dónde quedó**. El
progreso queda en `C:\satori\sal-vuelta\backfill-progreso.json`; el mismo bloque retoma solo. Reenviar un mes no duplica.
**N** sale de la salida de **esta** corrida de cada mes (no de los logs viejos): por mes se guarda en el progreso la suma
de `salonero_por_lineas` de sus días **anteriores a `CORTE_HUMO`**; si un mes se vuelve a correr, su valor se
**reemplaza**, no se suma. N = suma de los meses del progreso.
```powershell
& {
$N = Carpeta $NUEVA; $V = Carpeta $VUELTA; $T = Leer-Tarea
$CORTE = Corte-Ventana; $ahora = Hoy-CR
if ($T.Carpeta -ine $N -or $T.Estado -ne 'Running') { throw 'el agente en vivo no es el nuevo o no está corriendo' }
if (Backfill-Corriendo) { throw 'ya hay un backfill corriendo' }
$h = git -C $N rev-parse HEAD; Ok 'rev-parse'; if ($h -cne $SHA) { throw 'la carpeta nueva no está en el SHA firmado' }
$DESDE_MIN = '2024-01-01'
$PROG = Join-Path $V 'backfill-progreso.json'
$hasta = $ahora.Date.AddDays(-1).ToString('yyyy-MM-dd', $INV)
$CORTE_HUMO = $ahora.Date.AddDays(-2).ToString('yyyy-MM-dd', $INV)   # 1.ª corrida = día del pase: pase − 2 días
$NMES = @{}                                                            # mes → N de ese mes (se reemplaza, no se suma)
if (Test-Path -LiteralPath $PROG) {
  $pg = [IO.File]::ReadAllText($PROG) | ConvertFrom-Json; $hasta = [string]$pg.siguiente_hasta; $CORTE_HUMO = [string]$pg.corte_humo
  foreach ($pr in @($pg.n_por_mes.PSObject.Properties)) { $NMES[$pr.Name] = [int]$pr.Value }
  "retoma: falta $DESDE_MIN … $hasta · CORTE_HUMO $CORTE_HUMO (fijo desde la primera corrida)"
}
if ($CORTE_HUMO -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'el progreso no tiene corte_humo: se para y se avisa' }
if ($hasta -lt $DESDE_MIN) { 'B1: el histórico ya está completo. Nada que hacer.'; return }
$LOG = Join-Path $V ('backfill-' + $ahora.ToString('yyyy-MM-dd_HHmm', $INV) + '.log')
$dur = [TimeSpan]::FromMinutes(5); $hechos = @()
foreach ($m in @(Meses-Backfill $DESDE_MIN $hasta)) {
  if ((Hoy-CR) + $dur + [TimeSpan]::FromMinutes(1) -gt $CORTE) { "CORTE $($CORTE.ToString('HH:mm', $INV)): no se empieza $($m.Mes). Quedó pendiente $DESDE_MIN … $($m.Hasta): en la próxima ventana, humo antes y este mismo bloque."; break }
  if ((Get-ScheduledTask -TaskName $TAREA).State -ne 'Running' -or -not @(Get-NodeDe $N $T.Cmd).Count) { throw "PARADA: el agente en vivo dejó de correr. Quedó pendiente $DESDE_MIN … $($m.Hasta)" }
  $t0 = Hoy-CR
  $nc = $env:NO_COLOR; $fc = $env:FORCE_COLOR; $env:NO_COLOR = '1'; $env:FORCE_COLOR = '0'
  Push-Location $N; try {
    node --import ./pos-bridge/register.mjs pos-bridge/backfill.ts --desde $m.Desde --hasta $m.Hasta --pausa-ms 800 | Tee-Object -Variable SALM
    $cod = $LASTEXITCODE
    [IO.File]::AppendAllLines($LOG, [string[]]@($SALM | ForEach-Object { Sin-Ansi ([string]$_) }), (New-Object Text.UTF8Encoding($false)))
    if ($cod -ne 0) { throw "PARADA en $($m.Mes) (código $cod). Quedó pendiente $DESDE_MIN … $($m.Hasta): re-correr este bloque (reenviar no duplica)" }
  } finally { Pop-Location; $env:NO_COLOR = $nc; $env:FORCE_COLOR = $fc }
  # N de ESTE mes, solo de la salida de esta corrida y solo de días anteriores al corte del humo.
  $nm = 0
  foreach ($l in @($SALM | ForEach-Object { Sin-Ansi ([string]$_) })) {
    $x = [regex]::Match($l, '(\d{4}-\d{2}-\d{2})\s+tickets=\d+\s+guardados=\d+.*?salonero_por_lineas=(\d+)')
    if ($x.Success -and $x.Groups[1].Value -lt $CORTE_HUMO) { $nm += [int]$x.Groups[2].Value }
  }
  $NMES[$m.Mes] = $nm
  $dur = (Hoy-CR) - $t0; $hechos += $m.Mes
  $sig = ([datetime]::ParseExact($m.Desde, 'yyyy-MM-dd', $INV)).AddDays(-1).ToString('yyyy-MM-dd', $INV)
  $js = (New-Object PSObject -Property ([ordered]@{ ultimo_mes_hecho = $m.Mes; siguiente_hasta = $sig; desde_min = $DESDE_MIN
    corte_humo = $CORTE_HUMO; n_por_mes = $NMES; hora_cr = (Hoy-CR).ToString('yyyy-MM-dd HH:mm', $INV) })) | ConvertTo-Json
  [IO.File]::WriteAllText("$PROG.tmp", $js, (New-Object Text.UTF8Encoding($false))); Move-Item -LiteralPath "$PROG.tmp" -Destination $PROG -Force
  "── $($m.Mes) ok en $([math]::Round($dur.TotalMinutes, 1)) min · salonero_por_lineas (antes del corte) $nm · siguiente: $sig"
}
$pg = [IO.File]::ReadAllText((Archivo $PROG)) | ConvertFrom-Json
$pl = 0; foreach ($pr in @($pg.n_por_mes.PSObject.Properties)) { $pl += [int]$pr.Value }
$fin = if ([string]$pg.siguiente_hasta -lt $DESDE_MIN) { 'HISTÓRICO COMPLETO' } else { "falta $DESDE_MIN … $($pg.siguiente_hasta) (sigue en la próxima ventana)" }
"B1 · meses hechos: $($hechos.Count) ($($hechos -join ', ')) · $fin · CORTE_HUMO $CORTE_HUMO 00:00 -06:00 · N = $pl · log $LOG"
}
```
**Ve:** por cada mes, las líneas del backfill (`tickets=… guardados=… líneas=… salonero_por_lineas=…`) y
`── AAAA-MM ok en N min`. Al final `B1 · … CORTE_HUMO … · N = …`: **se le pasan el corte y N a Claude**.
**Parada (el bloque para solo):** un mes con error o el agente en vivo que deja de correr. **A ojo:** `inválidos=` o
`guardados` menor que `tickets` → cerrar la ventana de PowerShell con la X (reenviar no duplica) y avisar.

**(3) Humo después (Claude, mismo corte):** bloques 3, 4 y 5. Regla de §6: `facturas`, `lineas`,
`h_facturas_sin_salonero` y `h_lineas` **iguales**; `salonero_null` baja **exactamente N** (el N final de B1, que ya no
duplica meses); `incoherentes = 0`; ningún login baja. Con el histórico a medias, las huellas tienen que
dar igual igual. Si una no coincide, bloque 5 antes y después, y se para.

---

## 10. Firma y bitácora
- Firma del dueño: _pendiente_ (SHA: ______, fecha y hora −06:00).
- Bitácora: _pendiente_.

| Paso | Esperado | Obtenido |
|---|---|---|
| A0 · hora · agente de hoy · latido | `578f38c…` limpio · Running · late sin error | |
| A1 · clon | SHA firmado · árboles revisados · 8 archivos | |
| A2 · `.env` | idénticos · ninguna clave falta · candado ok | |
| A3 · pruebas | `mssql` carga · typecheck ok · 496 en verde | |
| A4 · en seco (7 días) | `salonero_por_lineas` 3–20 % · nada enviado · `no_salon` mirado | |
| A5 · `HORA_CAMBIO` | `-06:00` · ~30 s detenido | |
| A6 · latido ×2 · facturas nuevas | late sin error | |
| B · humo antes (`CORTE_HUMO` = pase − 2 días, 00:00) | se anotan `facturas`, `lineas`, huellas, `salonero_null`, `registrado_por` | |
| B1 · meses | histórico completo · errores 0 · `CORTE_HUMO` y N del progreso | |
| B · humo después | huellas iguales · `salonero_null` baja N · `incoherentes` 0 · ningún login baja | |
