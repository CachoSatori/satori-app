"""Pruebas de la carga de saldos de tarjetas de papel (sin base): validador, filtro G-56 y SQL emitido.
   python3 -m unittest scripts/club/test_saldos_papel.py
"""
import datetime as dt
import json
import os
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import saldos_papel as sp  # noqa: E402

HOY = dt.date(2026, 11, 8)
CAB = 'codigo_anfitrion,personas,fecha_tarjeta,referencia\n'


def val(cuerpo: str):
    return sp.validar(CAB + cuerpo, HOY)


class Validador(unittest.TestCase):
    def test_plantilla_del_repo_valida_y_sin_datos_reales(self):
        txt = (Path(__file__).parent / 'plantilla_saldos_papel.csv').read_text(encoding='utf-8')
        filas, err = sp.validar(txt, HOY)
        self.assertEqual(err, [])
        self.assertEqual(len(filas), 2)
        self.assertNotRegex(txt, r'@|\+\d|\d{8,}')   # ni emails ni teléfonos

    def test_fila_buena_y_bom(self):
        filas, err = sp.validar('﻿' + CAB + 'abcd2345, 12 ,2026-05-20,TARJETA-1\n', HOY)
        self.assertEqual(err, [])
        self.assertEqual(filas, [{'codigo': 'ABCD2345', 'personas': 12, 'fecha': '2026-05-20', 'referencia': 'TARJETA-1', 'linea': 2, 'clave': 'codigo'}])

    def test_malformadas(self):
        casos = {
            'ABCD234,6,2026-01-01,T1': 'código',                 # 7 caracteres
            'ABCD234I,6,2026-01-01,T1': 'código',                # I no está en el alfabeto
            'ABCD2345,0,2026-01-01,T1': 'personas',
            'ABCD2345,-3,2026-01-01,T1': 'personas',
            'ABCD2345,601,2026-01-01,T1': 'personas',
            'ABCD2345,6.5,2026-01-01,T1': 'personas',
            'ABCD2345,6,2026-13-01,T1': 'fecha',
            'ABCD2345,6,2026-12-01,T1': 'fecha',                 # futura
            'ABCD2345,6,2019-12-31,T1': 'fecha',                 # antes de 2020
            'ABCD2345,6,01/05/2026,T1': 'fecha',
            'ABCD2345,6,2026-01-01,': 'referencia',
            'ABCD2345,6,2026-01-01,T1;drop': 'referencia',
            'ABCD2345,6,2026-01-01': 'columnas',
            'ABCD2345,6,2026-01-01,T1,extra': 'columnas',
        }
        for fila, esperado in casos.items():
            filas, err = val(fila + '\n')
            self.assertEqual(filas, [], fila)
            self.assertEqual(len(err), 1, fila)
            self.assertIn(esperado, err[0], fila)
            self.assertNotIn('ABCD', err[0], 'el error no repite el contenido de la fila')

    def test_duplicadas(self):
        filas, err = val('ABCD2345,6,2026-01-01,T1\nABCD2345,6,2026-01-01,T1\n')
        self.assertEqual(len(err), 1); self.assertIn('duplicada', err[0])
        filas, err = val('ABCD2345,6,2026-01-01,T1\nABCD2345,9,2026-02-01,t1\n')   # misma tarjeta (ref sin mayúsculas)
        self.assertEqual(len(err), 1); self.assertIn('misma tarjeta', err[0])
        filas, err = val('ABCD2345,6,2026-01-01,T1\nABCD2345,6,2026-01-01,T2\n')   # dos tarjetas del mismo anfitrión: válido
        self.assertEqual(err, []); self.assertEqual(len(filas), 2)

    def test_encabezado_y_vacio(self):
        self.assertEqual(sp.validar('', HOY), ([], ['archivo vacío']))
        self.assertIn('encabezado', sp.validar('codigo,personas\nABCD2345,6\n', HOY)[1][0])
        self.assertEqual(sp.validar(CAB, HOY), ([], ['el archivo no tiene filas']))

    def test_con_un_error_no_se_carga_nada(self):
        filas, err = val('ABCD2345,6,2026-01-01,T1\nMALO,6,2026-01-01,T2\n')
        self.assertTrue(err)
        # quien llama rechaza el archivo entero si hay errores (el migrador hace sys.exit antes de emitir)


