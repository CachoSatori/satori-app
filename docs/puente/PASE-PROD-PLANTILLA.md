# Pase a PROD del puente del PoS · PLANTILLA para el próximo pase (agente nuevo / Nosara)

> **Qué es este archivo.** Es el paquete que se ejecutó en el pase del **09-nov-2026**
> (`PASE-PROD-2026-11-09.md`, rama `claude/puente-item11-prod-v2` @ `cd6d5a1`), **corregido con lo que vio el pase
> real**. El resultado y los desvíos están en [`RESULTADO-PASE-2026-11-09.md`](RESULTADO-PASE-2026-11-09.md).
>
> **Los SHA, md5 y valores de esta plantilla son los del 09-nov.** Para el próximo pase se arma un paquete nuevo desde
> esta plantilla:
> - se cambian el alcance (agente nuevo, Nosara), los SHA y los md5;
> - se repite el ensayo en seco (`scripts/puente/ensayo_seco_paquete.ps1`) con 0 FAIL en PowerShell 5.1 y 7;
> - lo firma el dueño.
>
> **Esta plantilla no se ejecuta tal cual.** Las secciones de abajo conservan el texto del 09-nov («reprogramado»,
> firmas, resultados de staging) como referencia.
>
> **Correcciones del 09-nov** (marcadas «corrección 09-nov» en el texto):
> 1. **Scripts del pase:** salen del **commit del paquete**, con `git show` y md5 sobre los bytes, a
>    `C:\satori\pase-scripts` (bloque 0.5b). Nunca del clon del código.
> 2. **1.9:** si la acción de la tarea es un `.cmd` o `.bat`, el control **lo lee**.
> 3. **`npm.cmd`**, no `npm`: la política de ejecución de PowerShell bloquea `npm.ps1`.
> 4. **`--use-api`** en la descarga (1.7), el deploy (4.4) y el rollback (§8.2): la PC no tiene Docker.
> 5. **1.7:** la descarga es **parcial a propósito** (solo `index.ts`).
> 6. **0.6:** Supabase CLI fijo, con carpeta, versión y sha256.
> 7. **4.4:** la versión del Edge tiene que ser **mayor** que la de 1.6, no «una más».
> 8. **Tiempo con la tarea detenida:** todo lo preparable va antes de 4.1.
>
> **Correcciones de la auditoría v3 de Grok** (09-nov tarde; marcadas «Grok 120» y «Grok 121» en el texto):
> 9. **120:** el pase **no rota secretos**. Un secreto del agente de menos de 32 es **PARADA limpia** en 1.9, y 4.3b
>    ya no existe. La rotación es un procedimiento aparte, ensayado en staging y hecho **antes** del pase:
>    [`ROTACION-SECRETO-AGENTE.md`](ROTACION-SECRETO-AGENTE.md).
> 10. **121:** el control 1.9 del entorno de la cuenta de la tarea lee bien SYSTEM, las cuentas de servicio y los
>     usuarios sin perfil cargado (monta su `NTUSER.DAT` y lo desmonta), y dice **qué leyó y de dónde**. Si no puede
>     leer, es PARADA.

## Qué pasa y qué no
- **Pasa:** la mig **081** (columnas nuevas, aditivas), la mig **082 v3** (función `pos_ndf_ingestar` en una transacción
  por local, con el cursor calculado por la base, «corte seguro», más la columna `pos_ndf_cursor.max_factura_vista`, que
  acepta vacío) y el Edge **`ingest-ndf`** de `5da233a…`.
  - **082 v3 (Grok 113):** un lote vacío sin `last_factura` (el aviso de error del PoS del agente, o un ciclo sin nada)
    **no recalcula** el corte: solo escribe el latido y el error. Y la menor `R` sale del lote **y** de las `R` guardadas
    del local en las últimas 36 h. Cubre la `R` que cierra entre las dos lecturas del agente y el reinicio después de un
    error del PoS.
  - **Edge:** el de `e4678b3` más **una línea de log** (`corte retenido por la R …`) y comentarios corregidos (Grok 113 y
    117). Sigue devolviendo al agente el cursor que le da la base.
- **No pasa:** el **código** del agente del PoS (sigue `4d3513a6df8e838dd5c0442b05a580e06ce9db9d`), la 085, nada del Club.
- **Del agente se toca solo esto:** su tarea «Satori PoS Bridge PROD» se **detiene** antes de cambiar la base y el Edge,
  y se **inicia** después (§4). **Su `.env` no se toca en el pase** (Grok 120): un secreto corto es parada (1.9) y se rota
  antes, con el procedimiento aparte. Nada de checkout, pull ni deploy en `C:\satori\satori-app-prod`.

## SHA y huellas (completos; se comparan enteros)
| Qué | Valor |
|---|---|
| Código del pase (rama `claude/puente-item11-prod-v2`): `e4678b3` + la 082 v3 + el log del Edge | `5da233a516d1a6c4c2c95eb165be448be5416697` |
| Base del Edge | `e4678b395647d079863f8b7975c5935fd6cadcb5` |
| Agente de prod (no cambia) | `4d3513a6df8e838dd5c0442b05a580e06ce9db9d` |
| Origen de los dos `.sql` = PR de sincronía #71 (cabeza) | `0a33df42514250509fef82af313fa576dd90aa39` |
| md5 `081_pos_ndf_campos_factura.sql` | `d4acf8dafc964ed23072aa49098f5b42` |
| md5 `082_pos_ndf_ingesta_transaccional.sql` (v3) | `edb7ffc58976804e55968f75df530a05` |
| `081_rollback.sql` (rama del Club, **por SHA**, no por rama) | `377081fec51c2967b02a446385edc68543de7675` · md5 `5faa677d99f68c9c16dbd3a8a1c804d0` |
| md5 de `prosrc` de `pos_ndf_ingestar` con la v3 (el de staging) | `dab8ffdf8d2f82dacf874af22eb6f55d` |

Controles de que el código es ese (los corre el bloque 0.4): contra `e4678b3…`, en `supabase` y `src` cambian
**exactamente** estos cinco archivos: la 082, el `index.ts` y el `README.md` del Edge, y `src/shared/ndf/ingestNdf.ts` y
su prueba (solo comentarios: `fusionarCursor` marcada como legado). Los commits de la rama posteriores a `5da233a…` no
tocan `supabase` ni `src` (el diff contra la rama es vacío).

## Responsables (dos, por rol; anotar quién en §10)
- **Ejecución — el dueño.** Corre los pasos en la PC del PoS y en el panel/editor de PROD, y firma.
- **Control — el encargado del turno (manager).** Mira el PoS y la app, elige las facturas del cuadre, lee en voz alta
  cada resultado esperado contra el obtenido y firma la bitácora. **No es la misma persona.**
