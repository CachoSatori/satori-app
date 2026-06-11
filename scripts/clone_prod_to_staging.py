#!/usr/bin/env python3
"""
Clona TODOS los datos de PROD → STAGING (espejo) vía Supabase Management API.

GUARDRAILS (no tocar):
  · PROD (yiczgdtirrkdvohdquzf) es SOLO LECTURA: cada query a prod se valida
    que empiece con SELECT/WITH; cualquier otra cosa aborta el proceso.
  · TODA escritura va exclusivamente a STAGING (hwiatgicyyqyezqwldia): la
    función de escritura ABORTA si el ref no es el de staging.
  · Requiere SUPABASE_ACCESS_TOKEN en el entorno (no se hardcodea).
  · Pide --yes explícito antes de truncar staging.

Qué hace:
  1. Backup lógico corto de staging (conteos + profiles + auth.users) en .staging-backups/
  2. TRUNCATE CASCADE de todas las tablas public de staging
  3. Copia auth.users de prod (solo columnas insertables, ON CONFLICT DO NOTHING)
  4. Copia todas las tablas public en orden topológico de FKs, con triggers
     desactivados por sesión (session_replication_role=replica) para no duplicar
     stock (trg_update_stock) ni crear perfiles fantasma (on_auth_user_created)
  5. Restaura el owner de staging (satorisushibar@gmail.com) y cualquier
     auth.user de staging sin perfil
  6. Re-sincroniza secuencias de public (setval) — hoy no hay (PKs uuid)
  7. VERIFICA: conteos por tabla prod vs staging + 3 spot-checks financieros

NO clona: Storage (bucket documents — las fotos no estarán en staging) ni auth
config (ya difiere a propósito: autoconfirm/site_url).
"""
import json, os, subprocess, sys, time
from datetime import datetime, timezone

PROD_REF = "yiczgdtirrkdvohdquzf"   # SOLO LECTURA
STG_REF  = "hwiatgicyyqyezqwldia"   # único destino de escritura
OWNER_EMAIL = "satorisushibar@gmail.com"
TAG = "$satori_clone$"

TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
if not TOKEN:
    sys.exit("ABORT: falta SUPABASE_ACCESS_TOKEN en el entorno.")
if STG_REF == PROD_REF:
    sys.exit("ABORT: refs mal configurados.")

def _api(ref, sql):
    out = subprocess.run(["curl", "-s", "-X", "POST",
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        "-H", f"Authorization: Bearer {TOKEN}", "-H", "Content-Type: application/json",
        "-d", json.dumps({"query": sql})], capture_output=True, text=True).stdout
    try:
        data = json.loads(out)
    except Exception:
        sys.exit(f"ABORT: respuesta no-JSON de {ref}: {out[:300]}")
    if isinstance(data, dict) and ("error" in data or "message" in data):
        sys.exit(f"ABORT: error SQL en {ref}: {json.dumps(data)[:500]}\nSQL: {sql[:300]}")
    return data

def read_prod(sql):
    """Lectura de prod — rechaza cualquier sentencia que no sea SELECT/WITH."""
    head = sql.lstrip().lower()
    if not (head.startswith("select") or head.startswith("with")):
        sys.exit(f"ABORT: intento de NO-SELECT contra PROD bloqueado: {sql[:120]}")
    return _api(PROD_REF, sql)

def read_prod_raw(sql):
    """Como read_prod pero devuelve el body crudo (para re-inyectar sin perder precisión numérica)."""
    head = sql.lstrip().lower()
    if not (head.startswith("select") or head.startswith("with")):
        sys.exit(f"ABORT: intento de NO-SELECT contra PROD bloqueado: {sql[:120]}")
    out = subprocess.run(["curl", "-s", "-X", "POST",
        f"https://api.supabase.com/v1/projects/{PROD_REF}/database/query",
        "-H", f"Authorization: Bearer {TOKEN}", "-H", "Content-Type: application/json",
        "-d", json.dumps({"query": sql})], capture_output=True, text=True).stdout
    return out

def write_stg(sql):
    """Escritura — SOLO contra staging."""
    assert STG_REF == "hwiatgicyyqyezqwldia", "ABORT: ref de staging inesperado"
    return _api(STG_REF, sql)