class FiltroG56(unittest.TestCase):
    def sql_ok(self):
        f, _ = sp.validar(CAB + 'ABCD2345,6,2026-01-01,T1\n', HOY)
        return sp.sql_carga(f, 'local-prueba', 'prod')

    def test_el_sql_emitido_pasa_el_filtro(self):
        self.assertEqual(sp.filtrar(self.sql_ok()), [])

    def test_rechaza_cada_palabra_prohibida(self):
        base = self.sql_ok().replace('commit;\n', '')
        for w, extra in (('delete', 'delete from public.club_movimientos;'),
                         ('truncate', 'truncate public.club_movimientos;'),
                         ('drop', 'drop table public.club_alertas;'),
                         ('update', 'update public.club_config set valor_credito_crc = 1;'),
                         ('alter', 'alter table public.club_movimientos disable trigger all;'),
                         ('grant', 'grant all on public.club_movimientos to anon;'),
                         ('revoke', 'revoke all on public.club_auditoria from authenticated;')):
            self.assertIn(f'palabra prohibida «{w}»', ' '.join(sp.filtrar(base + extra + '\ncommit;\n')), w)

    def test_rechaza_escondida_en_un_do(self):
        malo = self.sql_ok().replace('commit;\n', "do $$ begin delete from public.club_movimientos; end $$;\ncommit;\n")
        self.assertIn('palabra prohibida «delete»', ' '.join(sp.filtrar(malo)))

    def test_deja_pasar_la_palabra_dentro_de_un_literal(self):
        ok = self.sql_ok().replace("'saldo tarjeta de papel · '", "'saldo tarjeta de papel (no se hace update ni delete) · '")
        self.assertEqual(sp.filtrar(ok), [])

    def test_rechaza_sentencias_fuera_de_la_lista(self):
        malo = self.sql_ok().replace('commit;\n', 'select pg_sleep(1);\ninsert into public.profiles (id) values (null);\ncommit;\n')
        out = sp.filtrar(malo)
        self.assertTrue(any('sentencia no permitida (empieza con «select»)' in o for o in out), out)
        self.assertTrue(any('insert en una tabla no permitida (public.profiles)' in o for o in out), out)


class SqlEmitido(unittest.TestCase):
    def setUp(self):
        self.f, _ = sp.validar(CAB + 'ABCD2345,6,2026-01-01,T1\nWXYZ6789,12,2026-02-01,T2\n', HOY)
        self.sql = sp.sql_carga(self.f, 'local-prueba', 'prod')

    def test_orden_timeouts_precondiciones_insercion_validacion_commit(self):
        s = self.sql
        self.assertTrue(s.startswith("begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '5min';\n"))
        i_lock = s.index('lock table public.club_cargas_papel in exclusive mode;')
        i_ent = s.index('CLUB: el entorno'); i_pre = s.index('CLUB: línea de base')
        i_anf = s.index('no es un anfitrión activo'); i_lote = s.index('insert into public.club_cargas_papel')
        i_ins = s.index('insert into public.club_movimientos')
        i_val = s.index('validación'); i_fin = s.rindex('commit;')
        self.assertTrue(i_lock < i_ent < i_pre < i_anf < i_lote < i_ins < i_val < i_fin)
        self.assertTrue(s.endswith('commit;\n'))
        self.assertIn('v_n <> 2 or v_p <> 18', s)

    def test_ensayo_termina_en_rollback_y_no_tiene_commit(self):
        e = sp.sql_ensayo(self.f, 'local-prueba', 'prod')
        self.assertTrue(e.endswith('rollback;\n'))
        self.assertNotIn('commit', e)

    def test_staging_exige_la_marca_de_staging(self):
        self.assertIn('if not (exists (select 1 from public.club_entorno))', sp.sql_carga(self.f, 'x', 'staging'))

    def test_resumen_sin_datos_de_anfitriones(self):
        r = sp.resumen(self.f, self.sql, 'local-prueba')
        txt = sp.json_resumen(r)
        self.assertEqual((r['filas'], r['anfitriones'], r['personas']), (2, 2, 18))
        self.assertRegex(r['sha256_sql'], r'^[0-9a-f]{64}$')
        for dato in ('ABCD2345', 'WXYZ6789', 'T1', 'T2'):
            self.assertNotIn(dato, txt)

    def test_fecha_del_movimiento_por_defecto_es_la_de_carga(self):
        # el dueño (09-nov): fecha de carga para todos; los de más de 12 meses se deciden antes, en la fuente (inactivos)
        ins = self.sql[self.sql.index('insert into public.club_movimientos'):]
        self.assertIn("'tarjeta', p.personas, c.personas_por_credito, c.valor_credito_crc,\n       now(), now(), 'papel'", ins)
        self.assertIn("' · tarjeta ' || to_char(p.fecha, 'YYYY-MM-DD')", ins)   # la fecha de la tarjeta queda en la nota
        con_tarjeta = sp.sql_carga(self.f, 'local-prueba', 'prod', 'tarjeta')
        self.assertIn("(p.fecha::timestamp + time '12:00') at time zone 'America/Costa_Rica', now(), 'papel'", con_tarjeta)
        self.assertEqual(sp.filtrar(con_tarjeta), [])
        with self.assertRaises(AssertionError):
            sp.sql_carga(self.f, 'local-prueba', 'prod', 'original')

    def test_comillas_en_la_referencia_no_rompen_el_sql(self):
        # la referencia no admite comillas (validador), pero el armado igual las escapa
        self.assertIn("'O''Hara'", sp._q("O'Hara"))