- **Claude no corre nada en prod** (ni consultas, ni deploys, ni el merge del #71). Prepara, dicta y revisa los
  resultados que le leen. No ve ningún secreto.

## Consola: fail-stop (Grok 102). PowerShell 5.1, nada de bash
**Qué PowerShell se usa el día del pase:** el **Windows PowerShell 5.1** de la PC del PoS (el que trae Windows; es con
el que corre el agente). Los bloques pasaron el ensayo en seco en 5.1 **y** en 7 (§9), así que si la PC tiene PowerShell 7
también sirve, pero el día se usa **una sola** para todo el pase, la misma en todas las consolas. Antes de empezar, en
cada consola:
```powershell
$PSVersionTable.PSVersion.ToString(); $PSVersionTable.PSEdition      # 5.1.x y Desktop (o 7.x y Core): anotarlo en §10
```
Si da otra cosa (por ejemplo 2.0 o 3.0), **se para**: esa versión no se ensayó.

Dos carpetas que nunca se confunden: **`C:\satori\satori-app-prod`** (el agente: solo se lee, salvo su tarea) y
**`C:\satori\pase-v2`** (clon aparte para el pase). Al abrir **cada** consola, antes de cualquier otra cosa:
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
- **Cada comando nativo** (`git`, `supabase`, `node`, `npm.cmd`, `curl.exe`, `cmd /c`) va seguido **en la misma línea** de
  `; Ok '<qué>'`: un nativo que falla no corta PowerShell por sí solo. No se redirige su stderr (nada de `2>&1`).
- Toda ruta es **absoluta** y pasa por `Carpeta`/`Archivo` antes de usarse.
- Un bloque que tira error **no deja nada a medias**: los scripts escriben a un temporal y renombran al final. Si un
  bloque corta, **no se sigue** con el siguiente: se para y se avisa.

---

## Índice
0. Prerrequisitos · 1. Lecturas · 2. Mig 081 · 3. Secretos por local · 4. El cambio (drenar escritores, 082, Edge,
arrancar) · 5. Prueba de humo · 6. Primera hora, control del cursor y conciliación · 7. Criterios de parada ·
8. Rollback · 9. Después · 10. Firma y bitácora · Anexo A. Correcciones a mano (nada listo para pegar)

**Tiempos** (suma real), por sección:

| Sección | Tiempo |
|---|---|
| 0 · Prerrequisitos | 15 min |
| 1 · Lecturas | 15 min |
| 2 · Mig 081 | 5 min |
| 3 · Secretos por local | 10 min |
| 4 · El cambio (agente detenido **≤ 15 min**) | 15 min |
| 5 · Prueba de humo | 10 a 30 min |
| 6 · Primera hora (60 de controles + 10 de conciliación) | 70 min |
| Cierre | 5 min |
| 9 · #71 | 10 min |
| **Total** | **2 h 35 a 2 h 55** |

## 0. Prerrequisitos
| # | Qué | Cómo se verifica |
|---|---|---|
| 0.1 | **GO de Grok** sobre este paquete (con el SHA de la rama) y firma del dueño en §10 | informe y firma |
| 0.2 | Los dos responsables presentes | nombres en §10 |
| 0.3 | Ventana de mañana, **nunca 17:00–23:00** | hora en §10 |
| 0.4 | Clon aparte en el SHA del código (P1), con los controles de arriba. **Nunca en `C:\satori\satori-app-prod`** | bloque **0.4** |
| 0.5 | Los dos `.sql` con `cmd /c "git show …"` (P2: ni el `>` de PowerShell, que escribe UTF-16, ni el árbol de trabajo, que Git for Windows puede dejar con CRLF), md5 **sobre los bytes** | bloque **0.5** |
| 0.6 | **Supabase CLI 2.122.0 instalado ANTES del día** en `C:\satori\supabase-cli` (corrección 09-nov: la PC no lo tenía). sha256 del `.tar.gz` del 09-nov: `f891d9bb641f7fa28fd9c61ea0f31be4964254bc84be9ff66f2376b6aaa7a9ed` (si es otra versión: se ensaya en staging y se anota su sha256). Con acceso a prod; Node del agente | bloque **0.6** · `supabase projects list; Ok 'proyectos'` (muestra `yiczgdtirrkdvohdquzf`) · `node --version; Ok 'node'` |
| 0.7 | Staging en verde con este mismo código (§9, «Qué se probó») | anotado |
| 0.8 | AnyDesk a la PC del PoS; el agente de prod intacto | bloque **0.8** (se repite al cierre) |
| 0.9 | **`main` congelado** (A1) hasta el #71 y «All migrations are up to date», o la salida de §8.6 | avisado; §10 |

**Bloque 0.4** (P1):
```powershell
New-Item -ItemType Directory -Force C:\satori | Out-Null
if (Test-Path -LiteralPath C:\satori\pase-v2) { throw 'C:\satori\pase-v2 ya existe: revisarlo o borrarlo antes' }
git clone https://github.com/CachoSatori/satori-app.git C:\satori\pase-v2; Ok 'clone'
$CLON = Carpeta C:\satori\pase-v2
git -C $CLON fetch origin claude/puente-item11-prod-v2 claude/sync-ledger-081-082 claude/epic-tesla-pyo77m; Ok 'fetch'
git -C $CLON checkout --detach 5da233a516d1a6c4c2c95eb165be448be5416697; Ok 'checkout'
$h = git -C $CLON rev-parse HEAD; Ok 'rev-parse'
if ($h -cne '5da233a516d1a6c4c2c95eb165be448be5416697') { throw 'el clon no está en el SHA del pase' }
$s = git -C $CLON status --porcelain; Ok 'status'; if ($s) { throw 'el clon no está limpio' }
$d = git -C $CLON diff --name-only e4678b395647d079863f8b7975c5935fd6cadcb5 5da233a516d1a6c4c2c95eb165be448be5416697 -- supabase src; Ok 'diff código'
$esperado = 'src/shared/ndf/ingestNdf.test.ts,src/shared/ndf/ingestNdf.ts,supabase/functions/ingest-ndf/README.md,supabase/functions/ingest-ndf/index.ts,supabase/migrations/082_pos_ndf_ingesta_transaccional.sql'
if ((@($d) -join ',') -cne $esperado) { throw "contra e4678b3 cambió otra cosa: $d" }
$d = git -C $CLON diff 5da233a516d1a6c4c2c95eb165be448be5416697 origin/claude/puente-item11-prod-v2 -- supabase src; Ok 'diff rama'
if ($d) { throw 'la rama cambió código después del SHA fijado' }
git -C $CLON worktree add C:\satori\ingest-ndf-v1 4d3513a6df8e838dd5c0442b05a580e06ce9db9d; Ok 'worktree'   # vuelta atrás (§8)
$h = git -C (Carpeta C:\satori\ingest-ndf-v1) rev-parse HEAD; Ok 'rev-parse v1'
if ($h -cne '4d3513a6df8e838dd5c0442b05a580e06ce9db9d') { throw 'worktree de vuelta mal' }
"0.4 ok"
```

**Bloque 0.5** (P2 y 102: md5 sobre los bytes, **antes** de que nada los lea como texto):
```powershell
$CLON = Carpeta C:\satori\pase-v2
New-Item -ItemType Directory -Force C:\satori\pase-sql | Out-Null; $SQL = Carpeta C:\satori\pase-sql
Get-ChildItem -LiteralPath $SQL -File | Remove-Item -Force       # nada viejo: lo que quede es de esta corrida
$S = '0a33df42514250509fef82af313fa576dd90aa39'
cmd /c "git -C `"$CLON`" show ${S}:supabase/migrations/081_pos_ndf_campos_factura.sql > `"$SQL\081.sql`""; Ok 'show 081'
cmd /c "git -C `"$CLON`" show ${S}:supabase/migrations/082_pos_ndf_ingesta_transaccional.sql > `"$SQL\082.sql`""; Ok 'show 082'
cmd /c "git -C `"$CLON`" show 5da233a516d1a6c4c2c95eb165be448be5416697:supabase/migrations/082_pos_ndf_ingesta_transaccional.sql > `"$SQL\082_codigo.sql`""; Ok 'show 082 código'
cmd /c "git -C `"$CLON`" show 377081fec51c2967b02a446385edc68543de7675:scripts/sql/081_rollback.sql > `"$SQL\081_rollback.sql`""; Ok 'show rollback'   # por SHA (119)
if ((Md5Bytes "$SQL\081.sql") -cne 'd4acf8dafc964ed23072aa49098f5b42') { throw '081: md5 distinto' }
if ((Md5Bytes "$SQL\082.sql") -cne 'edb7ffc58976804e55968f75df530a05') { throw '082: md5 distinto' }
if ((Md5Bytes "$SQL\082_codigo.sql") -cne 'edb7ffc58976804e55968f75df530a05') { throw 'la 082 del código no es la del #71' }
if ((Md5Bytes "$SQL\081_rollback.sql") -cne '5faa677d99f68c9c16dbd3a8a1c804d0') { throw '081_rollback: md5 distinto' }
"0.5 ok"
```

**Bloque 0.5b** (corrección 09-nov). **Los scripts del pase salen del commit del PAQUETE**, no del clon del código. El
09-nov el clon estaba en el código (`5da233a`), y ahí `armar_mapa_secretos.mjs` no tenía `--solo-medir`.
- Van a `C:\satori\pase-scripts` con `git show`, y el md5 se compara sobre los bytes.
- Además se verifica que entre el código y el paquete **no cambia nada** en `supabase/` ni en `src/`.
```powershell
$CLON = Carpeta C:\satori\pase-v2
New-Item -ItemType Directory -Force C:\satori\pase-scripts | Out-Null; $SCR = Carpeta C:\satori\pase-scripts
Get-ChildItem -LiteralPath $SCR -File | Remove-Item -Force      # nada viejo
$PAQ = 'cd6d5a1ceb7adf06a0f79b780f126a4263884ca3'               # commit del PAQUETE (el del 09-nov; se cambia al armar el próximo)
git -C $CLON cat-file -e "${PAQ}^{commit}"; Ok 'commit del paquete'
$d = git -C $CLON diff --name-only 5da233a516d1a6c4c2c95eb165be448be5416697 $PAQ -- supabase src; Ok 'diff código-paquete'
if ($d) { throw "entre el código y el paquete cambió código: $d" }
cmd /c "git -C `"$CLON`" show ${PAQ}:scripts/puente/armar_mapa_secretos.mjs > `"$SCR\armar_mapa_secretos.mjs`""; Ok 'show armar_mapa'
if ((Md5Bytes "$SCR\armar_mapa_secretos.mjs") -cne '73c4d9d207c22c13d5c42498bb63e8ca') { throw 'armar_mapa_secretos.mjs: md5 distinto' }
"0.5b ok · scripts del paquete $($PAQ.Substring(0,7)) en $SCR"
```

**Bloque 0.6** (corrección 09-nov: el CLI fijo):
```powershell
$v = supabase --version; Ok 'cli'
if (("$v").Trim() -cne '2.122.0') { throw "Supabase CLI ${v}: se esperaba 2.122.0 (la ensayada)" }
"0.6 ok · Supabase CLI $v"
```

**Bloque 0.8** (el agente de prod, intacto):
```powershell
$AG = Carpeta C:\satori\satori-app-prod
$h = git -C $AG rev-parse HEAD; Ok 'rev-parse agente'
if ($h -cne '4d3513a6df8e838dd5c0442b05a580e06ce9db9d') { throw 'el agente de prod no está en 4d3513a6…' }
$s = git -C $AG status --porcelain --untracked-files=no; Ok 'status agente'; if ($s) { throw 'el agente de prod tiene cambios' }
(Get-ScheduledTask -TaskName 'Satori PoS Bridge PROD').State      # Running
```

## 1. Lecturas previas (SOLO LECTURA, en PROD)
Editor SQL de PROD. **Leer el ref en pantalla: `yiczgdtirrkdvohdquzf`.** Anotar cada resultado en §10.
```sql
-- 1.1 ledger: el último tiene que ser 080
select count(*), max(version) from supabase_migrations.schema_migrations;
select version from supabase_migrations.schema_migrations where version in ('081','082','085');          -- 0 filas
-- 1.2 la función y la columna nuevas no existen
select to_regprocedure('public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)');                    -- null
select count(*) from information_schema.columns where table_schema = 'public'
   and table_name = 'pos_ndf_cursor' and column_name = 'max_factura_vista';                              -- 0
-- 1.3 la 082 escribe usuario_registra (mig 066)
select count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'pos_ndf_ticket_lines' and column_name = 'usuario_registra';  -- 1
-- 1.4 el agente de hoy está sano
select local, last_factura, last_fecha_registra, last_poll_at, now() - last_poll_at as hace, last_error
  from public.pos_ndf_cursor;                                                -- hace < 5 min en operación; last_error null
-- 1.5 foto de líneas de las últimas facturas (para §5.3)
select t.numero_factura, t.estado, t.total_crc, count(l.*) as lineas, coalesce(sum(l.monto), 0) as suma_lineas
  from public.pos_ndf_tickets t left join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
 where t.local = 'santa-teresa' group by t.id order by t.fecha_registra desc limit 20;
```
**1.6 Edge desplegado:** panel → `ingest-ndf`. Referencia del 08-nov: **v1**, «Enforce JWT verification» apagado,
27-oct 06:31 UTC. **Es el punto de vuelta.**

**1.7 Copia del Edge de hoy** (sin esto **no se sigue**):
```powershell
New-Item -ItemType Directory -Force C:\satori\edge-prod-v1 | Out-Null; $E = Carpeta C:\satori\edge-prod-v1
Push-Location $E; try { supabase functions download ingest-ndf --use-api --project-ref yiczgdtirrkdvohdquzf; $codDescarga = $LASTEXITCODE } finally { Pop-Location }
# corrección 09-nov: con --use-api el CLI baja SOLO el index.ts y avisa «refusing to extract outside supabase/functions»
# por src/shared (el Edge importa código de src/). Es esperado: la copia es PARCIAL. El punto de vuelta completo es el
# worktree de 4d3513a (0.4). El código de salida se anota; lo que manda es que el index.ts esté y coincida.
cmd /c "git -C `"C:\satori\pase-v2`" show 4d3513a6df8e838dd5c0442b05a580e06ce9db9d:supabase/functions/ingest-ndf/index.ts > `"$E\index_4d3513a.ts`""; Ok 'show v1'
$b = @(Get-ChildItem -LiteralPath $E -Recurse -Filter index.ts | Where-Object FullName -like '*ingest-ndf*')
if ($b.Count -ne 1) { throw "se esperaba un index.ts descargado y hay $($b.Count)" }
if ((Md5Bytes $b[0].FullName) -cne (Md5Bytes "$E\index_4d3513a.ts")) { throw 'el index.ts de prod no es el de 4d3513a6…' }
"1.7 ok · index.ts = 4d3513a6… · copia PARCIAL (solo index.ts) · código del CLI $codDescarga (anotar)"
```

**1.8 Secretos (solo nombres y huellas):** `supabase secrets list --project-ref yiczgdtirrkdvohdquzf -o json; Ok 'secrets'` →
existe `POS_INGEST_SECRET`; **no** existe `POS_INGEST_SECRETS`; la lista muestra la **huella** de cada uno (si no, ver §3).

**1.9 El secreto efectivo del agente** (103 y 119). **Primero, el entorno de la cuenta de la tarea:** el agente toma sus
variables de entorno **por encima** del `.env` («`process.env` pisa todo», `pos-bridge/config.ts`). Si la cuenta con la
que corre la tarea tuviera alguna `INGEST_…` o `POS_…`, lo que se mide acá (como el usuario de la consola) no sería lo
que el agente manda. Solo nombres, nunca valores:
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
**Qué dice la última línea** (anotarla entera en §10): la cuenta y su SID, y de dónde se leyó cada entorno:
- **la máquina**, siempre;
- **la cuenta:**
  - «perfil cargado» (SYSTEM y las cuentas de servicio de Windows lo tienen siempre: el pase del 09-nov leyó
    `HKEY_USERS\S-1-5-18\Environment`);
  - o su `NTUSER.DAT`, montado y desmontado, si el perfil no estaba cargado;
  - o el del perfil Default, si la cuenta todavía no tiene perfil.

Montar un `NTUSER.DAT` pide **consola de administrador**; si no lo es, el bloque para con el motivo.

**Después, la medición**, con **el mismo parser del agente** y sin mostrar el valor. `--solo-medir` no arma el mapa ni
escribe nada:
```powershell
$AG = Carpeta C:\satori\satori-app-prod; $CLON = Carpeta C:\satori\pase-v2; $SCR = Carpeta C:\satori\pase-scripts   # scripts del paquete (0.5b)
$REG = 'file:///' + ((Archivo "$AG\pos-bridge\register.mjs") -replace '\\','/')
$m = node --import $REG (Archivo "$SCR\armar_mapa_secretos.mjs") --agente $AG --clon $CLON --solo-medir; Ok 'medir secreto'
$med = $m | ConvertFrom-Json
"1.9 manda $($med.archivo_que_manda) · largo $($med.largo_santa_teresa) · cumple 32: $($med.cumple_32)"
if (-not $med.cumple_32) { throw "PARADA 1.9 (Grok 120): el secreto del agente mide $($med.largo_santa_teresa), menos de 32. En el pase no se rota: se rota ANTES con docs/puente/ROTACION-SECRETO-AGENTE.md y el pase se reprograma" }
```
Anotar las tres cosas. **Un secreto corto es PARADA limpia** (Grok 120):
- no se toca nada y la tarea sigue andando;
- el secreto se rota otro día con [`ROTACION-SECRETO-AGENTE.md`](ROTACION-SECRETO-AGENTE.md), ensayado antes en
  staging;
- después se reprograma el pase.

**1.10 Corte, cursor y backlog por local** (104): la consulta **C** de §6.2, y en la PC el día según el PoS:
```powershell
Push-Location (Carpeta C:\satori\satori-app-prod); try { npm.cmd run pos:dia -- (Get-Date -Format 'yyyy-MM-dd') --sin-detalle; Ok 'pos:dia' } finally { Pop-Location }
```
Anotar en §10, por local: `last_factura`, `last_poll_at`, las `R` por categoría (§6.2) y, del PoS, las facturas por
estado y la venta total. Antes del cambio, una `R` bajo el corte no se toca (el agente de hoy rebobina solo).

**1.11 Formato de `numero_factura` (118, gate previo; SOLO LECTURA, en PROD).** La 082 v3 ordena el corte **como
número**: un folio no numérico se guarda, pero no entra en el orden. Antes del cambio se confirma que el PoS de hoy
numera solo con dígitos:
```sql
select count(*)                                                              as facturas_36h,
       count(*) filter (where numero_factura !~ '^[0-9]+$')                  as no_numericas_36h,   -- 0
       count(*) filter (where estado = 'R' and numero_factura !~ '^[0-9]+$') as r_no_numericas_36h, -- 0
       min(length(numero_factura)) as largo_min, max(length(numero_factura)) as largo_max,
       count(*) filter (where numero_factura ~ '^0')                         as con_ceros_adelante  -- se anota (no frena)
  from public.pos_ndf_tickets
 where local = 'santa-teresa' and fecha_registra >= now() - interval '36 hours';
select count(*) filter (where last_factura !~ '^[0-9]+$') as cursor_no_numerico                     -- 0
  from public.pos_ndf_cursor where local = 'santa-teresa';
```
Los ceros de adelante no molestan: el texto se guarda tal cual y se compara como número.

**Para (no se sigue)** si: el ledger no termina en 080 o ya tiene 081/082/085; la función o la columna ya existen; falta
`usuario_registra`; el cursor tiene `last_error` o no late; no hay copia del Edge; el Edge de prod no es la v1 o tiene
`verify_jwt` prendido; el agente no está en `4d3513a6…` o tiene cambios; 1.9 corta (la tarea no corre el agente de
`satori-app-prod`, hay variables `INGEST_`/`POS_` en la máquina o en la cuenta de la tarea, no se puede leer ese entorno,
o el agente no puede leer su configuración); **1.11** da algún folio o cursor **no numérico** (con la 082 v3 se ordena
como número: se para y se avisa); **un secreto corto** (1.9, Grok 120): se para, se rota antes con el procedimiento
aparte y se reprograma.

## 2. Mig 081 + su fila del ledger (UNA transacción; el agente sigue andando)
El bloque se **genera** (A3/A4), nunca a mano, y **solo si todo da** (102): md5 de los bytes primero, UTF-8 estricto sin
BOM, y los dos bloques se escriben a temporales que se renombran recién al final.
```powershell
$SQL = Carpeta C:\satori\pase-sql
function Armar-Bloque([string]$archivo, [string]$version, [string]$nombre, [string]$md5) {
  $f = Archivo $archivo
  if ((Md5Bytes $f) -cne $md5) { throw "${f}: md5 distinto (antes de generar)" }
  $bytes = [IO.File]::ReadAllBytes($f)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { throw "${f}: tiene BOM" }
  $sql = (New-Object Text.UTF8Encoding($false, $true)).GetString($bytes)      # UTF-8 estricto: un byte inválido corta
  if ($sql.Contains('$m$')) { throw "${f} contiene `$m`$" }
  $sinTx = $sql -replace '(?im)^\s*(begin|commit)\s*;\s*$', ''               # la 082 trae su propio begin/commit
  "begin;`nset local lock_timeout = '5s';`nset local statement_timeout = '60s';`n" + $sinTx +
    "`ninsert into supabase_migrations.schema_migrations (version, name, statements) values ('" + $version + "', '" +
    $nombre + "', array[`$m`$" + $sql + "`$m`$]);`ncommit;`n"
}
$u = New-Object Text.UTF8Encoding($false)
$b1 = Armar-Bloque "$SQL\081.sql" '081' 'pos_ndf_campos_factura' 'd4acf8dafc964ed23072aa49098f5b42'
$b2 = Armar-Bloque "$SQL\082.sql" '082' 'pos_ndf_ingesta_transaccional' 'edb7ffc58976804e55968f75df530a05'
[IO.File]::WriteAllText("$SQL\bloque_081.sql.tmp", $b1, $u); [IO.File]::WriteAllText("$SQL\bloque_082.sql.tmp", $b2, $u)
Move-Item -LiteralPath "$SQL\bloque_081.sql.tmp" "$SQL\bloque_081.sql"; Move-Item -LiteralPath "$SQL\bloque_082.sql.tmp" "$SQL\bloque_082.sql"
"bloques ok"
```
La fila del ledger guarda el archivo **original**. Lo que se ejecuta es el mismo SQL sin los `begin`/`commit` internos,
con los dos timeouts, en un solo `begin … commit` junto con el `insert`.
1. Editor SQL de PROD: abrir `bloque_081.sql`, copiar **todo** y correrlo.
2. **Verificar:**
   ```sql
   select version, name, md5(statements[1]) from supabase_migrations.schema_migrations where version = '081';
   -- 081 · pos_ndf_campos_factura · d4acf8dafc964ed23072aa49098f5b42
   select table_name, column_name from information_schema.columns where table_schema = 'public'
      and ((table_name = 'pos_ndf_tickets' and column_name in ('mesa_factura','consecutivo_fe','clave_fe','pedido_abierto_en','area_factura'))
        or (table_name = 'pos_ndf_open' and column_name in ('pedido_abierto_en','area')));                 -- 7 filas
   ```
   Si el md5 de la fila no da: **se para**, no se corrige en el momento. La corrección es el Anexo A.1, con su
   precondición, su lock y su conteo de filas.
3. El agente sigue entrando (1.4 durante 3 ciclos, unos 4 minutos).

## 3. Secretos por local (103: esquema cerrado; nunca portapapeles, eco ni log)
El Edge de hoy no lee `POS_INGEST_SECRETS`: cargarlo ahora no cambia nada en lo que corre.

**3.1 Reglas** (las hace cumplir el script; si una falla, **aborta** y no deja archivo):
- objeto JSON con **exactamente** `santa-teresa` y `nosara`; cada valor **texto** (ni `null`, ni número, ni objeto: un
  mapa mixto aborta), de **32 o más**, sin espacios, comillas ni barras; **sin repetidos** (comparación exacta);
- **santa-teresa = el secreto efectivo del agente**, leído con **su propio parser** (`loadEnv` + `loadAgenteConfig` de
  `C:\satori\satori-app-prod`): el valor que el agente manda de verdad;
- **nosara:** aleatorio de un solo uso, no se guarda; el día que Nosara tenga su agente se arma uno nuevo igual;
- antes de escribir, el mapa se prueba **con el parser del Edge** (`localDelSecreto` del clon): cada secreto abre su local
  y uno inventado no abre nada.

**3.2 Armar, cargar y verificar por huella** (1.9 dijo `cumple 32: True`; con `False` el pase ya paró en 1.9). El
script devuelve el sha256 entero solo con `--huella-completa`, y queda en una variable: **por pantalla, solo los 12
primeros** (119).
```powershell
$AG = Carpeta C:\satori\satori-app-prod; $CLON = Carpeta C:\satori\pase-v2; $SCR = Carpeta C:\satori\pase-scripts   # scripts del paquete (0.5b)
$REG = 'file:///' + ((Archivo "$AG\pos-bridge\register.mjs") -replace '\\','/')
$OUT = Join-Path (Carpeta $env:LOCALAPPDATA) "satori-pase-$(Get-Date -Format yyyyMMddHHmmss).env"
try {
  $r = node --import $REG (Archivo "$SCR\armar_mapa_secretos.mjs") --agente $AG --clon $CLON --salida $OUT --huella-completa; Ok 'armar mapa'
  $res = $r | ConvertFrom-Json
  if ($res.santa_teresa_cambiado) { throw 'el secreto del agente cambió: en el pase no se rota (Grok 120)' }
  supabase secrets set --env-file (Archivo $OUT) --project-ref yiczgdtirrkdvohdquzf | Out-Null; Ok 'secrets set'
} finally { if (Test-Path -LiteralPath $OUT) { Remove-Item -LiteralPath $OUT -Force } }
$lista = supabase secrets list --project-ref yiczgdtirrkdvohdquzf -o json; Ok 'secrets list'
$j = ($lista -join "`n") | ConvertFrom-Json
$items = if ($j.PSObject.Properties.Name -contains 'secrets') { @($j.secrets) } else { @($j) }   # las dos formas del CLI
$fila = @($items | Where-Object { $_.name -ceq 'POS_INGEST_SECRETS' })
if ($fila.Count -ne 1) { throw 'POS_INGEST_SECRETS no aparece una vez en la lista' }
if ($fila[0].value -cne $res.sha256_mapa) { throw 'la huella del panel no es la del mapa armado: NO SE SIGUE' }
"3.2 ok · manda $($res.archivo_que_manda) · largo $($res.largo_santa_teresa) · huella $($res.sha256_mapa.Substring(0,12))…"
```
**La huella está verificada en staging** (08-nov, CLI 2.122.0; ver `ENSAYO-STAGING-v2.md`): para un secreto cargado
con `--env-file` desde `NOMBRE='<JSON>'`, el CLI muestra en `value` (con `-o json`; en la tabla, la columna `DIGEST`)
**el sha256 del JSON, sin las comillas**: exactamente lo que calcula el script. Si el día del pase el CLI no la muestra o
no coincide, **se para**: no se verifica a ojo ni mostrando el valor.

**3.3 Si el secreto de santa-teresa mide menos de 32** (Grok 120): **el pase ya paró en 1.9**. El `.env` del agente no
se toca el día del pase. Escribir un secreto nuevo con la tarea detenida, en medio del cambio de base y Edge, suma un
riesgo que no hace falta. La rotación es un procedimiento aparte, con su ensayo en staging, su vuelta atrás y su firma:
[`ROTACION-SECRETO-AGENTE.md`](ROTACION-SECRETO-AGENTE.md). Se hace **otro día, antes** del pase.

**3.4** `POS_INGEST_SECRET` (el de antes) **no se borra**: el Edge anterior lo necesita si hay rollback (§8).

## 4. El cambio: drenar escritores → 082 → Edge → arrancar (104)
Se cambian la base y el Edge **sin nadie escribiendo** en `pos_ndf_*`. Objetivo: el agente detenido **≤ 15 minutos**.

**Antes de 4.1 (corrección 09-nov: el agente estuvo detenido ~40 min):** todo lo que se pueda preparar se prepara con
la tarea andando. Eso incluye: el CLI (0.6); los scripts (0.5b); `bloque_082.sql` generado y abierto en el editor de
PROD; la consola del deploy con el preámbulo corrido y el comando de 4.4 escrito (con `--use-api`); el panel de
`ingest-ndf` abierto. Entre 4.1 y 4.5 quedan solo la 082, el deploy y el arranque. Si pasa de 15 min, **no es
parada**: se anota el motivo en §10.

**4.1 Drenar escritores.** Corrección 09-nov (hallazgo del pase): la espera filtraba `node.exe` por la palabra `agente`,
y eso agarra también el agente de **STAGING**, que corre en la misma PC con la misma línea de comando. Por eso el de prod
estuvo ~40 min detenido, y el «cerrar node a mano» probablemente cerró el de staging (~11:58). Ahora el agente de prod se
identifica por **su carpeta** (`Detener-Agente`, en el preámbulo): sus PID se anotan antes de detener la tarea y la espera
mira solo esos. **Ningún bloque cierra procesos**; si el de prod no se detiene en 3 minutos, se avisa y se cierra **solo
por PID**.
```powershell
$AGDIR = Carpeta C:\satori\satori-app-prod; $CMDT = Archivo C:\satori\pos-agente-prod.cmd   # la carpeta y el .cmd que verificó 1.9
# un backfill (replay, 6.4) no se identifica por la carpeta si se lanzó desde una consola: cualquiera frena y se mira
$bf = @(Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'backfill' })
if ($bf.Count) { throw "hay un backfill corriendo (node $(@($bf | ForEach-Object { $_.ProcessId }) -join ', ')): esperar a que termine o ver de qué agente es. No se cierra" }
Detener-Agente 'Satori PoS Bridge PROD' $AGDIR $CMDT
```
Sin requests en vuelo: en PROD, `select last_poll_at from pos_ndf_cursor where local = 'santa-teresa';` dos veces, con
**2 minutos** entre una y otra: **no cambia**. Y Edge → Logs: ninguna invocación en esos 2 minutos.

**4.2 Registrar el corte al cambiar:** volver a correr la consulta **C** de §6.2 y anotarla en §10 como «corte al
cambiar» (por local: `last_factura`, `last_poll_at`, las `R` por categoría).

**4.3 Mig 082 v3:** editor de PROD, `bloque_082.sql` entero (columna, función y fila del ledger, con los dos timeouts, en
un `begin … commit`). **Verificar:**
```sql
select version, name, md5(statements[1]) from supabase_migrations.schema_migrations where version = '082';
-- 082 · pos_ndf_ingesta_transaccional · edb7ffc58976804e55968f75df530a05
select count(*) from information_schema.columns where table_schema = 'public'
   and table_name = 'pos_ndf_cursor' and column_name = 'max_factura_vista';                                 -- 1