def main():
    if "--yes" not in sys.argv:
        sys.exit(f"Esto TRUNCA staging ({STG_REF}) y lo recarga desde prod (solo lectura).\n"
                 f"Re-ejecutá con --yes para confirmar.")
    t0 = time.time()
    print(f"ORIGEN  (lectura): {PROD_REF}")
    print(f"DESTINO (escritura): {STG_REF}")

    # ── 1. Backup corto de staging ──
    tabs = [r["table_name"] for r in write_stg(
        "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")]
    counts_sql = " union all ".join(f"select '{t}' tabla, count(*) n from public.{t}" for t in tabs)
    backup = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "counts": write_stg(counts_sql),
        "profiles": write_stg("select * from public.profiles"),
        "auth_users": write_stg("select id, email, created_at from auth.users"),
    }
    os.makedirs(".staging-backups", exist_ok=True)
    bpath = f".staging-backups/staging-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    json.dump(backup, open(bpath, "w"), ensure_ascii=False, default=str)
    print(f"Backup corto de staging → {bpath}")

    # ── 2. TRUNCATE de todo public en staging ──
    write_stg("truncate table " + ", ".join(f"public.{t}" for t in tabs) + " cascade;")
    print(f"TRUNCATE de {len(tabs)} tablas public en staging ✓")

    # ── 3. auth.users + auth.identities de prod (columnas insertables; triggers OFF) ──
    # Usuarios de staging que chocan por email con prod (id distinto) se reemplazan
    # por la versión de prod → el login de staging usa las credenciales de PROD.
    for authtab in ("users", "identities"):
        cols = ", ".join(r["column_name"] for r in read_prod(
            f"select column_name from information_schema.columns where table_schema='auth' and table_name='{authtab}' and is_generated='NEVER' order by ordinal_position"))
        raw = read_prod_raw(f"select coalesce(jsonb_agg(x), '[]'::jsonb) from (select {cols} from auth.{authtab}) x")
        parsed = json.loads(raw)
        start = raw.find('[', raw.find('"coalesce"'))
        end = raw.rfind(']', 0, raw.rfind(']'))
        payload = raw[start:end + 1]
        if TAG in payload: sys.exit("ABORT: tag de dollar-quoting presente en los datos")
        pre = ""
        if authtab == "users":
            pre = (f"delete from auth.users s using jsonb_populate_recordset(null::auth.users, {TAG}{payload}{TAG}::jsonb) p\n"
                   f"  where s.email = p.email and s.id <> p.id;\n")
        write_stg(f"set session_replication_role = replica;\n{pre}"
                  f"insert into auth.{authtab} ({cols})\n"
                  f"select {cols} from jsonb_populate_recordset(null::auth.{authtab}, {TAG}{payload}{TAG}::jsonb)\n"
                  f"on conflict do nothing;")
        print(f"auth.{authtab}: {len(parsed[0]['coalesce'])} filas de prod copiadas ✓")

    # ── 4. Tablas public en orden topológico de FKs ──
    fks = write_stg("""select rel.relname t, frel.relname ref from pg_constraint c
        join pg_class rel on rel.oid=c.conrelid join pg_class frel on frel.oid=c.confrelid
        join pg_namespace n on n.oid=rel.relnamespace
        where n.nspname='public' and c.contype='f' and rel.relname<>frel.relname group by 1,2""")
    deps = {t: set() for t in tabs}
    for fk in fks:
        if fk["ref"] in deps: deps[fk["t"]].add(fk["ref"])
    order, placed = [], set()
    while len(order) < len(tabs):
        ready = [t for t in tabs if t not in placed and deps[t] <= placed]
        if not ready: sys.exit(f"ABORT: ciclo de FKs sin resolver: {set(tabs)-placed}")
        order += sorted(ready); placed |= set(ready)

    pks = {r["t"]: r["cols"] for r in write_stg("""
        select rel.relname t, string_agg(a.attname, ',' order by k.ord) cols
        from pg_constraint c
        join pg_class rel on rel.oid=c.conrelid join pg_namespace n on n.oid=rel.relnamespace
        cross join lateral unnest(c.conkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid=rel.oid and a.attnum=k.attnum
        where n.nspname='public' and c.contype='p' group by rel.relname""")}

    total_rows = 0
    for t in order:
        avg = read_prod(f"select coalesce(avg(pg_column_size(x.*)),100)::int b, count(*) n from public.{t} x")[0]
        n, page = avg["n"], max(20, min(500, 250_000 // (avg["b"] + 1)))
        if n == 0:
            print(f"  {t:26s} 0 filas"); continue
        ob = f"order by {pks[t]}" if t in pks else ""
        copied = 0
        for off in range(0, n, page):
            raw = read_prod_raw(f"select coalesce(jsonb_agg(x), '[]'::jsonb) from (select * from public.{t} {ob} limit {page} offset {off}) x")
            parsed = json.loads(raw)
            if not (isinstance(parsed, list) and parsed and "coalesce" in parsed[0]):
                sys.exit(f"ABORT: respuesta inesperada al leer {t}: {raw[:300]}")
            rows = len(parsed[0]["coalesce"])
            if rows == 0: continue
            # La API devuelve [{"coalesce": [...]}]. Extraemos el array CRUDO del body
            # (sin re-serializar por json de Python) para no perder precisión numérica.
            start = raw.find('[', raw.find('"coalesce"'))
            end = raw.rfind(']', 0, raw.rfind(']'))  # el ']' del array, no el del envelope
            payload = raw[start:end + 1]
            if TAG in payload: sys.exit("ABORT: tag de dollar-quoting presente en los datos")
            write_stg(f"set session_replication_role = replica;\n"
                      f"insert into public.{t} select * from jsonb_populate_recordset(null::public.{t}, {TAG}{payload}{TAG}::jsonb);")
            copied += rows
        total_rows += copied
        print(f"  {t:26s} {copied} filas ✓")

    # ── 5. Owner de staging + auth.users sin perfil ──
    write_stg(f"""set session_replication_role = replica;
insert into public.profiles (id, full_name, email, role, is_active)
select u.id,
       coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1)),
       u.email,
       case when u.email = '{OWNER_EMAIL}' then 'owner'::user_role else 'salonero'::user_role end,
       (u.email = '{OWNER_EMAIL}')
from auth.users u left join public.profiles p on p.id = u.id
where p.id is null;""")
    owner = write_stg(f"select email, role, is_active from public.profiles where email='{OWNER_EMAIL}'")
    if not (owner and owner[0]["role"] == "owner" and owner[0]["is_active"]):
        write_stg(f"update public.profiles set role='owner', is_active=true where email='{OWNER_EMAIL}';")
    print(f"Owner de staging preservado: {OWNER_EMAIL} (role=owner, activo) ✓")

    # ── 6. Secuencias de public ──
    seqs = write_stg("""select s.sequencename, t.relname tab, a.attname col
        from pg_sequences s
        join pg_class sc on sc.relname=s.sequencename
        join pg_depend d on d.objid=sc.oid and d.deptype='a'
        join pg_class t on t.oid=d.refobjid
        join pg_attribute a on a.attrelid=t.oid and a.attnum=d.refobjsubid
        where s.schemaname='public'""")
    for s in seqs:
        write_stg(f"select setval('public.{s['sequencename']}', coalesce((select max({s['col']}) from public.{s['tab']}), 1));")
    print(f"Secuencias re-sincronizadas: {len(seqs)}")

    # ── 7. VERIFICACIÓN ──
    print("\n── VERIFICACIÓN: conteos prod vs staging ──")
    pc = {r["tabla"]: r["n"] for r in read_prod(counts_sql)}
    sc = {r["tabla"]: r["n"] for r in write_stg(counts_sql)}
    ok = True
    for t in sorted(pc):
        extra = sc.get(t, 0) - pc[t]
        mark = "✓" if extra == 0 else ("✓ (+%d extra de staging: owner/usuarios sin par en prod)" % extra if t == "profiles" and extra > 0 else "✗ MISMATCH")
        if mark.startswith("✗"): ok = False
        print(f"  {t:26s} prod={pc[t]:<6} stg={sc.get(t,0):<6} {mark}")

    CHECKS = {
        "ventas netas mayo 2026 (₡)": """select round(sum((s.value->>'total')::numeric),2) v
            from public.ventas_dias, jsonb_each(data->'saloneros') s
            where session_date >= '2026-05-01' and session_date < '2026-06-01'""",
        "count tip_entries": "select count(*) v from public.tip_entries",
        "saldo Caja Fuerte hoy (₡)": """select round(sum(case
              when movement_type='ingreso' then amount_crc
              when movement_type='traspaso' then case when description ~* '→\\s*caja fuerte' then amount_crc else -amount_crc end
              else -amount_crc end),2) v
            from public.cash_movements where caja_origen='Caja Fuerte' and status <> 'pendiente'""",
    }
    print("── VERIFICACIÓN: spot-checks financieros (misma SQL en ambos) ──")
    for name, sql in CHECKS.items():
        vp, vs = read_prod(sql)[0]["v"], write_stg(sql)[0]["v"]
        mark = "✓" if vp == vs else "✗ MISMATCH"
        if vp != vs: ok = False
        print(f"  {name:34s} prod={vp}  stg={vs}  {mark}")

    print(f"\n{'ESPEJO OK' if ok else 'FALLÓ LA VERIFICACIÓN'} — {total_rows} filas copiadas en {time.time()-t0:.0f}s")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
