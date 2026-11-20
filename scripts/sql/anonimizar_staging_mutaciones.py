#!/usr/bin/env python3
"""
Pruebas que muerden (satori-estandar-pr §4) del script de anonimización de staging: cada mutación copia
scripts/staging-anonimizar/ a una carpeta temporal, deshace UN arreglo a propósito (reemplazo de texto que tiene que
aparecer exactamente una vez) y corre la batería LOCAL (correr.py ensayo --local con ANON_DIR_MUTADO). La mutación muerde
si la batería cae y caen, por lo menos, los casos esperados (o aborta con el mensaje esperado). Sale 1 si alguna no muerde.

  PGHOST=/tmp PGPORT=5499 PGUSER=pgv bash scripts/sql/local_armar_base.sh anon_local
  PGHOST=/tmp PGPORT=5499 PGUSER=pgv PGDATABASE=anon_local python3 scripts/sql/anonimizar_staging_mutaciones.py [NOMBRE…]
Solo la base Postgres LOCAL (nunca staging ni prod): correr.py rechaza ANON_DIR_MUTADO sin --local.
"""
from __future__ import annotations
import os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
ORIGEN = RAIZ / 'scripts/staging-anonimizar'

# nombre: (archivo, texto de antes, texto mutado, casos que tienen que caer, o 'ABORTA:<texto>')
MUTACIONES: dict[str, tuple[str, str, str, list[str] | str]] = {
    'descripcion_libre': ('comun.sql', "    else 'Nota de prueba' || coalesce(' · fact '", "    else v || coalesce(' · fact '",
                          ['01', '15', 'L04']),
    'telefono_real': ('anonimizar.sql', "update public.%1$I t set %2$I = m.nuevo from _anon_tel m",
                      "update public.%1$I t set %2$I = t.%2$I from _anon_tel m", ['01', 'L06', 'L07']),
    'clave_fe_intacta': ('comun.sql', "then substr(v, 1, 9) || '999999999999' || substr(v, 22)", "then v",
                         ['01', '16', 'L08', 'L13']),
    'auth_sin_saneo': ('anonimizar.sql', " where not pg_temp.anon_usuario_prueba(u.email)\n   and (u.email is distinct from",
                       " where false and not pg_temp.anon_usuario_prueba(u.email)\n   and (u.email is distinct from", ['01', 'L09']),
    'json_sin_lista_blanca': ('anonimizar.sql', "                join _anon_json_claves p on p.clave = e.k);",
                              "                left join _anon_json_claves p on p.clave = e.k);", ['01', '14', 'L05', 'L14']),
    'alias_sin_minusculas': ('comun.sql', "$$ select lower(btrim(v)) $$;", "$$ select btrim(v) $$;", ['L01', 'L02']),
    'guarda_sin_ref': ('comun.sql', "  if current_setting('anon.ref', true) is distinct from 'hwiatgicyyqyezqwldia' then",
                       "  if false then", ['07']),
    'llaves_iguales': ('anonimizar.sql', "    when v ~ '^[0-9a-f]+$' then pg_temp.anon_azar('0123456789abcdef', length(v))",
                       "    when v ~ '^[0-9a-f]+$' then v", ['01', 'L06']),
    'sin_vaciar': ('anonimizar.sql', "    execute format('truncate public.%I', r.tabla);", "    null;", ['01', 'L10']),
    'seudonimo_real': ('anonimizar.sql', "  return 'S' || substr(md5((select sal from _anon_sal) || v), 1, 16);", "  return v;",
                       ['01', 'L06']),
    'cadena_sin_rehash': ('anonimizar.sql', "  if to_regclass('public.club_reportes_cerrados') is null then return 0; end if;",
                          "  return 0;", ['01', '13', 'L12']),
    'sueldo_toca_caja': ('anonimizar.sql', "-- 7c. Cumpleaños de clientes",
                         "update public.cash_movements set amount_crc = amount_crc + 1 where true;\n-- 7c. Cumpleaños de clientes",
                         'ABORTA:ANON-ABORTA: cambió un control del §2'),
    'columna_nueva_sin_clase': ('clasificacion.sql', "  ('cash_sessions', 'notes', 'nota'),\n", "",
                                'ABORTA:ANON-ABORTA: clasificación incompleta'),
}


def correr(dir_mutado: Path) -> tuple[int, str]:
    env = dict(os.environ, ANON_DIR_MUTADO=str(dir_mutado))
    p = subprocess.run([sys.executable, str(ORIGEN / 'correr.py'), 'ensayo', '--local'], env=env,
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def main() -> None:
    pedidas = sys.argv[1:] or list(MUTACIONES)
    mal = []
    for nombre in pedidas:
        archivo, antes, despues, espera = MUTACIONES[nombre]
        with tempfile.TemporaryDirectory() as tmp:
            dst = Path(tmp) / 'staging-anonimizar'
            shutil.copytree(ORIGEN, dst)
            texto = (dst / archivo).read_text(encoding='utf-8')
            if texto.count(antes) != 1:
                print(f'NO APLICA {nombre}: el texto de antes aparece {texto.count(antes)} veces en {archivo}')
                mal.append(nombre); continue
            (dst / archivo).write_text(texto.replace(antes, despues), encoding='utf-8')
            rc, out = correr(dst)
        if isinstance(espera, str):
            esperado = espera.split(':', 1)[1]
            muerde = rc != 0 and esperado in out
            print(f"{'muerde   ' if muerde else 'NO MUERDE'} {nombre}: {'aborta con «' + esperado + '»' if muerde else out[-300:]}")
        else:
            m = re.search(r'ANON-FALLAN: ([^ ]+) ·', out)
            caen = m.group(1).split(',') if m else []
            faltan = [c for c in espera if c not in caen]
            muerde = rc != 0 and not faltan
            print(f"{'muerde   ' if muerde else 'NO MUERDE'} {nombre}: caen {len(caen)} ({','.join(caen)})"
                  + (f' · faltó que cayeran {faltan}' if faltan else ''))
        if not muerde:
            mal.append(nombre)
    if mal:
        sys.exit(f'mutaciones que no muerden: {mal}')
    print(f'todas muerden ({len(pedidas)})')


if __name__ == '__main__':
    main()