select md5(prosrc) from pg_proc where oid = 'public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)'::regprocedure;
-- dab8ffdf8d2f82dacf874af22eb6f55d (la v3: el mismo cuerpo que en staging)
select has_function_privilege('service_role',  'public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE') as sr,   -- true
       has_function_privilege('anon',          'public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE') as anon, -- false
       has_function_privilege('authenticated', 'public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE') as auth; -- false
select public.pos_ndf_ingestar('prueba-pase', '[]', '[]', null, null);   -- tickets 0, cursor null, cursor_escrito false
select count(*) from public.pos_ndf_cursor where local = 'prueba-pase';  -- 0
```
Si algo no da: **no se despliega el Edge**; se arranca el agente (4.5: con el Edge de hoy sigue igual) y §8.4.

**4.3b — ya no existe** (Grok 120). Un secreto corto para el pase en 1.9; la rotación va aparte
([`ROTACION-SECRETO-AGENTE.md`](ROTACION-SECRETO-AGENTE.md)).

**4.4 Deploy del Edge** desde el clon (**nunca desde `satori-app-prod`**):
```powershell
$CLON = Carpeta C:\satori\pase-v2
$h = git -C $CLON rev-parse HEAD; Ok 'rev-parse'; if ($h -cne '5da233a516d1a6c4c2c95eb165be448be5416697') { throw 'clon fuera del SHA' }
$s = git -C $CLON status --porcelain; Ok 'status'; if ($s) { throw 'clon sucio' }
Push-Location $CLON; try { supabase functions deploy ingest-ndf --no-verify-jwt --use-api --project-ref yiczgdtirrkdvohdquzf; Ok 'deploy' } finally { Pop-Location }
```
Panel (corrección 09-nov): versión **mayor que la de 1.6** (anotar las dos; el 09-nov pasó de v1 a **v3**, no a v2, y queda por explicar qué creó la v2: ver el RESULTADO §4), fecha de hoy, «Enforce JWT verification» **apagado**. Anotar **`<HORA_DEPLOY>`
siempre con la zona: `AAAA-MM-DD HH:MM:SS-06:00`** (P6); en las consultas va como `'<HORA_DEPLOY>'::timestamptz`.

**4.5 Arrancar el agente:**
```powershell
Start-ScheduledTask -TaskName 'Satori PoS Bridge PROD'; Start-Sleep -Seconds 20
if ((Get-ScheduledTask -TaskName 'Satori PoS Bridge PROD').State -ne 'Running') { throw 'el agente no arrancó' }
```
Al arrancar, el agente saluda (lee el corte guardado) y sigue desde ahí. Anotar los minutos con la tarea detenida.

## 5. Prueba de humo
**5.1 Portón** (P7): `curl.exe -s -i -X POST https://yiczgdtirrkdvohdquzf.supabase.co/functions/v1/ingest-ndf -H "content-type: application/json" -d "{}"; Ok 'curl'`
→ **401 con `{"ok":false,"error":"No autorizado"}`** (el cuerpo es del Edge). Si sale `Missing authorization header`,
el JWT quedó prendido → 4.4.

