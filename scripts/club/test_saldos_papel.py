"""Pruebas de la carga de saldos de tarjetas de papel (sin base): validador, filtro G-56 y SQL emitido.
   python3 -m unittest scripts/club/test_saldos_papel.py
"""
import datetime as dt
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
        self.assertEqual(filas, [{'codigo': 'ABCD2345', 'personas': 12, 'fecha': '2026-05-20', 'referencia': 'TARJETA-1'}])

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
            self.assertIn(f'palabra prohibida: {w}', sp.filtrar(base + extra + '\ncommit;\n'), w)

    def test_rechaza_escondida_en_un_do(self):
        malo = self.sql_ok().replace('commit;\n', "do $$ begin delete from public.club_movimientos; end $$;\ncommit;\n")
        self.assertIn('palabra prohibida: delete', sp.filtrar(malo))

    def test_deja_pasar_la_palabra_dentro_de_un_literal(self):
        ok = self.sql_ok().replace("'saldo tarjeta de papel · '", "'saldo tarjeta de papel (no se hace update ni delete) · '")
        self.assertEqual(sp.filtrar(ok), [])

    def test_rechaza_sentencias_fuera_de_la_lista(self):
        malo = self.sql_ok().replace('commit;\n', 'select pg_sleep(1);\ninsert into public.profiles (id) values (null);\ncommit;\n')
        out = sp.filtrar(malo)
        self.assertTrue(any(o.startswith('sentencia no permitida: select') for o in out), out)
        self.assertTrue(any(o.startswith('sentencia no permitida: insert') for o in out), out)


class SqlEmitido(unittest.TestCase):
    def setUp(self):
        self.f, _ = sp.validar(CAB + 'ABCD2345,6,2026-01-01,T1\nWXYZ6789,12,2026-02-01,T2\n', HOY)
        self.sql = sp.sql_carga(self.f, 'local-prueba', 'prod')

    def test_orden_timeouts_precondiciones_insercion_validacion_commit(self):
        s = self.sql
        self.assertTrue(s.startswith("begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '5min';\n"))
        i_ent = s.index('CLUB: el entorno'); i_pre = s.index('CLUB: línea de base')
        i_anf = s.index('no es un anfitrión activo'); i_ins = s.index('insert into public.club_movimientos')
        i_val = s.index('validación'); i_fin = s.rindex('commit;')
        self.assertTrue(i_ent < i_pre < i_anf < i_ins < i_val < i_fin)
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


if __name__ == '__main__':
    unittest.main()
