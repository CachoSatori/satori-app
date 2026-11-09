#!/usr/bin/env python3
"""Pruebas del filtro de G-56 con análisis real del SQL (scripts/club/sql_g56.py). Sin datos reales: todo ficticio.

  python3 -m unittest scripts/club/test_sql_g56.py -v
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import saldos_papel as sp  # noqa: E402
from sql_g56 import revisar, tokenizar  # noqa: E402

LOCAL = 'local-prueba'


def tx(cuerpo: str) -> str:
    """Envuelve un trozo en la transacción que exige el filtro."""
    return "begin;\nset local lock_timeout = '5s';\n" + cuerpo + "\ncommit;\n"


# Copia LITERAL del filtro viejo (regex sobre el texto crudo) de saldos_papel.py, tal como estaba el 08-nov. Está acá
# para dejar documentado que los 4 archivos trucados de la auditoría lo pasaban, aunque saldos_papel ya no lo use.
_PROHIBIDAS_VIEJO = ('delete', 'truncate', 'drop', 'update', 'alter', 'grant', 'revoke')
_RE_OK_VIEJO = re.compile(r'^(begin|commit|rollback|set\s+local\s|do\s|insert\s+into\s+public\.club_[a-z_]+)', re.I)


def _filtrar_viejo(sql: str) -> list[str]:
    limpio = re.sub(r"'(?:[^']|'')*'", "''", sql)
    limpio = re.sub(r'--[^\n]*', '', limpio)
    partes, actual, dentro = [], [], False
    for trozo in re.split(r'(\$\$|;)', limpio):
        if trozo == '$$':
            dentro = not dentro; actual.append(trozo)
        elif trozo == ';' and not dentro:
            partes.append(''.join(actual).strip()); actual = []
        else:
            actual.append(trozo)
    if ''.join(actual).strip():
        partes.append(''.join(actual).strip())
    out = [f'palabra prohibida: {w}' for w in _PROHIBIDAS_VIEJO if re.search(rf'\b{w}\b', limpio, re.I)]
    out += ['sentencia no permitida' for s in partes if s and not _RE_OK_VIEJO.match(s)]
    return out


# ── Los 4 archivos trucados de la auditoría (08-nov) ─────────────────────────
TRUCADO_1_COMENTARIO_CON_COMILLA = """begin;
-- it's a note
delete from public.club_movimientos;
insert into public.club_movimientos (nota) values ('ok');
commit;
"""
TRUCADO_2_EXECUTE_EN_DO = """begin;
do $$ begin execute 'delete from public.club_movimientos'; end $$;
commit;
"""
TRUCADO_2B_EXECUTE_CONCATENADO = """begin;
do $$ begin execute 'del' || 'ete from public.club_movimientos'; end $$;
commit;
"""
TRUCADO_3_REPLICATION_ROLE = """begin;
set local session_replication_role = replica;
insert into public.club_movimientos (nota) values ('x');
commit;
"""
TRUCADO_4_OTRA_TABLA = """begin;
insert into public.club_entorno (nombre) values ('prod');
commit;
"""
TRUCADOS = {
    '1 comentario con comilla': TRUCADO_1_COMENTARIO_CON_COMILLA,
    '2 execute en do': TRUCADO_2_EXECUTE_EN_DO,
    '2b execute concatenado': TRUCADO_2B_EXECUTE_CONCATENADO,
    '3 session_replication_role': TRUCADO_3_REPLICATION_ROLE,
    '4 insert en club_entorno': TRUCADO_4_OTRA_TABLA,
}


class SqlGenerado(unittest.TestCase):
    """El SQL que arma saldos_papel tiene que pasar (se usan sus funciones, no texto copiado)."""

    def setUp(self):
        self.filas, self.previo = sp.ficticios(4, LOCAL)

    def test_carga_y_ensayo_pasan(self):
        for entorno in ('staging', 'prod'):
            for fecha in getattr(sp, 'FECHAS', ('carga',)):
                with self.subTest(entorno=entorno, fecha=fecha):
                    self.assertEqual(revisar(sp.sql_carga(self.filas, LOCAL, entorno, fecha)), [])
                    self.assertEqual(revisar(sp.sql_ensayo(self.filas, LOCAL, entorno, '', fecha)), [])

    def test_carga_desde_csv_validado(self):
        filas, errores = sp.validar(sp.a_csv(self.filas))
        self.assertEqual(errores, [])
        self.assertEqual(revisar(sp.sql_carga(filas, LOCAL, 'prod')), [])

    def test_ensayo_con_ficticios_solo_con_el_permiso_explicito(self):
        sql = sp.sql_ensayo(self.filas, LOCAL, 'staging', self.previo)
        self.assertEqual(revisar(sql, permitir_extra='alta_ficticios'), [])
        malos = revisar(sql)
        self.assertTrue(any('public.club_miembros' in m for m in malos), malos)

    def test_permiso_ficticios_admite_un_solo_alta(self):
        sql = sp.sql_ensayo(self.filas, LOCAL, 'staging', self.previo + self.previo)
        self.assertTrue(revisar(sql, permitir_extra='alta_ficticios'))

    def test_extra_desconocido(self):
        with self.assertRaises(ValueError):
            revisar('begin; commit;', permitir_extra='cualquiera')


class Trucados(unittest.TestCase):
    def test_el_filtro_viejo_los_dejaba_pasar(self):
        for nombre, sql in TRUCADOS.items():
            with self.subTest(nombre):
                self.assertEqual(_filtrar_viejo(sql), [], 'el filtro viejo ya lo rechazaba: el caso no prueba nada')

    def test_el_nuevo_los_rechaza(self):
        for nombre, sql in TRUCADOS.items():
            with self.subTest(nombre):
                self.assertTrue(revisar(sql), nombre)

    def test_motivos(self):
        self.assertIn('palabra prohibida «delete»', ' '.join(revisar(TRUCADO_1_COMENTARIO_CON_COMILLA)))
        self.assertIn('«execute»', ' '.join(revisar(TRUCADO_2_EXECUTE_EN_DO)))
        self.assertIn('session_replication_role', ' '.join(revisar(TRUCADO_3_REPLICATION_ROLE)))
        self.assertIn('public.club_entorno', ' '.join(revisar(TRUCADO_4_OTRA_TABLA)))

    def test_mensajes_sin_contenido_de_literales(self):
        sql = tx("insert into public.club_entorno (nombre) values ('DATO-SECRETO-123');")
        self.assertNotIn('DATO-SECRETO-123', ' '.join(revisar(sql)))


class Casos(unittest.TestCase):
    def rechaza(self, sql, *contiene):
        malos = revisar(sql)
        self.assertTrue(malos, sql)
        for c in contiene:
            self.assertIn(c, ' '.join(malos))

    def pasa(self, sql, **kw):
        self.assertEqual(revisar(sql, **kw), [], sql)

    def test_dollar_tag_distinto(self):
        self.rechaza(tx("do $x$ begin execute 'select 1'; end $x$;"), 'execute')
        self.pasa(tx("do $x$ begin if 1 = 2 then raise exception 'no'; end if; end $x$;"))

    def test_dollar_tag_dentro_de_otro(self):
        # $$ dentro de un cuerpo $x$ es texto del cuerpo: el cuerpo se vuelve a tokenizar y ahí aparece el delete
        self.rechaza(tx("do $x$ begin raise exception $$ok$$; delete from public.club_movimientos; end $x$;"), 'delete')

    def test_comentario_de_bloque_anidado(self):
        # /* /* */ delete */: para Postgres el delete sigue dentro del comentario (anidado) → no es código
        self.pasa(tx("/* afuera /* adentro */ delete from public.club_movimientos; */ "
                     "insert into public.club_movimientos (nota) values ('x');"))
        # y al revés: un tokenizador sin anidamiento creería que el comentario termina en el primer */
        self.rechaza(tx("/* a /* b */ c */ delete from public.club_movimientos;"), 'delete')

    def test_comentario_de_bloque_con_comilla(self):
        self.rechaza(tx("/* ' */ delete from public.club_movimientos; -- '"), 'delete')

    def test_comentario_sin_cerrar(self):
        self.rechaza(tx("/* nunca cierra"), 'sin cerrar')

    def test_e_string_con_barra(self):
        # E'a\'b' es UN literal (a'b); el delete que sigue es código
        self.rechaza(tx("insert into public.club_movimientos (nota) values (E'a\\'b'); delete from public.club_movimientos;"),
                     'delete')
        # y un delete DENTRO del E'…' es dato
        self.pasa(tx("insert into public.club_movimientos (nota) values (E'a\\'b; delete from x');"))

    def test_barra_en_literal_estandar(self):
        self.rechaza(tx("insert into public.club_movimientos (nota) values ('a\\');"), 'barra invertida')

    def test_with_que_modifica(self):
        self.rechaza(tx("with x as (delete from public.club_movimientos returning *) "
                        "insert into public.club_movimientos select * from x;"), 'with')

    def test_set_config_despues_del_insert(self):
        self.rechaza(tx("insert into public.club_movimientos (nota) values ('x'); "
                        "select set_config('club.libro_mantenimiento', 'migracion', true);"), 'set_config')

    def test_perform_en_do(self):
        self.rechaza(tx("do $$ begin perform 1; end $$;"), 'perform')

    def test_set_sin_local(self):
        self.rechaza(tx("set statement_timeout = '1min';"), 'set no permitido')

    def test_set_local_otro_parametro(self):
        self.rechaza(tx("set local work_mem = '1GB';"), 'work_mem')

    def test_set_local_con_to(self):
        self.pasa(tx("set local statement_timeout to '5min';"))

    def test_literal_sin_cerrar(self):
        self.rechaza(tx("insert into public.club_movimientos (nota) values ('sin cerrar);"), 'sin cerrar')

    def test_identificador_entre_comillas_correcto(self):
        self.pasa(tx('insert into public."club_movimientos" (nota) values (\'x\');'))
        self.pasa(tx('insert into "public"."club_movimientos" ("nota") values (\'x\');'))

    def test_identificador_entre_comillas_con_mayusculas_es_otra_tabla(self):
        self.rechaza(tx('insert into public."CLUB_MOVIMIENTOS" (nota) values (\'x\');'), 'no permitida')

    def test_mayusculas_sin_comillas(self):
        self.pasa(tx("INSERT INTO PUBLIC.CLUB_MOVIMIENTOS (nota) VALUES ('x');"))

    def test_otra_tabla_parecida(self):
        self.rechaza(tx("insert into public.club_movimientos_x (nota) values ('x');"), 'no permitida')

    def test_sin_esquema(self):
        self.rechaza(tx("insert into club_movimientos (nota) values ('x');"), 'sin esquema')

    def test_otro_esquema(self):
        self.rechaza(tx("insert into pg_temp.club_movimientos (nota) values ('x');"), 'no permitida')

    def test_insert_con_on_conflict_update(self):
        self.rechaza(tx("insert into public.club_movimientos (nota) values ('x') on conflict (id) do update set nota = 'y';"),
                     'update')

    def test_select_suelto(self):
        self.rechaza(tx("select 1;"), 'sentencia no permitida')

    def test_select_into_de_nivel_superior(self):
        self.rechaza(tx("select * into public.copia from public.club_movimientos;"), 'sentencia no permitida')

    def test_into_en_el_select_del_insert(self):
        self.rechaza(tx("insert into public.club_movimientos select 1 into x;"), 'into')

    def test_funciones_del_servidor(self):
        self.rechaza(tx("insert into public.club_movimientos (nota) select pg_read_file('/etc/passwd');"), 'pg_read_file')
        self.rechaza(tx("insert into public.club_movimientos (nota) select query_to_xml('select 1', true, true, '');"),
                     'query_to_xml')
        self.rechaza(tx("insert into public.club_movimientos (nota) select lo_import('/x')::text;"), 'lo_import')

    def test_nombre_entre_comillas_de_funcion_prohibida(self):
        self.rechaza(tx('insert into public.club_movimientos (nota) select "set_config"(\'a\', \'b\', true);'), 'set_config')

    def test_do_con_literal_normal(self):
        self.rechaza(tx("do 'begin execute ''x''; end';"), 'entre $tag$')

    def test_do_con_language(self):
        self.pasa(tx("do language plpgsql $$ begin null; end $$;"))
        self.pasa(tx("do $$ begin null; end $$ language plpgsql;"))
        self.rechaza(tx("do $$ begin null; end $$ language plpythonu;"), 'do mal formado')

    def test_do_sentencias_permitidas(self):
        self.pasa(tx("""do $$