**5.2 El agente entra** (3 ciclos):
```sql
select local, last_factura, max_factura_vista, last_poll_at, now() - last_poll_at as hace, last_error
  from public.pos_ndf_cursor where local = 'santa-teresa';
-- last_poll_at > '<HORA_DEPLOY>'::timestamptz y avanzando; last_error null; max_factura_vista con valor; last_factura ≤ max_factura_vista
```
Log del agente `C:\satori\logs\pos-agente-prod.log`: sin `401`, sin `rechazó el lote`, sin `Respuesta inesperada`.

**5.3** Repetir 1.5: lo que está en las dos fotos tiene **las mismas `lineas` y `suma_lineas`**.

**5.4 Una factura nueva, una sola vez y sin líneas duplicadas** (la primera que cierre después del deploy):
```sql
select t.id, t.numero_factura, t.estado, t.total_crc, t.ingested_at from public.pos_ndf_tickets t
 where t.local = 'santa-teresa' and t.ingested_at > '<HORA_DEPLOY>'::timestamptz and t.estado = 'C'
 order by t.fecha_registra desc limit 1;
select count(*) as lineas, sum(monto) as suma, count(distinct (codigo_producto, cantidad, monto)) as distintas
  from public.pos_ndf_ticket_lines where ticket_id = '<id de arriba>';
select t.numero_factura, count(*) as lineas, count(distinct (l.codigo_producto, l.cantidad, l.monto)) as distintas
  from public.pos_ndf_tickets t join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
 where t.local = 'santa-teresa' and t.ingested_at > '<HORA_DEPLOY>'::timestamptz
 group by 1 having count(*) >= 2 * count(distinct (l.codigo_producto, l.cantidad, l.monto));                -- 0 filas
```
**5.5 Sin descartes** (104): cada `200` trae `invalid = 0` y `problemas` vacío (Edge → Logs: ninguna línea
`ingest-ndf [santa-teresa] descartes:`). **Un 200 con descartes es parada** (§7.9).

