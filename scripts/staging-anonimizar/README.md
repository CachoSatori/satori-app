# Anonimizar staging

Construye [SPEC-anonimizar-staging](../../docs/specs/SPEC-anonimizar-staging.md) (firmada el 20-nov, D1–D7). **Solo staging**
(`hwiatgicyyqyezqwldia`): el ref está fijo en `correr.py` y en `../staging-usuarios-prueba/lib.sh`, y la guarda SQL exige además
`club_entorno = 'staging'` y los usuarios de prueba (en prod no existen). La corrida real **escribe para siempre**: la hace
el coordinador con el **OK del dueño por chat**. Orden y archivos: [STAGING.md](../../STAGING.md), «Anonimizar staging».

## Pasos
```bash
python3 scripts/staging-anonimizar/correr.py formas                 # 0 conteos de formas de mesas y productos (solo lectura)
python3 scripts/staging-anonimizar/correr.py ensayo                 # 1 la batería entera en BEGIN … ROLLBACK
python3 scripts/staging-anonimizar/correr.py ensayo --idempotencia  # 2 dos pasadas, ROLLBACK
python3 scripts/staging-anonimizar/correr.py real --si              # 3 COMMIT (con el OK del dueño)
bash scripts/staging-anonimizar/storage.sh && bash scripts/staging-anonimizar/storage.sh --si
python3 scripts/staging-anonimizar/correr.py verificar              # 5 todo lo exigido en 0
```
Después de un re-clonado, antes del paso 0: `scripts/sql/club_marcar_staging.sql` (el clonado trae `club_entorno` vacía
de prod), `crear.sh` y `neutralizar-copias.sql`. `cadena.sh --si` hace todo eso en orden y para en el primer error.

`--armar` imprime el SQL **sin** la marca de ref: pegado en el SQL Editor (o en otro proyecto) la guarda lo frena. Para
usarlo a mano hay que escribir la marca a propósito, después de leer el ref en pantalla (regla 7).

## Si la Management API corta por tiempo (30 s)
Un corte deja la duda de si el servidor llegó al `COMMIT` antes de que se cerrara la conexión. **Antes de reintentar,
correr `correr.py verificar`:**
- si da verde, la anonimización quedó hecha: no se reintenta; se sigue con `storage.sh`;
- si cae con «ANON-VERIFICAR-FALLA», no quedó nada (es una transacción): se reintenta una vez; si vuelve a cortar, se
  para y se trae al coordinador (no se parte el script a mano).

Con un volumen como el de staging, en local: real ≈ 7 s, ensayo ≈ 10 s, ensayo con idempotencia ≈ 13 s.

## Si aborta antes de tocar nada
- «clasificación incompleta»: apareció una columna de texto o JSON nueva → agregarla a `clasificacion.sql` con su clase.
- «texto libre que no es de catálogo en mesas o productos»: `correr.py formas` muestra por columna las formas (catálogo,
  código, número, lugar conocido, texto libre) y las claves de los JSON de productos, sin valores. Se decide la clase de
  lo que aparezca antes de seguir.

## Decisiones para que el dueño confirme
1. **Plantillas fijas de caja:** las descripciones que arma el sistema se conservan (`Ventas efectivo <turno> <fecha>`,
   `Ventas del día <fecha>`, `Apertura pozo <fecha>`, `Retiro dueños a banco <fecha>`, `Propinas turno <fecha> <turno>`, y
   `Ajuste de cierre <fecha> · Sobrante|Faltante` con su motivo cambiado por «Nota de prueba»). El cierre las busca por
   texto (071/074, `cash.ts`, `borrarDia.ts`); no tienen texto libre. Todo el resto del texto libre pasa a «Nota de prueba»
   (con su «· fact AAAA-MM-DD», regla 11).
2. **`ventas_hist` pasa a lista blanca** (D4): de `data` quedan solo los totales del día de `HistDay`
   (`src/shared/types/ventas.ts`): `ventaBruta`, `ventaNeta`, `iva`, `serv`, `salon`, `delivery`, `pax`, `promPax`, `source`.
   Cualquier otra clave se borra.
3. **Negocios del Club → «Cliente NN»:** `club_negocios.nombre` usa el prefijo de clientes (la spec lista cuatro: Empleado,
   Proveedor, Socio, Cliente).

## Lo que no limpia
Los logs de la plataforma (API, Postgres, Auth, Edge, Storage) de Supabase, los respaldos automáticos de staging anteriores
a la corrida y la carpeta local `.staging-backups/` de quien clonó (borrarla a mano).

## Pruebas
- Local, sin staging: `PGHOST=/tmp PGPORT=5499 PGUSER=pgv bash scripts/sql/local_armar_base.sh anon_local`, después
  `PGDATABASE=anon_local python3 scripts/staging-anonimizar/correr.py ensayo --local [--idempotencia]` (semilla inventada)
  y `python3 scripts/sql/anonimizar_staging_mutaciones.py` (cada arreglo deshecho tiene que hacer caer la batería).
- `npx vitest run scripts/staging-anonimizar`: reglas puras, sincronía con el SQL, clasificación y `--armar`.