declare v_n int; v_p int;
begin
  select count(*), coalesce(sum(personas), 0) into v_n, v_p from public.club_movimientos where nota like 'x%';
  v_n := v_n + 1;
  if v_n <> 1 or v_p <> 2 then
    raise exception 'CLUB: % y %', v_n, v_p;
  elsif v_n = 0 then
    null;
  else
    raise exception 'otro';
  end if;
end $$;"""))

    def test_do_select_into_variable_no_declarada(self):
        self.rechaza(tx("do $$ begin select 1 into public.copia from public.club_config; end $$;"), 'variable declarada')

    def test_do_insert_adentro(self):
        self.rechaza(tx("do $$ begin insert into public.club_movimientos (nota) values ('x'); end $$;"), 'insert')

    def test_do_otra_sentencia(self):
        self.rechaza(tx("do $$ begin return; end $$;"), 'no permitida dentro del do')
        self.rechaza(tx("do $$ declare c refcursor; begin open c for select 1; end $$;"), 'no permitida dentro del do')

    def test_do_commit_adentro(self):
        self.rechaza(tx("do $$ begin commit; end $$;"), 'commit')

    def test_parametro_posicional_y_psql(self):
        self.rechaza(tx("insert into public.club_movimientos (nota) values ($1);"), 'posicional')
        self.rechaza(tx("\\! rm -rf /tmp/x"), 'psql')

    def test_una_sola_transaccion(self):
        self.rechaza("insert into public.club_movimientos (nota) values ('x');", 'begin')
        self.rechaza("begin; insert into public.club_movimientos (nota) values ('x');", 'commit')
        self.rechaza("begin; commit; begin; insert into public.club_movimientos (nota) values ('x'); commit;",
                     'fuera de lugar')
        self.pasa("begin; insert into public.club_movimientos (nota) values ('x'); rollback;")

    def test_parentesis_desbalanceados(self):
        self.rechaza(tx("insert into public.club_movimientos (nota) values (('x');"), 'paréntesis')

    def test_vacio(self):
        self.rechaza('', 'vacío')
        self.rechaza('-- solo un comentario\n', 'vacío')


class Tokenizador(unittest.TestCase):
    def test_literal_con_comillas_dobles(self):
        toks, probs = tokenizar("select 'a''b'")
        self.assertEqual(probs, [])
        self.assertEqual(toks, [('w', 'select'), ('s', "a'b")])

    def test_comentario_con_comilla_no_abre_literal(self):
        toks, probs = tokenizar("-- it's\nselect 1")
        self.assertEqual(probs, [])
        self.assertEqual(toks, [('w', 'select'), ('n', '1')])

    def test_dollar_con_tag(self):
        toks, _ = tokenizar("do $abc$ x $$ y $abc$")
        self.assertEqual(toks, [('w', 'do'), ('d', ' x $$ y ')])

    def test_asignacion_y_cast(self):
        toks, _ = tokenizar("v := '1'::int")
        self.assertEqual(toks, [('w', 'v'), ('p', ':='), ('s', '1'), ('p', ':'), ('p', ':'), ('w', 'int')])



class Migrador(unittest.TestCase):
    """(09-nov, punto 4) Lista cerrada propia del SQL de la PRIMERA CARGA del migrador (con tablas temporales)."""
    @classmethod
    def setUpClass(cls):
        import tempfile
        import migrar_firestore as mf
        import test_migrar_firestore as tmf
        cls.mf = mf
        cls._tmp = tempfile.TemporaryDirectory()
        cls.plan = mf.armar_plan(mf.cargar(tmf.export_sintetico(Path(cls._tmp.name) / 'e')))
        cls._loc = mf.LOCATION
        mf.LOCATION = 'local-prueba'
        legacy = [m['legacy_id'] for m in cls.plan.miembros if m['estado'] == 'activo'][:2]
        filas, err = sp.validar('legacy_id,personas,fecha_tarjeta,referencia\n' + ''.join(
            f'{l},6,2026-10-01,PAPEL-{i}\n' for i, l in enumerate(legacy)))
        assert not err, err
        cls.papel = sp.cuerpo_sql(filas, 'local-prueba', 'prod', 'carga')

    @classmethod
    def tearDownClass(cls):
        cls.mf.LOCATION = cls._loc
        cls._tmp.cleanup()

    def sql(self, **kw):
        return self.mf.sql_apply(self.plan, {'miembros': 3}, primera=True, **kw)

    def test_el_sql_real_de_la_primera_carga_pasa(self):
        from sql_g56 import revisar_migrador
        for kw in ({'fecha_carga': True}, {'fecha_carga': False}, {'fecha_carga': True, 'papel': self.papel}):
            sql = self.sql(**kw)
            self.assertEqual(revisar_migrador(sql, papel='papel' in kw), [], kw)
        # con papel pero sin habilitarlo: el lock y el registro del lote no pasan
        self.assertTrue(revisar_migrador(self.sql(fecha_carga=True, papel=self.papel), papel=False))

    def test_el_perfil_de_la_carga_de_papel_no_lo_acepta(self):
        self.assertTrue(revisar(self.sql(fecha_carga=True)))       # temporales, select suelto y barras: otra lista

    def test_el_modo_staging_con_deletes_no_pasa(self):
        from sql_g56 import revisar_migrador
        out = ' '.join(revisar_migrador(self.mf.sql_apply(self.plan, {'miembros': 3})))
        self.assertIn('«delete»', out)

    def test_trucados_fallan(self):
        from sql_g56 import revisar_migrador
        base = self.sql(fecha_carga=True)
        cola = base[:base.rindex('commit;')]
        trucos = {
            'delete': 'delete from public.club_movimientos;',
            'delete dentro de un do': 'do $$ begin delete from public.club_movimientos; end $$;',
            'create table permanente': 'create table _x (a int);',
            'temporal sin on commit drop': 'create temp table _x (a int);',
            'temporal con esquema': 'create temp table public._x on commit drop as select 1;',
            'temporal sin guion bajo': 'create temp table x on commit drop as select 1;',
            'insert en club_entorno': "insert into public.club_entorno (nombre) values ('prod');",
            'insert en profiles': 'insert into public.profiles (id) select gen_random_uuid();',
            'execute en un do': "do $$ begin execute 'delete from public.club_movimientos'; end $$;",
            'session_replication_role': "set local session_replication_role = 'replica';",
            'libro_mantenimiento': "set local club.libro_mantenimiento = 'migracion';",
            'truncate': 'truncate public.club_movimientos;',
            'on conflict do update': 'insert into public.club_negocios (nombre) values (\'x\') on conflict (nombre) do update set nombre = \'y\';',
            'select suelto de una tabla real': 'select * from public.club_miembros_contacto;',
            'pg_ fuera de los catálogos': 'create temp table _x on commit drop as select pg_read_file(\'/etc/passwd\');',
            'temporal llenada con delete': 'create temp table _x on commit drop as with d as (delete from public.club_movimientos returning 1) select 1;',
            'for sobre algo que no es select': 'do $$ declare k text; begin for k in execute \'x\' loop null; end loop; end $$;',
        }
        for nombre, extra in trucos.items():
            self.assertTrue(revisar_migrador(cola + extra + '\ncommit;\n', papel=False), nombre)


if __name__ == '__main__':
    unittest.main()