**5.6 Logs del Edge:** sin `ingest-ndf: excepción` ni `no se pudo guardar el lote`. Una línea `ingest-ndf [santa-teresa]
corte retenido por la R <n>` **no es error**: dice qué factura en curso retiene el corte (6.2).

## 6. Primera hora, control del cursor y conciliación
**6.1 Cada 15 minutos (4 veces)**, lo lee el responsable de control:

| Qué | Dónde | Bien |
|---|---|---|
| Latido | `select now() - last_poll_at, last_error from pos_ndf_cursor where local = 'santa-teresa';` | < 3 min; `last_error` null |
| Ventas | `select count(*), max(ingested_at) from pos_ndf_tickets where local = 'santa-teresa' and ingested_at > '<HORA_DEPLOY>'::timestamptz;` | crece |
| Duplicados | la última consulta de 5.4 | 0 filas |
| Cuadre | 2 facturas al azar (las elige el control): líneas y total en el PoS = en la base | iguales |
| Descartes | logs (5.5) | ninguno |
| Cursor | consulta **C** (6.2) | ver 6.2 |
| Edge | panel → Logs | sin excepciones ni 401 |

**6.2 Control EXTRA del cursor (C1).** La defensa es el contrato de la 082 v3 (probado contra la RPC real, §9). Esto es un
control adicional, con orden **numérico**:
```sql
-- consulta C
-- (antes de la 082 la columna max_factura_vista no existe: se lee por to_jsonb y da null)
with c as (select x.local, x.last_factura, to_jsonb(x)->>'max_factura_vista' as max_factura_vista, x.last_poll_at
             from public.pos_ndf_cursor x where x.local = 'santa-teresa'),
r as (select t.numero_factura n, t.fecha_registra, t.ingested_at,
             (t.numero_factura ~ '^[0-9]+$' and c.last_factura ~ '^[0-9]+$') as ord
        from public.pos_ndf_tickets t join c using (local) where t.estado = 'R')
select c.last_factura, c.max_factura_vista, c.last_poll_at,
  count(r.n) filter (where r.ord and r.n::numeric < c.last_factura::numeric)                                   as r_bajo_corte,
  count(r.n) filter (where r.ord and r.n::numeric = c.last_factura::numeric)                                   as r_igual_corte,
  count(r.n) filter (where not r.ord)                                                                          as r_no_ordenables,
  count(r.n) filter (where r.ord and r.n::numeric <= c.last_factura::numeric and r.fecha_registra >= now() - interval '36 hours') as bajo_dentro_ventana,
  count(r.n) filter (where r.ord and r.n::numeric <= c.last_factura::numeric and r.fecha_registra <  now() - interval '36 hours') as bajo_fuera_ventana,
  string_agg(r.n, ',' order by case when r.ord then r.n::numeric end, r.n) filter (where not r.ord or r.n::numeric <= c.last_factura::numeric) as afectadas
  from c left join r on true group by 1, 2, 3;
```
- Con la 082 v3, una `R` vista (en el lote o guardada en las últimas 36 h) queda **por encima** del corte:
  `r_bajo_corte`, `r_igual_corte` y `r_no_ordenables` tienen que dar **0**, y `last_factura ≤ max_factura_vista`.
