# Rotación del secreto del agente del PoS (procedimiento aparte del pase)

> **Grok 120 (auditoría v3, 09-nov).** El secreto del agente **no se cambia el día de un pase**. Si 1.9 da un secreto
> de menos de 32, el pase **para** y el secreto se rota con este procedimiento: **otro día, antes del pase**, primero en
> STAGING (ensayo) y después en PROD, cada vez con la firma del dueño.
>
> **Claude no corre nada en prod.** Lo ejecuta el dueño en la PC del PoS, con PowerShell 5.1 (o 7, la misma en todas
> las consolas) y en una consola de administrador.

## Por qué hace falta
El Edge `ingest-ndf` en prod (v3, desde el 09-nov) lee el mapa de secretos por local (`POS_INGEST_SECRETS`) y **solo
acepta secretos de 32 o más** (`localDelSecreto`, `src/shared/ndf/ingestNdf.ts`). Un agente con un secreto más corto
**no entra**. Hoy el agente de prod manda uno de 64 (RESULTADO del pase, §1), así que esto hace falta para:
- un agente nuevo (por ejemplo, Nosara);
- una rotación periódica o una sospecha de filtración.

## Qué cambia y qué no
- **Cambia:**
  - la línea `INGEST_SECRET=` del archivo `.env` que el agente manda, con una copia `.antes-pase` al lado mientras dura
    el procedimiento;
  - el mapa `POS_INGEST_SECRETS` del panel.
- **No cambia:**
  - el código del agente;
  - el Edge;
  - la base;
  - `POS_INGEST_SECRET` (el viejo, de vuelta atrás del Edge anterior).
- **Tiempo con la tarea detenida:** ~5 minutos. Todo lo demás se prepara con la tarea andando.

## R0. Consola (en cada una, antes que nada)
```powershell
$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
function Ok([string]$que) { if ($LASTEXITCODE -ne 0) { throw "falló «$que» (código $LASTEXITCODE): NO SE SIGUE" } }
function Carpeta([string]$p) { if (-not [IO.Path]::IsPathRooted($p) -or -not (Test-Path -LiteralPath $p -PathType Container)) { throw "no es una carpeta absoluta existente: $p" }; (Resolve-Path -LiteralPath $p).Path }
function Archivo([string]$p) { if (-not [IO.Path]::IsPathRooted($p) -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "no es un archivo absoluto existente: $p" }; (Resolve-Path -LiteralPath $p).Path }
function Md5Bytes([string]$p) { (Get-FileHash -Algorithm MD5 -LiteralPath (Archivo $p)).Hash.ToLower() }
if (Test-Path -LiteralPath C:\satori\supabase-cli -PathType Container) { $env:Path = 'C:\satori\supabase-cli;' + $env:Path }
```

## R1. Entorno: STAGING primero (ensayo), PROD después (con firma)
**Se corre entero en STAGING antes**, con su agente («Satori PoS Bridge», `C:\satori\satori-app`). Recién con el
ensayo en verde y la firma del dueño, se repite con `prod`. **Se escribe a mano** `staging` o `prod`: no hay valor por
defecto.
```powershell
$ENTORNO = 'staging'        # 'staging' para el ensayo; 'prod' SOLO con el ensayo en verde y la firma del dueño
switch ($ENTORNO) {
  'staging' { $TAREA = 'Satori PoS Bridge';      $AG = Carpeta C:\satori\satori-app;      $REF = 'hwiatgicyyqyezqwldia' }
  'prod'    { $TAREA = 'Satori PoS Bridge PROD'; $AG = Carpeta C:\satori\satori-app-prod; $REF = 'yiczgdtirrkdvohdquzf' }
  default   { throw "ENTORNO tiene que ser 'staging' o 'prod': $ENTORNO" }
}
if ((Get-ScheduledTask -TaskName $TAREA).State -ne 'Running') { throw "la tarea $TAREA no está andando: arrancarla y esperar un ciclo antes de rotar" }
"R1 ok · $ENTORNO · tarea $TAREA · agente $AG"
```

