# BioTime Bridge — agente local (Satori · F1c)

Programa chiquito que corre **en la PC del reloj** de un local. Cada 2 minutos lee las marcas
nuevas de BioTime y se las manda a Satori. Nada más.

- **BioTime nunca se escribe.** El agente solo hace un `SELECT` con un usuario de solo lectura.
- **Solo sale, nunca entra.** El agente abre la conexión hacia Supabase; no abre ningún puerto
  en la PC ni hace falta tocar el router.
- **Un agente por local.** Dos PCs, dos `.env`, con distinto `LOCAL`. Cada BioTime tiene su
  propia numeración de marcas y por eso no se pueden mezclar.
- Acá **no** se calculan horas ni se emparejan entradas con salidas: eso lo hace Satori después.

## Instalación (una sola vez, en la PC del local)

1. Instalar **Node 20 o superior** (https://nodejs.org — la versión LTS).
2. Copiar esta carpeta a la PC, por ejemplo en `C:\satori\biotime-bridge`.
3. Abrir una consola en esa carpeta y correr:

   ```
   npm install
   ```

4. Copiar `.env.example` a `.env` y completar:

   ```
   LOCAL=santa-teresa            # o nosara — según la PC
   BIOTIME_PASSWORD=<clave del usuario satori_ro>
   INGEST_SECRET=<el secreto que da Ismael>
   ```

   El resto de los valores ya viene bien para la instalación estándar de BioTime
   (`127.0.0.1:7496`, base `Satori`, usuario `satori_ro`).

   > ⚠️ El `.env` tiene las dos claves. **No se manda por WhatsApp ni por mail, y no va al
   > repositorio** (ya está en el `.gitignore`).

5. Arrancar:

   ```
   npm start
   ```

   En pantalla se ve una línea por ciclo:

   ```
   [2026-08-21T15:04:00.000Z] local=santa-teresa fetched=12 inserted=12 duplicates=0 last_id=4833
   ```

   `Ctrl+C` lo corta limpio (termina el ciclo en curso y cierra la conexión).

## Dejarlo corriendo siempre (Windows)

Con el **Programador de tareas** (Task Scheduler):

- Acción: `Iniciar un programa`
- Programa: `C:\Program Files\nodejs\node.exe`
- Argumentos: `dist\index.js`
- Iniciar en: `C:\satori\biotime-bridge`
- Marcar *Ejecutar aunque el usuario no haya iniciado sesión* y *Reiniciar si falla*.
- Disparador: `Al iniciar el equipo`.

Antes de eso, correr `npm run build` una vez (o `npm start`, que buildea solo).

Si el agente estuvo apagado un tiempo, no se pierde nada: al volver retoma desde la última
marca confirmada y se pone al día en el mismo ciclo.

## Qué hace, en criollo

1. Se fija en `.bridge-state.json` cuál fue la última marca confirmada (`last_id`).
2. Le pide a BioTime las marcas con id mayor a esa, de a 200.
3. Se las manda a Satori.
4. **Recién cuando Satori confirma**, guarda el nuevo `last_id`.
5. Cuando no queda nada nuevo, duerme 2 minutos y vuelve a empezar.

Si algo falla (se cayó internet, el reloj está apagado), **no** avanza el corte: en el próximo
ciclo lo reintenta. Mandar dos veces la misma marca no la duplica.

Si borrás `.bridge-state.json`, el agente arranca de cero y vuelve a mandar todo el histórico.
No pasa nada: las repetidas se descartan solas (se cuentan como `duplicates`).

## Cosas que pueden aparecer en el log

| Mensaje | Qué significa | Qué hacer |
|---|---|---|
| `Falta LOCAL en el .env` | El `.env` está incompleto | Completar el `.env` |
| `LOCAL inválido` | Se escribió mal el local | Tiene que ser `santa-teresa` o `nosara` |
| `ingest-punches rechazó el lote (401)` | El `INGEST_SECRET` no coincide | Pedirle el secreto correcto a Ismael |
| `N sin empleado mapeado` | Marcas de un usuario del reloj que no está vinculado | Cargar el **Cód. BioTime** en Satori → Salarios → Empleados / Tarifas |
| `punch_time con formato irreconocible` | `punch_time` no es ni un instante con zona ni un `timestamp` naive | Avisar — el agente frena a propósito, para no guardar instantes inventados |
| `ECONNREFUSED` | No llega a BioTime o a internet | Ver que BioTime esté prendido y haya red |

## Seguridad

- El usuario `satori_ro` solo tiene permiso de **lectura** sobre `iclock_transaction` y
  `personnel_employee`. Además, el agente abre la sesión en modo solo-lectura: aunque alguien
  agregara un `INSERT` por error, Postgres lo rechazaría.
- El secreto de Satori viaja en un header, siempre por **https**.
- El agente no expone ningún servicio: no hay puerto para atacar desde afuera.
- Las claves viven únicamente en el `.env` de cada PC.

## Para el técnico

```
src/config.ts        lee y valida el .env
src/db.ts            conexión a BioTime (pg), sesión read-only
src/fetchPunches.ts  el SELECT incremental + fila -> cuerpo del edge
src/pushIngest.ts    POST a la Edge Function ingest-punches
src/state.ts         last_id por local (escritura atómica)
src/index.ts         el loop
```

Los tests (`*.test.ts`) corren con el vitest del repo de Satori (`npx vitest run`), no hace
falta instalarlos en la PC del local.


## Zona horaria — el desfase de 1 hora del piloto v3

Costa Rica es **UTC−6 FIJO**: no tiene horario de verano. Ese offset es la única verdad de
este agente.

`public.iclock_transaction.punch_time` de BioTime es un `timestamp` **naive** (reloj de pared,
sin zona). Antes, `pg` lo convertía a `Date` interpretándolo en la zona del **proceso Node** —
o sea, en la que tenga configurada la PC del reloj. Con esa PC en una zona UTC−5 (Bogotá, Lima)
o en una zona con horario de verano que en agosto corre a UTC−5 (Central Time), cada marca se
mandaba **1 hora antes**: BioTime 16:00 → la app mostraba 15:00. Nada fallaba, así que el error
fue invisible hasta la validación física.

Ahora:

- `db.ts` desactiva el parseo de `timestamp` (OID 1114): los naive llegan como **texto crudo**.
- `fetchPunches.ts` les pone `-06:00` explícito (`conOffsetCR`).
- La sesión se abre con `TimeZone=America/Costa_Rica`.
- El resultado **no depende de cómo esté configurada la PC del local**, que era el problema.

En cada arranque el agente imprime la última marca tal cual está en BioTime, el instante que va
a mandar y la hora en que se verá en la app. **Tienen que coincidir con lo que muestra BioTime.**
Si no coinciden, el problema está aguas arriba (la hora del propio reloj o del BioTime), no acá.

Las marcas que quedaron guardadas corridas se corrigen con `CORRECCION-DESFASE-1H.sql`, que
**no está aplicado**: lo revisa el asesor y lo corre Ismael.