- Si el log del Edge dice `corte retenido por la R <n>` con **la misma** `<n>` por más de **2 horas**, se mira esa factura
  en el PoS: si está cerrada o anulada y no entró, es una «afectada» (replay, 6.4); si el PoS la borró sin cerrarla,
  retiene el corte hasta 36 h (se releen las `C` de arriba en cada ciclo; no duplica). Se anota; no es parada.
- Si alguno da más de 0, **anotar la lista `afectadas`**. Son facturas que cerraron o se anularon sin que el agente las
  releyera; por ejemplo, abrieron y cerraron dentro del mismo ciclo con número menor al corte, o cerraron fuera de la
  ventana de 36 h. Se recuperan con el **replay** de 6.4 (por fecha, también fuera de la ventana).
- **Nunca se da verde por un 0** justo después de un replay o de cualquier cambio: cada factura de `afectadas` tiene que
  pasar de `R` a `C` (o `X`) **y** cuadrar con el PoS (total y cantidad de líneas) en **dos ciclos seguidos** (dos
  lecturas con al menos 2 minutos entre una y otra):
  ```sql
  select t.numero_factura, t.estado, t.total_crc, count(l.*) as lineas, coalesce(sum(l.monto), 0) as suma, t.ingested_at
    from public.pos_ndf_tickets t left join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
   where t.local = 'santa-teresa' and t.numero_factura = any ('{<lista afectadas>}'::text[])
   group by t.id order by t.numero_factura;
  ```

**6.3 Conciliación con el PoS** (104), al cerrar la hora y al final del día:
```powershell
Push-Location (Carpeta C:\satori\satori-app-prod); try { npm.cmd run pos:dia -- (Get-Date -Format 'yyyy-MM-dd') --sin-detalle; Ok 'pos:dia' } finally { Pop-Location }
```
```sql
select count(*) filter (where estado = 'C') as cerradas, count(*) filter (where estado = 'R') as en_curso,
       count(*) filter (where estado = 'X') as anuladas, sum(total_crc) filter (where estado = 'C') as venta_cerradas
  from public.pos_ndf_tickets
 where local = 'santa-teresa' and (fecha_registra at time zone 'America/Costa_Rica')::date = (now() at time zone 'America/Costa_Rica')::date;
```
Tienen que coincidir las facturas por estado y la venta. Las `R` pueden diferir por las que cerraron entre las dos
lecturas: se repite a los 3 minutos. **Una diferencia que no se explica es un desfase y es parada** (§7.10).

**6.4 Replay desde el PoS:** el backfill del propio agente, **sin cambiar su código**, vuelve a mandar las cerradas de un
día. Su lote no trae `cursor` ni `open`: no mueve el corte ni las mesas, y el upsert por factura no duplica.
```powershell
$d = 'AAAA-MM-DD'    # el día de las facturas afectadas
Push-Location (Carpeta C:\satori\satori-app-prod); try { npm.cmd run pos:backfill -- --desde $d --hasta $d; Ok 'backfill' } finally { Pop-Location }
```
Después, 6.2 (las afectadas, dos ciclos) y 6.3.

## 7. Criterios de parada → rollback (§8)
Se para **sin discutir** si pasa cualquiera de estos:
1. 401 en el log del agente después de arrancarlo (4.5).
2. `last_error` no nulo **dos ciclos seguidos**, o `last_poll_at` quieto **más de 5 minutos** con el local abierto.
3. **Cualquier** factura con líneas duplicadas que no se explique contra el PoS.
4. Una factura cerrada en el PoS que **no llega en 3 ciclos**, o llega con otro total o con otra cantidad de líneas.
5. `ingest-ndf: excepción` o `no se pudo guardar el lote` en los logs del Edge.
6. «Enforce JWT verification» prendido y no se corrige con un redeploy.
7. La prueba de humo no pasa en **30 minutos** desde la primera venta.
8. Un 5xx o un timeout del Edge en **2 ciclos seguidos** (el agente reintenta una vez cada 5xx: un ciclo con sus dos
   intentos fallidos cuenta como uno).
9. Un **`200` con descartes** (5.5).
10. Cualquiera de estos tres:
    - un **desfase** en la conciliación (6.3) que no se explica;
    - `last_factura > max_factura_vista`;
    - facturas `afectadas` (6.2) que el replay no lleva a `C`/`X` cuadrando con el PoS en dos ciclos.
11. El agente no vuelve a `Running` (4.5) o queda detenido **más de 20 minutos**.

## 8. Rollback (el orden importa; también con los escritores drenados)
1. **Drenar** como en 4.1 (tarea detenida, `last_poll_at` quieto 2 minutos).
2. **El Edge anterior**, desde el worktree de `4d3513a6…` (0.4):
   ```powershell
   $V1 = Carpeta C:\satori\ingest-ndf-v1
   $h = git -C $V1 rev-parse HEAD; Ok 'rev-parse v1'; if ($h -cne '4d3513a6df8e838dd5c0442b05a580e06ce9db9d') { throw 'worktree de vuelta mal' }
   Push-Location $V1; try { supabase functions deploy ingest-ndf --no-verify-jwt --use-api --project-ref yiczgdtirrkdvohdquzf; Ok 'deploy v1' } finally { Pop-Location }
   ```
   Plan B, solo si falla: la carpeta de 1.7. **Verificar:** versión nueva, JWT apagado, 5.1 da 401 del Edge. El Edge
   anterior usa `POS_INGEST_SECRET` (§3.4). Como en el pase no se rota el secreto del agente (Grok 120), el de
   `POS_INGEST_SECRET` sigue siendo el que el agente manda.
3. **Arrancar el agente** (4.5) y verificar que entra (5.2).
4. **Recién después**, y solo si hace falta, sacar la 082: Anexo A.2 (precondición, lock y conteo de filas).
   **Nunca al revés.** La columna `max_factura_vista` puede quedar (el Edge anterior no la mira).
5. La 081 **no hace falta sacarla**. Solo si el dueño lo pide, con el Edge anterior corriendo y la 082 ya sacada:
   `C:\satori\pase-sql\081_rollback.sql`, precedido por la precondición del Anexo A.3.
6. **Salida del congelamiento de `main`** (P5), según el ledger de prod:
   - **081 y 082:** el dueño mergea **igual** el #71; Branching «All migrations are up to date»; se levanta el congelamiento.
   - **Solo 081:** **no** se mergea el #71. Se abre un PR solo con la 081 desde `main` (`git checkout 0a33df42514250509fef82af313fa576dd90aa39 -- supabase/migrations/081_pos_ndf_campos_factura.sql`, md5 `d4acf8da…`); lo mergea el dueño y, con Branching «up to date», se levanta el congelamiento.
   - **Ninguna:** se levanta enseguida; el #71 queda sin mergear hasta un nuevo pase.
7. Lo que no haya entrado: replay (6.4) y conciliación (6.3) con el Edge anterior. **No se promete** que no se pierda
   nada: se verifica contra el PoS, y lo que falte se recupera con el replay (o, fuera de su alcance, a mano con el dueño).

