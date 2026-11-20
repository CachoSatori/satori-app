#!/usr/bin/env python3
"""
Anonimización de STAGING (docs/specs/SPEC-anonimizar-staging.md). Arma los fragmentos de scripts/staging-anonimizar/ en
UNA transacción y la manda por la Management API al ref FIJO de staging. Nunca prod: el ref está escrito acá y la guarda
SQL (comun.sql) lo exige además de club_entorno = 'staging' y los usuarios de prueba.

  python3 scripts/staging-anonimizar/correr.py ensayo [--idempotencia]   # batería entera en BEGIN … ROLLBACK (no deja nada)
  python3 scripts/staging-anonimizar/correr.py real --si                 # BEGIN … anonimizar + verificar … COMMIT
  python3 scripts/staging-anonimizar/correr.py verificar                 # solo conteos (después de storage.sh)
  Agregar --local para el Postgres 16 local (psql; PGHOST/PGPORT/PGUSER/PGDATABASE del entorno: local_armar_base.sh) y
  --armar para solo imprimir el SQL armado (no conecta; sirve para el SQL Editor o el MCP).

Orden en staging (STAGING.md, «Anonimizar»): ensayo → ensayo --idempotencia → real --si → storage.sh --si → verificar.
«real» escribe para siempre: lo corre el coordinador con el OK del dueño por chat (D5 de SPEC-staging-agentes).
Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN). Sale 1 ante cualquier ANON-ABORTA / -FALLA / -FALLAN.
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.error, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging. Prod (yiczgdtirrkdvohdquzf) no se nombra en ninguna URL de este script.
RAIZ = Path(__file__).resolve().parents[2]
# ANON_DIR_MUTADO: copia con un arreglo deshecho a propósito (scripts/sql/anonimizar_staging_mutaciones.py). Solo --local.
DIR = Path(os.environ.get('ANON_DIR_MUTADO') or Path(__file__).resolve().parent)
BATERIA = RAIZ / 'scripts/sql/anonimizar_staging_pruebas.sql'
SEMILLA = RAIZ / 'scripts/sql/anonimizar_staging_semilla_local.sql'
CASOS_LOCAL = RAIZ / 'scripts/sql/anonimizar_staging_casos_local.sql'
assert REF == 'hwiatgicyyqyezqwldia', 'ABORT: este script es solo para staging'


def frag(nombre: str) -> str:
    return (DIR / nombre).read_text(encoding='utf-8')


def marcas(modo: str, fase: str, idem: bool = False) -> str:
    return (f"select set_config('anon.ref', '{REF}', true);\n"
            f"select set_config('anon.modo', '{modo}', true);\n"
            f"select set_config('anon.fase', '{fase}', true);\n"
            f"select set_config('anon.idempotencia', '{'si' if idem else 'no'}', true);\n")


def armar_ensayo(local: bool, idem: bool) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    rellenos = {
        '@@PREPARAR@@': marcas('ensayo', 'transaccion', idem) + (SEMILLA.read_text(encoding='utf-8') if local else ''),
        '@@CLASIFICACION@@': frag('clasificacion.sql'),
        '@@COMUN@@': frag('comun.sql'),
        '@@ANONIMIZAR@@': frag('anonimizar.sql'),
        '@@VERIFICAR@@': frag('verificar.sql'),
        '@@IDEMPOTENCIA@@': frag('anonimizar.sql') if idem else '',
        '@@LOCAL@@': CASOS_LOCAL.read_text(encoding='utf-8') if local else '',
    }
    for marca, cuerpo in rellenos.items():
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'.*$', lambda _: cuerpo, sql)
        if n != 1:
            sys.exit(f'{BATERIA.name}: falta el marcador «-- {marca}» (o está repetido)')
    return sql


def armar_real() -> str:
    return ('begin;\n' + marcas('real', 'transaccion') + frag('clasificacion.sql') + frag('comun.sql')
            + frag('anonimizar.sql') + frag('verificar.sql') + 'commit;\n')


def armar_verificar() -> str:
    # Solo tablas y funciones temporales; termina en ROLLBACK igual (nada que guardar).
    return ('begin;\n' + marcas('verificar', 'final') + frag('clasificacion.sql') + frag('comun.sql')
            + frag('verificar.sql') + 'rollback;\n')


def staging_crudo(sql: str) -> object:
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def staging(sql: str) -> object:
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        cuerpo = e.read().decode('utf-8', 'replace')
        m = re.search(r'ANON-[A-Z]+(?:-[A-Z]+)?: [^"\\]*', cuerpo)
        print(m.group(0) if m else f'ERROR {e.code}: {cuerpo[:800]}')
        sys.exit(1)


def local(sql: str, una_transaccion: bool = False) -> str:
    cmd = ['psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'] + (['-1'] if una_transaccion else [])
    p = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    for l in p.stderr.splitlines():
        if 'ANON FALLA' in l or 'ANON RESUMEN' in l:
            print('   ', l.split('WARNING:  ')[-1].split('NOTICE:  ')[-1][:500])
    if p.returncode != 0:
        m = re.search(r'ANON-[A-Z]+(?:-[A-Z]+)?: [^\n]*', p.stderr)
        print(m.group(0) if m else f'ERROR: {p.stderr[-1500:]}')
        sys.exit(1)
    return p.stdout


def main() -> None:
    args = sys.argv[1:]
    modo = args[0] if args and not args[0].startswith('-') else ''
    es_local, solo_armar, idem = '--local' in args, '--armar' in args, '--idempotencia' in args
    if modo == 'ensayo':
        sql = armar_ensayo(es_local, idem)
    elif modo == 'real':
        if '--si' not in args and not solo_armar:
            sys.exit('«real» escribe en staging para siempre: agregar --si (y tener el OK del dueño por chat).')
        sql = armar_real()
    elif modo == 'verificar':
        sql = armar_verificar()
    else:
        sys.exit(__doc__)
    if os.environ.get('ANON_DIR_MUTADO') and not es_local:
        sys.exit('ANON_DIR_MUTADO (código mutado) solo vale con --local')
    if solo_armar:
        print(sql)
        return
    if es_local:
        salida = local(sql)
        for l in salida.splitlines():
            if l.startswith('[{') and modo == 'ensayo':
                for c in json.loads(l):
                    print(('ok    ' if c['ok'] else 'FALLA ') + c['caso'] + (f" · {c['detalle']}" if c.get('detalle') and not c['ok'] else ''))
            elif modo != 'ensayo' and '|' in l:
                print('   ', l)
        print(f'anonimizar {modo} (local): verde')
        return
    out = staging(sql)
    print(json.dumps(out, ensure_ascii=False, indent=1)[:8000])
    if modo == 'real':
        # pg_stat_statements no es transaccional: se reinicia recién después del COMMIT (SPEC §1, «fuera de public»).
        # Si falla, la anonimización ya quedó confirmada: se avisa y se reintenta a mano, no se marca la corrida en rojo.
        try:
            staging_crudo('select extensions.pg_stat_statements_reset();')
            print('pg_stat_statements reiniciado')
        except Exception as e:   # noqa: BLE001 — solo para el aviso
            print(f'AVISO: no se pudo reiniciar pg_stat_statements ({type(e).__name__}); correrlo a mano en staging')
    print(f'anonimizar {modo} (staging {REF}): verde')


if __name__ == '__main__':
    main()