## R2. Preparar, con la tarea ANDANDO
Necesita el código del Edge que está desplegado, para probar el mapa con **su** parser (el 09-nov fue `5da233a`), y el
script desde el commit del paquete, con md5 sobre los bytes, como en el bloque 0.5b del pase:
```powershell
New-Item -ItemType Directory -Force C:\satori | Out-Null
if (-not (Test-Path -LiteralPath C:\satori\rotacion-clon)) { git clone https://github.com/CachoSatori/satori-app.git C:\satori\rotacion-clon; Ok 'clone' }
$CLON = Carpeta C:\satori\rotacion-clon
git -C $CLON fetch origin claude/puente-item11-prod-v2; Ok 'fetch'
git -C $CLON checkout --detach 5da233a516d1a6c4c2c95eb165be448be5416697; Ok 'checkout'   # el código del Edge desplegado
$s = git -C $CLON status --porcelain; Ok 'status'; if ($s) { throw 'el clon no está limpio' }
New-Item -ItemType Directory -Force C:\satori\rotacion-scripts | Out-Null; $SCR = Carpeta C:\satori\rotacion-scripts
Get-ChildItem -LiteralPath $SCR -File | Remove-Item -Force
$PAQ = 'cd6d5a1ceb7adf06a0f79b780f126a4263884ca3'               # commit con el script (el del paquete del 09-nov)
cmd /c "git -C `"$CLON`" show ${PAQ}:scripts/puente/armar_mapa_secretos.mjs > `"$SCR\armar_mapa_secretos.mjs`""; Ok 'show armar_mapa'
if ((Md5Bytes "$SCR\armar_mapa_secretos.mjs") -cne '73c4d9d207c22c13d5c42498bb63e8ca') { throw 'armar_mapa_secretos.mjs: md5 distinto' }
$REG = 'file:///' + ((Archivo "$AG\pos-bridge\register.mjs") -replace '\\','/')
$m = node --import $REG (Archivo "$SCR\armar_mapa_secretos.mjs") --agente $AG --clon $CLON --solo-medir; Ok 'medir secreto'
$antes = $m | ConvertFrom-Json
"R2 ok · manda $($antes.archivo_que_manda) · largo actual $($antes.largo_santa_teresa) · cumple 32: $($antes.cumple_32)"
```
Además, **antes de R3**, en el editor SQL del entorno (anotar el resultado):
```sql
select local, last_poll_at, now() - last_poll_at as hace, last_error from public.pos_ndf_cursor;  -- hace < 2 min, sin error
```

## R3. Detener la tarea
```powershell
Stop-ScheduledTask -TaskName $TAREA
$t0 = Get-Date
while ((Get-ScheduledTask -TaskName $TAREA).State -eq 'Running') {
  if ((Get-Date) - $t0 -gt [TimeSpan]::FromMinutes(3)) { throw 'la tarea no se detuvo en 3 minutos' }
  Start-Sleep -Seconds 5
}
$detenida = Get-Date
"R3 ok · tarea detenida $(Get-Date -Format 'HH:mm:ss')"
```

## R4. Secreto nuevo + mapa, en un solo paso (con la tarea detenida)
El script hace todo en un paso:
- escribe el secreto nuevo en la línea `INGEST_SECRET=` del archivo que el agente manda, y deja la copia
  `.antes-pase` al lado;
- lo vuelve a leer con el parser del agente;
- prueba el mapa con el parser del Edge;
- deja el mapa en un archivo temporal.

Después se carga el mapa y se compara su **huella**. Nunca se muestra un valor.
```powershell
if ((Get-ScheduledTask -TaskName $TAREA).State -eq 'Running') { throw 'la tarea no está detenida (R3)' }
$OUT = Join-Path (Carpeta $env:LOCALAPPDATA) "satori-rotacion-$(Get-Date -Format yyyyMMddHHmmss).env"
try {
  $r = node --import $REG (Archivo "$SCR\armar_mapa_secretos.mjs") --agente $AG --clon $CLON --salida $OUT --nuevo-santa-teresa --huella-completa; Ok 'armar mapa (secreto nuevo)'
  $res = $r | ConvertFrom-Json
  if (-not $res.santa_teresa_cambiado) { throw 'el script no cambió el secreto' }
  supabase secrets set --env-file (Archivo $OUT) --project-ref $REF | Out-Null; Ok 'secrets set'
} finally { if (Test-Path -LiteralPath $OUT) { Remove-Item -LiteralPath $OUT -Force } }
$lista = supabase secrets list --project-ref $REF -o json; Ok 'secrets list'
$j = ($lista -join "`n") | ConvertFrom-Json
$items = if ($j.PSObject.Properties.Name -contains 'secrets') { @($j.secrets) } else { @($j) }
$fila = @($items | Where-Object { $_.name -ceq 'POS_INGEST_SECRETS' })
if ($fila.Count -ne 1) { throw 'POS_INGEST_SECRETS no aparece una vez en la lista' }
if ($fila[0].value -cne $res.sha256_mapa) { throw 'la huella del panel no es la del mapa armado: NO SE SIGUE (ir a la vuelta atrás)' }
"R4 ok · secreto nuevo · largo $($res.largo_santa_teresa) · huella $($res.sha256_mapa.Substring(0,12))…"
```

## R5. Arrancar la tarea
```powershell
Start-ScheduledTask -TaskName $TAREA; Start-Sleep -Seconds 20
if ((Get-ScheduledTask -TaskName $TAREA).State -ne 'Running') { throw 'la tarea no arrancó' }
"R5 ok · tarea andando · minutos detenida: $([math]::Round(((Get-Date) - $detenida).TotalMinutes, 1))"
```
**Verificar en el editor SQL** (dos ciclos, ~3 min): `last_poll_at` avanza, `last_error` es null, y en los logs del Edge
no hay `401`. Si no entra en 3 minutos: **vuelta atrás** (abajo).

## R6. Cierre (solo con R5 verificado)
La copia `.antes-pase` tiene el secreto **viejo**: se borra recién cuando el agente entró con el nuevo.
```powershell
$posibles = @("$AG\.env.antes-pase", "$AG\.env.local.antes-pase", "$AG\pos-bridge\.env.antes-pase")
$copias = @($posibles | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
foreach ($c in $copias) { Remove-Item -LiteralPath $c -Force }
if (@($posibles | Where-Object { Test-Path -LiteralPath $_ }).Count) { throw 'quedó una copia .antes-pase' }
"R6 ok · $($copias.Count) copia(s) .antes-pase borrada(s) · rotación cerrada en $ENTORNO"
```

## Vuelta atrás (si R4 o R5 fallan)
1. **Detener la tarea** (R3).
2. **Devolver el `.env`:** copiar la `.antes-pase` sobre el archivo que manda (el que dijo R2). Así vuelve el secreto
   viejo.
3. **Mapa con el secreto viejo:** si el viejo medía **32 o más**, correr R4 **sin** `--nuevo-santa-teresa` (arma el
   mapa con el secreto que el agente manda ahora) y comparar la huella. Si medía **menos de 32**, con el Edge de mapa
   ese agente **ya no entraba**: no hay a qué volver, y se repite la rotación una vez encontrado el problema.
4. **Arrancar** (R5) y verificar.
5. La copia `.antes-pase` se borra solo con el agente entrando.

## Límite conocido
El script arma el mapa con un secreto **nuevo y descartable para Nosara** cada vez. Mientras Nosara no tenga agente no
importa. **Cuando lo tenga, el script tiene que conservar el secreto de Nosara al rotar el de Santa Teresa** (y al
revés): es un cambio del script, con su prueba, antes de esa rotación.

## Ensayo en seco
`scripts/puente/ensayo_seco_paquete.ps1 -Paquete docs/puente/ROTACION-SECRETO-AGENTE.md` corre estos bloques con
datos ficticios y dobles. No sale a la red. Prueba que:
- se borra la copia `.antes-pase`;
- no queda ningún archivo del mapa;
- **frena** si la huella no coincide, si la tarea no está detenida en R4, o si `ENTORNO` no es `staging` ni `prod`.

El workflow `ensayo-seco-puente` lo corre en PowerShell 5.1 y 7.

## Bitácora (una por entorno)
| Paso | staging | prod |
|---|---|---|
| Firma del dueño (fecha y hora, -06:00) | | |
| R1 entorno · tarea · agente | | |
| R2 archivo que manda · largo actual · cursor sano | | |
| R3 tarea detenida (hora) | | |
| R4 largo nuevo · huella (12 primeros) | | |
| R5 tarea andando · minutos detenida · `last_poll_at` avanza · sin 401 | | |
| R6 copias `.antes-pase` borradas | | |