## 9. Después del pase
**9.0 Cierre (pasó o se volvió atrás), antes de firmar:** se borra cualquier copia `.antes-pase` que haya quedado de una
rotación (en el pase no se escribe ninguna, Grok 120; tiene un secreto viejo y el rollback no la necesita):
```powershell
$AG = Carpeta C:\satori\satori-app-prod
$posibles = @("$AG\.env.antes-pase", "$AG\.env.local.antes-pase", "$AG\pos-bridge\.env.antes-pase")
$copias = @($posibles | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
foreach ($c in $copias) { Remove-Item -LiteralPath $c -Force }
if (@($posibles | Where-Object { Test-Path -LiteralPath $_ }).Count) { throw 'quedó una copia .antes-pase' }
"9.0 ok · $($copias.Count) copia(s) .antes-pase borrada(s)"
```
- **#71** (A1): con §6 cerrado sin parada y la conciliación sin desfase, **el dueño firma y mergea** el #71 (solo los dos
  `.sql`, md5 `d4acf8da…` y `edb7ffc5…`; cabeza `0a33df42…`). Claude revisa el diff antes y lee el resultado de
  Branching, pero no mergea. Branching tiene que decir «All migrations are up to date»; recién ahí se levanta el
  congelamiento. Si dice otra cosa, frenar y avisar.
- La 085 espera al puente (decisión del dueño, 08-nov), con su propio paquete.
- Conciliación (6.3) al cierre de los 3 días siguientes.
- Borrar `POS_INGEST_SECRET` del panel a los 7 días sin rollback.
- Anotar en `ESTADO.md` la 081, la 082 v3 y la versión nueva del Edge.

**082 v3 en STAGING (09-nov, 01:43 -06:00, igual que la v2; detalle en `ENSAYO-STAGING-v2.md` §5):**
- **Antes:** ledger 082 en la v2 (`292dd3aa…`); Edge versión 15; cursor `112536`, sin error. Copias en el scratchpad.
- **Base:** la 082 v3 y su fila del ledger en UNA transacción (precondición: la fila en la v2). Ledger `edb7ffc5…`;
  `md5(prosrc)` `dab8ffdf…`; anon sin `execute`.
- **Edge:** desde `5da233a…` (worktree limpio), **versión 16**, JWT apagado, `<HORA_DEPLOY>` 2026-11-09 01:43:56-06:00.
- **Portón:** 401 del Edge.
- **Agente de staging real:** entró en el primer ciclo (01:44:49), sin error. Releyó 11 anuladas; no había `R`.
- **Controles:** consulta C en 0; 5.4 sin duplicados.
- **Vuelta atrás desde la v3:** `staging_volver_atras.sh --seco` (ROLLBACK, sin desplegar) OK.
- **v3 queda aplicada en staging.**
- **R → C en staging real:** visto con la v2. Las `R` 112509…112520 del ensayo del 08-nov entraron como `C` a las 22:43
  (23 `C` y 5 `X`). Con la v3 todavía no hubo ninguna `R` real; el camino está probado contra la RPC real en el emulador.

**Ensayo de punta a punta en STAGING (08-nov 20:16 -06:00, OK del dueño; detalle en `ENSAYO-STAGING-v2.md`):**
- **Base:** la 082 v2 y su fila del ledger, en UNA transacción; el ledger de staging quedó en `292dd3aa…`.
- **Edge:** desplegado desde `705b830…` (versión 15, JWT apagado).
- **Portón:** 401 del Edge.
- **Agente de staging real:** entró en el primer ciclo, sin error, con 18 facturas. `max_factura_vista` quedó
  cargado, la consulta C da 0 y no hay duplicados.
- **Huella de los secretos:** verificada (la del CLI es el sha256 del valor).
- **v2 queda aplicada en staging.** Vuelta atrás: `scripts/puente/staging_volver_atras.sh` (probada en seco).
- **Falta ver en staging real:** una factura que pase de R a C con el Edge v2. Se verá en el cierre de caja; lo controla
  la sesión de las 04:30.

**Ensayo en seco de los bloques de PowerShell (09-nov, GitHub Actions, `windows-latest`):**
- **Kit:** `scripts/puente/ensayo_seco_paquete.ps1`, corrido por el workflow `.github/workflows/ensayo-seco-puente.yml`.
  El workflow corre solo en esta rama, con `contents: read`, sin secretos ni variables y sin red a Supabase.
- **Qué hace el kit:** toma los **19 bloques de este documento tal cual**, en una carpeta temporal, con datos y un mapa de
  secretos ficticios, y con dobles de `git`, `supabase`, `node`, `npm`, `cmd` y de las tareas programadas. El bloque 1.9
  lee de verdad el entorno de la máquina del runner y el de la cuenta SYSTEM, que es la cuenta de la tarea ficticia. El
  log es público y no tiene nada real.
- **Corrida con este paquete (082 v3, 119 y 118):** https://github.com/CachoSatori/satori-app/actions/runs/42582314881
  (commit `a8876fab…`).
  - La corrida anterior (42582185602) dio **32 PASS, 3 FAIL**: el bloque 1.9 usaba `$k`, que chocaba con el bucle del kit
    (los bloques corren en el mismo ámbito, como en una consola). Ahora usa un nombre propio, y el kit también.
  - Corridas de la v2: 42560023268, 42560163977 y 42560304527.

| Versión | Resultado |
|---|---|
| **Windows PowerShell 5.1.26100.33648** (Desktop) | **35 PASS, 0 FAIL** |
| **PowerShell 7.6.9** (Core) | **35 PASS, 0 FAIL** |

Por bloque, en las dos versiones, todo **PASS**:

| Bloque | Sección del paquete |
|---|---|
| 1 | verificar la versión de PowerShell |
| 2 | preámbulo fail-stop |
| 3 | 0.4 |
| 4 | 0.5 |
| 5 | 0.8 |
| 6 | 1.7 |
| 7 | 1.9, entorno de la cuenta de la tarea |
| 8 | 1.9, medición (`--solo-medir`) |
| 9 | 1.10 |
| 10 | generador de §2 |
| 11 | 3.2 |
| 12 | 4.1 |
| 13 | 4.3b |
| 14 | 4.4 |
| 15 | 4.5 |
| 16 | 6.3 |
| 17 | 6.4 |
| 18 | 8.2 |
| 19 | 9.0 (borra la copia `.antes-pase`) |

Además, en las dos versiones, **PASS** en los controles:
- sin archivos del mapa en `LOCALAPPDATA`;
- la copia `.antes-pase` ficticia, borrada;
- los dos bloques del ledger generados;
- `bloque_082` con un solo `begin/commit` y los timeouts;
- `bloque_082` sin BOM.

Y en los frenos:
- un nativo que falla corta con su código;
- md5 distinto;
- `.sql` con BOM;
- huella que no coincide;
- falla del armado del mapa;
- **la tarea no corre el agente de `satori-app-prod`** (nuevo);
- generador con la 082 alterada, sin dejar archivos;
- ruta relativa;
- BOM con md5 correcto;
- UTF-8 inválido.

Los `.sql` del kit son ficticios. Los de verdad los controla el bloque 0.5 con los md5 reales el día del pase.

**Qué se probó de verdad con la v3 (09-nov, staging; transacciones descartadas, nada quedó):**
- `bash scripts/puente-compat/correr.sh` → **8/8**. Es el agente `4d3513a6…` real contra la RPC v3 real, 19 ciclos más un
  replay. Suma tres casos (113):
  - el error del PoS con el corte retenido (lote vacío con `last_error`) y el reinicio con la `R` ya cerrada;
  - la `R` que cierra entre `leerCerradas` y `leerProvisionales` (la retiene la `R` guardada);
  - el log de `corte_retenido_por_r`.

  El **control v2** (`2aa7b98`) reproduce el 113 (corte saltado y dos facturas que quedan en `R`), y el de `e4678b3` el
  ID 83. Las fechas son relativas a la hora real, así que la prueba da lo mismo cualquier día.
- `bash scripts/sql/puente_carreras/pruebas.sh` → **38/38** con la v3. Con la v2 da **33/38**: caen exactamente los 5
  casos del 113, que son:
  - corte retenido + lote vacío (tres formas);
  - error del PoS + reinicio;
  - la `R` entre las dos lecturas.

  Cubre también la ventana de 36 h, una `R` de otro local y un local nuevo con error.
- `bash scripts/puente/test_armar_mapa.sh` → **17/17**. Suma `--solo-medir` (un secreto corto no corta 1.9) y la huella
  de 12 caracteres.
- vitest `src/shared/ndf` → **203/203**.
- `python3 -I scripts/puente/probar_sql_paquete.py` → **8/8**. Suma el gate 1.11 (118).