class CliMigrador(unittest.TestCase):
    def test_prod_negado(self):
        import subprocess
        r = subprocess.run([sys.executable, str(Path(__file__).parent / 'migrar_firestore.py'), 'saldos-papel',
                            '--ref', 'yiczgdtirrkdvohdquzf', '--local', 'x', '--ficticios', '2', '--ensayo'],
                           capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('NEGADO', r.stderr + r.stdout)

    def test_ficticios_solo_con_ensayo(self):
        import subprocess
        r = subprocess.run([sys.executable, str(Path(__file__).parent / 'migrar_firestore.py'), 'saldos-papel',
                            '--local', 'x', '--ficticios', '2', '--validar'], capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('NEGADO', r.stderr + r.stdout)

    def test_csv_dentro_del_repo_negado(self):
        import subprocess
        r = subprocess.run([sys.executable, str(Path(__file__).parent / 'migrar_firestore.py'), 'saldos-papel',
                            '--local', 'x', '--csv', str(Path(__file__).parent / 'plantilla_saldos_papel.csv'), '--validar'],
                           capture_output=True, text=True)
        self.assertIn('NEGADO', r.stderr + r.stdout)


class DobleCarga(unittest.TestCase):
    """Tarjetas del CSV que ya están en Firestore (datos ficticios). refA tiene un crédito de 7 el 20-oct (UTC 20:00 =
    14:00 CR); refB uno de 12 el 21-oct; refC (borrado) uno de 5 el 15-sep."""
    MAPA = 'codigo_anfitrion,legacy_id\nAAAA2222,refA\nBBBB3333,refB\n'

    def filas(self, cuerpo):
        f, err = sp.validar(CAB + cuerpo, HOY)
        self.assertEqual(err, [])
        return f

    def referrals(self):
        import importlib.util, tempfile
        spec = importlib.util.spec_from_file_location('tmf', Path(__file__).parent / 'test_migrar_firestore.py')
        tmf = importlib.util.module_from_spec(spec); spec.loader.exec_module(tmf)
        self._tmp = tempfile.TemporaryDirectory(); self.addCleanup(self._tmp.cleanup)
        exp = tmf.export_sintetico(Path(self._tmp.name) / 'export')
        d = tmf.mf.cargar(exp)
        return d['referrals'], exp

    def test_exacta_cercana_distinta_y_sin_mapa(self):
        refs, _ = self.referrals()
        filas = self.filas('AAAA2222,7,2026-10-20,P-1\n'      # exacta (mismo día CR)
                           'BBBB3333,12,2026-10-23,P-2\n'     # cercana (2 días)
                           'BBBB3333,12,2026-10-30,P-3\n'     # mismo anfitrión y personas, 9 días: no
                           'AAAA2222,8,2026-10-20,P-4\n'      # otras personas: no
                           'CCCC4444,5,2026-09-15,P-5\n')     # sin mapa
        out = sp.cruzar(filas, refs, sp.leer_mapa(self.MAPA), 3)
        self.assertEqual([(x['linea'], x['firestore_id'], x['certeza']) for x in out['en_los_dos']],
                         [(2, 'r1', 'exacta'), (3, 'r2', 'cercana')])
        self.assertEqual(out['sin_mapa'], [{'linea': 6, 'referencia': 'P-5'}])
        texto = json.dumps(out)
        for dato in ('Referente', '6000', '@'):
            self.assertNotIn(dato, texto)   # sin nombres, teléfonos ni emails

    def test_un_credito_explica_una_sola_tarjeta(self):
        refs, _ = self.referrals()
        filas = self.filas('AAAA2222,7,2026-10-20,P-1\nAAAA2222,7,2026-10-21,P-2\n')
        out = sp.cruzar(filas, refs, sp.leer_mapa(self.MAPA), 3)
        self.assertEqual([x['referencia'] for x in out['en_los_dos']], ['P-1'])

    def test_mapa_mal_formado(self):
        with self.assertRaises(ValueError):
            sp.leer_mapa('codigo,id\nAAAA2222,refA\n')

    def test_cli_solo_lectura_sale_2_si_hay_doble_carga(self):
        import subprocess, tempfile
        _, exp = self.referrals()
        with tempfile.TemporaryDirectory() as t:
            csvp = Path(t) / 'saldos.csv'; csvp.write_text(CAB + 'AAAA2222,7,2026-10-20,P-1\nBBBB3333,1,2026-10-01,P-9\n')
            mapp = Path(t) / 'mapa.csv'; mapp.write_text(self.MAPA)
            r = subprocess.run([sys.executable, str(Path(__file__).parent / 'migrar_firestore.py'), 'doble-carga-papel',
                                '--export', str(exp), '--csv', str(csvp), '--mapa', str(mapp)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 2, r.stderr)
            out = json.loads(r.stdout)
            self.assertEqual([x['referencia'] for x in out['en_los_dos']], ['P-1'])
            csvp.write_text(CAB + 'BBBB3333,1,2026-10-01,P-9\n')
            r = subprocess.run([sys.executable, str(Path(__file__).parent / 'migrar_firestore.py'), 'doble-carga-papel',
                                '--export', str(exp), '--csv', str(csvp), '--mapa', str(mapp)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr + r.stdout)

    def test_cli_niega_archivos_dentro_del_repo(self):
        import subprocess
        r = subprocess.run([sys.executable, str(Path(__file__).parent / 'migrar_firestore.py'), 'doble-carga-papel',
                            '--export', '/tmp/x', '--csv', str(Path(__file__).parent / 'plantilla_saldos_papel.csv'),
                            '--mapa', '/tmp/m.csv'], capture_output=True, text=True)
        self.assertIn('NEGADO', r.stderr + r.stdout)


if __name__ == '__main__':
    unittest.main()


class Carga09Nov(unittest.TestCase):
    """09-nov: origen propio (B2), lock y clave de lote (Grok 109), legacy_id para la carga única e inactivos (B11)."""
    def setUp(self):
        self.f, _ = sp.validar(CAB + 'ABCD2345,6,2026-01-01,T1\nWXYZ6789,12,2026-02-01,T2\n', HOY)

    def test_origen_papel_y_validacion_por_origen(self):
        sql = sp.sql_carga(self.f, 'local-prueba', 'prod')
        self.assertIn("now(), now(), 'papel'", sql)
        self.assertIn("where origen = 'papel' and location_id = 'local-prueba'", sql)
        self.assertNotIn("'migracion'", sql)

    def test_clave_de_lote_estable_y_sensible(self):
        a = sp.lote_sha256(self.f, 'x')
        self.assertEqual(a, sp.lote_sha256(list(reversed(self.f)), 'x'))      # el orden de las filas no cambia el lote
        self.assertNotEqual(a, sp.lote_sha256(self.f, 'y'))
        otra = [dict(self.f[0], personas=7), self.f[1]]
        self.assertNotEqual(a, sp.lote_sha256(otra, 'x'))
        sql = sp.sql_carga(self.f, 'x', 'prod')
        self.assertIn(f"values ('x', '{a}', 2, 18, 'carga');", sql)
        self.assertIn(f"or lote_sha256 = '{a}'", sql)

    def test_el_lock_pasa_el_filtro_y_otro_lock_no(self):
        sql = sp.sql_carga(self.f, 'x', 'prod')
        self.assertEqual(sp.filtrar(sql), [])
        malo = sql.replace('lock table public.club_cargas_papel in exclusive mode;', 'lock table public.club_movimientos in exclusive mode;')
        self.assertTrue(any('lock no permitido' in o for o in sp.filtrar(malo)))

    def test_legacy_id_para_la_carga_unica(self):
        f, err = sp.validar('legacy_id,personas,fecha_tarjeta,referencia\nrefLegacy01,6,2026-01-01,T1\n', HOY)
        self.assertEqual(err, [])
        self.assertEqual(f[0]['clave'], 'legacy_id')
        sql = sp.sql_carga(f, 'x', 'prod')
        self.assertIn('m.legacy_id = p.codigo', sql)
        self.assertEqual(sp.filtrar(sql), [])
        _, err = sp.validar('legacy_id,personas,fecha_tarjeta,referencia\nno vale!,6,2026-01-01,T1\n', HOY)
        self.assertTrue(any('legacy_id mal formado' in e for e in err))

    def test_inactivos_sobre_la_fuente(self):
        f, _ = sp.validar(CAB + 'ABCD2345,6,2025-06-01,VIEJA\nWXYZ6789,12,2026-01-01,NUEVA\n', dt.date(2026, 11, 9))
        out = sp.inactivos(f, dt.date(2026, 11, 9), 12)
        self.assertEqual([x['referencia'] for x in out], ['VIEJA'])
        self.assertEqual(out[0]['meses'], 17)
        self.assertNotIn('codigo', out[0])   # sin el código del anfitrión


@unittest.skipUnless(os.environ.get('CLUB_ENSAYO_STAGING') == '1', 'ensayo contra staging (CLUB_ENSAYO_STAGING=1)')
class PapelStaging(unittest.TestCase):
    """09-nov · contra STAGING, sin dejar nada: el ensayo termina en ROLLBACK y el SQL de prod se niega solo."""
    LOCAL = os.environ.get('CLUB_LOCAL', 'santa-teresa')

    @classmethod
    def setUpClass(cls):
        import migrar_firestore
        cls.mf = migrar_firestore

    def conteo(self):
        return self.mf.ejecutar(self.mf.STAGING_REF, "select (select count(*) from public.club_movimientos where origen = 'papel') p, "
                                "(select count(*) from public.club_cargas_papel) c, (select count(*) from public.club_miembros) m",
                                read_only=True)[0]

    def test_ensayo_con_ficticios_valida_y_no_deja_nada(self):
        antes = self.conteo()
        filas, previo = sp.ficticios(6, self.LOCAL)
        sql = sp.sql_ensayo(filas, self.LOCAL, 'staging', previo)
        self.assertEqual(sp.filtrar(sql, ficticios=True), [])
        self.mf.ejecutar(self.mf.STAGING_REF, sql)
        self.assertEqual(self.conteo(), antes)

    def test_dos_veces_en_la_misma_transaccion_la_segunda_frena(self):
        filas, previo = sp.ficticios(3, self.LOCAL)
        cuerpo = sp.cuerpo_sql(filas, self.LOCAL, 'staging')
        sql = sp.CABECERA + previo + cuerpo + cuerpo + 'rollback;\n'
        with self.assertRaises(SystemExit) as cm:
            self.mf.ejecutar(self.mf.STAGING_REF, sql)
        self.assertIn('línea de base', str(cm.exception))

    def test_109_dos_sesiones_a_la_vez_se_ponen_en_fila(self):
        """S1 toma el lock y tarda 3 s antes de deshacerse; S2 (1 s después) espera el lock y recién ahí carga."""
        import threading, time
        antes = self.conteo()
        f1, p1 = sp.ficticios(3, self.LOCAL)
        f2, p2 = sp.ficticios(3, self.LOCAL)
        s1 = sp.sql_ensayo(f1, self.LOCAL, 'staging', p1).replace('rollback;\n', 'select pg_sleep(3);\nrollback;\n')
        s2 = sp.sql_ensayo(f2, self.LOCAL, 'staging', p2)
        res = {}
        def correr(k, q):
            t0 = time.monotonic()
            try:
                self.mf.ejecutar(self.mf.STAGING_REF, q); res[k] = ('ok', time.monotonic() - t0)
            except SystemExit as e:
                res[k] = (str(e), time.monotonic() - t0)
        h1 = threading.Thread(target=correr, args=('s1', s1)); h1.start(); time.sleep(1.0)
        t_s2 = time.monotonic()
        h2 = threading.Thread(target=correr, args=('s2', s2)); h2.start()
        h1.join(); h2.join()
        self.assertEqual(res['s1'][0], 'ok', res)
        self.assertEqual(res['s2'][0], 'ok', res)
        self.assertGreater(res['s2'][1], 1.5, f'S2 no esperó el lock: {res}')   # esperó a que S1 soltara (~2 s)
        self.assertEqual(self.conteo(), antes)

    def test_modo_prod_contra_staging_se_niega_solo(self):
        """El carga.sql de PROD, aplicado con --aplicar-firmado en staging: aborta en «el entorno no es prod»."""
        import subprocess, tempfile, hashlib
        cod = self.mf.ejecutar(self.mf.STAGING_REF, "select codigo from public.club_miembros where estado = 'activo' "
                               f"and location_id = '{self.LOCAL}' and tipo = 'referente' and codigo is not null limit 2", read_only=True)
        if len(cod) < 2:
            self.skipTest('staging sin anfitriones activos')
        with tempfile.TemporaryDirectory() as d:
            csvf = Path(d) / 'papel.csv'
            csvf.write_text(CAB + ''.join(f"{c['codigo']},6,2026-10-01,PRUEBA-{i}\n" for i, c in enumerate(cod)), encoding='utf-8')
            out = Path(d) / 'emit'
            mf = str(Path(__file__).parent / 'migrar_firestore.py')
            r = subprocess.run([sys.executable, '-I', mf, 'saldos-papel', '--csv', str(csvf), '--local', self.LOCAL, '--emitir', str(out)],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            carga = (out / 'carga.sql').read_text(encoding='utf-8')
            h = hashlib.sha256(carga.encode()).hexdigest()
            self.assertEqual(json.loads((out / 'resumen.json').read_text())['sha256_sql'], h)
            mal = subprocess.run([sys.executable, '-I', mf, 'saldos-papel', '--aplicar-firmado', str(out / 'carga.sql'), '--sha256', '0' * 64],
                                 capture_output=True, text=True)
            self.assertIn('no es el firmado', mal.stdout + mal.stderr)
            prod = subprocess.run([sys.executable, '-I', mf, 'saldos-papel', '--aplicar-firmado', str(out / 'carga.sql'), '--sha256', h,
                                   '--ref', 'yiczgdtirrkdvohdquzf'], capture_output=True, text=True, env={**os.environ, 'CLUB_G56_PROD': ''})
            self.assertIn('NEGADO', prod.stdout + prod.stderr)   # contra prod sin --confirmo-ref ni CLUB_G56_PROD: no sale
            antes = self.conteo()
            r = subprocess.run([sys.executable, '-I', mf, 'saldos-papel', '--aplicar-firmado', str(out / 'carga.sql'), '--sha256', h],
                               capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('el entorno no es prod', r.stdout + r.stderr)
            self.assertEqual(self.conteo(), antes)