**Qué se probó de verdad con la v2 (09-nov, staging; transacciones descartadas, nada quedó):**
- `bash scripts/puente-compat/correr.sh` → **7/7**:
  - **A7 en seco:** el agente `4d3513a6…` real contra el PoS simulado estricto. El objeto `p` pasa tal cual y se
    assertan rango, cursor y tipo; el cableado viejo y las lecturas inválidas hacen fallar al mock.
  - **Caso 83:** la RPC v2 real en staging, 12 ciclos más un replay. Cubre una R bajo el cursor, que el agente reciba el
    corte, la R que cierra y entra una vez, igualdad, una R fuera de la ventana, null, la falla de la RPC con reintento y
    la red caída.
  - **Control con la 082 de `e4678b3`:** reproduce el bug.
  - **Lote en el límite:** `MAX_TICKETS`.
- `bash scripts/sql/puente_carreras/pruebas.sh` → **25/25**. Es la RPC v2 con la 082 del archivo; cubre folios no
  numéricos, error de la RPC, backfill sin cursor, límites de la R y lo propuesto ignorado.
- `bash scripts/puente/test_armar_mapa.sh` → **13/13**. Es el armado del mapa con el agente `4d3513a6…` real y `.env`
  inventados.
- vitest `src/shared/ndf` → **203/203**.
- `python3 -I scripts/puente/probar_sql_paquete.py` → **7/7**. Toma el SQL **de este documento**, no copias:
  - la consulta C sobre la base de hoy, sin la columna nueva;
  - la consulta C con la 082 v2 y una `R` de cada categoría;
  - los Anexos A.1–A.3, cuyas precondiciones frenan en staging;
  - el Anexo A.2 por el lado positivo.

**Qué quedó solo escrito (no probado):**
- Una `R` real en staging que pase a `C` **con la v3** (con la v2 se vio; con la v3 se verá en el próximo turno).
- El bloque 1.9 contra una tarea programada **real**: el kit lo corre contra la cuenta SYSTEM del runner; la PC del PoS
  no se toca hasta el pase.
- Los Anexos A.1 y A.3 por el lado positivo (sí están probados sus frenos y A.2 entero).

## 10. Firma y bitácora
- [x] **Camino v2 firmado por el dueño el 08-nov-2026 a las 19:08.**
- [x] **El dueño eligió arreglar el 113 con una 082 v3** (09-nov, después del GO condicionado de Grok de las 21:54 del
  08-nov). El GO definitivo es sobre **este** paquete, con la v3.
- [ ] GO de Grok sobre este paquete (fecha del informe: ________).
- [ ] Leí el paquete, los criterios de parada y el orden del rollback.
- Fecha y ventana (la define el dueño tras la auditoría de la 082 v3): ________ · **Ejecución:** el dueño · **Control:** ________ (encargado del turno)
- La aceptación del cambio del cursor del 08-nov (C1 del paquete viejo) **quedó sin efecto**: v2 cambia el contrato
  («corte seguro») y el conteo de `R` queda como control extra (6.2).
- [ ] **Autorizo el pase de la 081, la 082 v3 y el Edge `ingest-ndf` @ `5da233a516d1a6c4c2c95eb165be448be5416697`.**
  Firma del dueño: ________ · Firma del control: ________ · Fecha/hora: ________

| Paso | Hora | Resultado anotado |
|---|---|---|
| Versión de PowerShell de cada consola (`$PSVersionTable`): 5.1.x Desktop (o 7.x Core, la misma en todas) | | |
| 0.4 clon en `5da233a5…`, contra `e4678b3` solo los 5 archivos · worktree `4d3513a6…` | | |
| 0.5 md5 081 / 082 v3 (bytes) · 082 del código = 082 del #71 · `081_rollback` por SHA y md5 | | |
| 0.8 agente de prod en `4d3513a6…`, sin cambios | | |
| 0.9 congelamiento de `main` avisado | | |
| 1.1–1.4 ledger · función y columna no existen · cursor sano | | |
| 1.6 Edge (versión, fecha, JWT) · 1.7 copia (= `4d3513a6…`: sí/no) | | |
| 1.9 entorno: cuenta y SID, «leído de:» entero (Grok 121) · archivo que manda · largo · cumple 32 (False = PARADA, Grok 120) | | |
| 1.10 por local: corte, R por categoría · PoS: facturas por estado, venta | | |
| 1.11 formato: no numéricas 36 h = 0 · cursor numérico · largo mín./máx. · con ceros | | |
| 2 · md5 081 · 7 columnas | | |
| 3.2 mapa cargado · huella (12 primeros) | | |
| 4.1 agente detenido (hora) · `last_poll_at` quieto · 4.2 corte al cambiar | | |
| 4.3 md5 082 v3 · md5 de la función · columna · grants · llamada en vacío | | |
| 4.4 deploy (`<HORA_DEPLOY>` con `-06:00`, versión, JWT apagado) | | |
| 4.5 agente arrancado (hora) · minutos detenido | | |
| 5.1–5.6 humo (incluye «sin descartes») | | |
| 6.1 +15 / +30 / +45 / +60 · 6.2 consulta C (cada vez) | | |
| 6.2 afectadas (lista), si hubo · R→C en dos ciclos | | |
| 6.3 conciliación · 6.4 replay, si hubo | | |
| Cierre: pasa / rollback (hasta qué paso de §8) · 0.8 otra vez · 9.0 copias `.antes-pase` borradas | | |
| #71 firmado y mergeado por el dueño · Branching «up to date» · congelamiento levantado | | |

## Anexo A. Correcciones a mano en PROD (ninguna lista para pegar sin su precondición)
Cada una va en **una** transacción, con **precondición** sobre lo esperado, **lock** de lo que toca y **conteo de filas**;
si algo no da, `raise` y no queda nada. Se corren solo con la decisión del dueño y anotadas en §10.

**A.1 Corregir la fila 081 del ledger** (solo si §2 dio md5 distinto y las 7 columnas están):
```sql
begin;
set local lock_timeout = '5s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ declare n int; begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '081') <> 1 then raise exception 'precondición: se esperaba UNA fila 081'; end if;
  if (select md5(statements[1]) from supabase_migrations.schema_migrations where version = '081') = 'd4acf8dafc964ed23072aa49098f5b42' then raise exception 'precondición: el md5 ya está bien'; end if;
  delete from supabase_migrations.schema_migrations where version = '081';
  get diagnostics n = row_count; if n <> 1 then raise exception 'se borraron % filas (se esperaba 1)', n; end if;
end $$;
-- pegar acá la línea «insert into supabase_migrations.schema_migrations …» de bloque_081.sql, entera
do $$ begin
  if (select md5(statements[1]) from supabase_migrations.schema_migrations where version = '081') is distinct from 'd4acf8dafc964ed23072aa49098f5b42' then
    raise exception 'el md5 sigue sin dar: no queda nada';
  end if;
end $$;
commit;
```
**A.2 Sacar la 082** (rollback §8.4, con el Edge anterior ya corriendo y verificado):
```sql
begin;
set local lock_timeout = '5s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $$ declare n int; begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '082'
        and md5(statements[1]) = 'edb7ffc58976804e55968f75df530a05') <> 1 then
    raise exception 'precondición: se esperaba UNA fila 082 con el md5 de la v3';
  end if;
  if to_regprocedure('public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)') is null then raise exception 'precondición: la función no existe'; end if;
  drop function public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb);
  delete from supabase_migrations.schema_migrations where version = '082';
  get diagnostics n = row_count; if n <> 1 then raise exception 'se borraron % filas (se esperaba 1)', n; end if;
end $$;
commit;
```
**A.3 Antes de `081_rollback.sql`:** en la misma transacción, primero esta precondición (la 082 ya no está y la 081 sí,
con su md5); después el contenido del archivo; si algo no da, no queda nada:
```sql
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regprocedure('public.pos_ndf_ingestar(text, jsonb, jsonb, jsonb, jsonb)') is not null then raise exception 'precondición: la 082 sigue puesta'; end if;
  if (select count(*) from supabase_migrations.schema_migrations where version = '081' and md5(statements[1]) = 'd4acf8dafc964ed23072aa49098f5b42') <> 1 then
    raise exception 'precondición: la fila 081 no es la esperada';
  end if;
end $$;
-- acá el contenido de C:\satori\pase-sql\081_rollback.sql (sin su begin/commit, si los trae)
commit;
```
**Cursor:** este paquete **no tiene ningún UPDATE del cursor**. Las facturas que el cursor no ve se recuperan con el
replay (6.4). Si alguna vez hiciera falta tocarlo, las condiciones son:
- la tarea del agente detenida y sin requests en vuelo (4.1);
- una transacción con `select … from pos_ndf_cursor where local = '<local>' and last_factura = '<el anotado en 4.2>' for
  update`, que hace `raise` si no devuelve exactamente una fila;
- `get diagnostics` = 1 después del cambio;
- el control de 6.2 (las afectadas en dos ciclos) antes de dar verde.
