#!/usr/bin/env python3
"""
Pruebas del migrador F1b (CLUB-AUD-19..23) con un export SINTÉTICO armado en una carpeta temporal.
Nada de datos reales: nombres, teléfonos y emails son ficticios.

  python3 -I -m unittest scripts/club/test_migrar_firestore.py          # sin red
  CLUB_ENSAYO_STAGING=1 python3 -I -m unittest scripts/club/test_migrar_firestore.py
      # + ensayo contra STAGING: corre la carga y la validación en una transacción que termina en ROLLBACK

Las pruebas con red nunca hacen --apply: usan sql_apply(..., ensayo=True), que termina en ROLLBACK.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

_RUTA = Path(__file__).resolve().parent / 'migrar_firestore.py'
_spec = importlib.util.spec_from_file_location('migrar_firestore', _RUTA)
mf = importlib.util.module_from_spec(_spec)
sys.modules['migrar_firestore'] = mf
_spec.loader.exec_module(mf)

SATORI = mf.SATORI_BIZ_ID
OTRO_NEGOCIO = 'NegocioDePruebaXXXXX'
EMAIL_FICTICIO = 'ficticio.uno@ejemplo.com'


def export_sintetico(carpeta: Path, *, negocio: str = SATORI, provisional: bool = False, manifiesto: str = 'json',
                     romper_sha: bool = False, venc_no_debit: bool = False, venc_fuera: bool = False,
                     venc_repetido: bool = False) -> Path:
    """3 referentes ficticios: uno activo con saldo, uno con canje y uno borrado; 2 vencimientos del 05-nov."""
    archivos = {
        'businesses.json': [{'_id': negocio, 'name': 'Negocio ficticio', 'peoplePointsRate': 6}],
        'referrers.json': [
            {'_id': 'refA', 'businessId': negocio, 'name': 'Referente Uno', 'workPlace': 'Hotel Ficticio',
             'phoneNumber': '60000001', 'email': EMAIL_FICTICIO, 'createdAt': '2026-09-01T15:00:00.000Z',
             'updatedAt': '2026-09-01T15:00:00.000Z'},
            {'_id': 'refB', 'businessId': negocio, 'name': 'Referente Dos PM', 'workPlace': 'hotel  ficticio',
             'phoneNumber': None, 'email': None, 'createdAt': '2026-09-02T15:00:00.000Z'},
            {'_id': 'refC', 'businessId': negocio, 'name': 'Referente Tres', 'workPlace': 'Tienda Ficticia',
             'deleted': True, 'createdAt': '2026-08-01T15:00:00.000Z', 'updatedAt': '2026-10-10T15:00:00.000Z'},
        ],
        'referrals.json': [
            {'_id': 'r1', 'referrerId': 'refA', 'referralType': 'credit', 'peopleCount': 7, 'peoplePointsRateSnapshot': 6,
             'createdAt': '2026-10-20T20:00:00.000Z'},
            {'_id': 'r2', 'referrerId': 'refB', 'referralType': 'credit', 'peopleCount': 12, 'peoplePointsRateSnapshot': 6,
             'createdAt': '2026-10-21T20:00:00.000Z'},
            {'_id': 'r3', 'referrerId': 'refB', 'referralType': 'debit', 'peopleCount': 6, 'peoplePointsRateSnapshot': 6,
             'createdAt': '2026-10-25T20:00:30.000Z'},
            {'_id': 'r4', 'referrerId': 'refC', 'referralType': 'credit', 'peopleCount': 5, 'peoplePointsRateSnapshot': 6,
             'createdAt': '2026-09-15T20:00:00.000Z'},
            {'_id': 'v1', 'referrerId': 'refA', 'referralType': 'debit', 'peopleCount': 1, 'peoplePointsRateSnapshot': 6,
             'createdAt': '2026-11-05T17:10:00.000Z'},
            {'_id': 'v2', 'referrerId': 'refB', 'referralType': 'credit' if venc_no_debit else 'debit', 'peopleCount': 1,
             'peoplePointsRateSnapshot': 6, 'createdAt': '2026-11-07T17:10:00.000Z' if venc_fuera else '2026-11-05T17:20:00.000Z'},
        ],
        'referrals_club.json': [
            {'_id': 'c1', 'referrerId': 'refB', 'referralType': 'credit', 'amount': 1500000, 'createdAt': '2026-10-21T20:00:00.000Z'},
            {'_id': 'c2', 'referrerId': 'refB', 'referralType': 'debit', 'amount': 500000, 'createdAt': '2026-10-28T20:00:00.000Z'},
            {'_id': 'c3', 'referrerId': 'refC', 'referralType': 'credit', 'amount': 200000, 'createdAt': '2026-09-15T20:00:00.000Z'},
        ],
        'vencimientos_2026-11-05.json': ['v1', 'v2', 'v2'] if venc_repetido else ['v1', 'v2'],
    }
    carpeta.mkdir(parents=True, exist_ok=True)
    shas = {}
    for nombre, contenido in archivos.items():
        crudo = json.dumps(contenido, ensure_ascii=False).encode()
        (carpeta / nombre).write_bytes(crudo)
        shas[nombre] = hashlib.sha256(crudo).hexdigest()
    if romper_sha:
        shas['referrers.json'] = '0' * 64
    if manifiesto == 'json':
        (carpeta / 'MANIFEST.json').write_text(json.dumps({'provisional': provisional, 'archivos': shas}))
    elif manifiesto == 'md':
        lineas = ['# Export Club (ficticio)', '', 'Fecha CR: 2026-11-07' + (' — PROVISIONAL' if provisional else ''), '']
        lineas += [f'| `{n}` | {h} |' for n, h in shas.items()]
        (carpeta / 'MANIFEST.md').write_text('\n'.join(lineas))
    return carpeta


class Export(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def plan(self, **kw):
        return mf.armar_plan(mf.cargar(export_sintetico(self.dir / 'e', **kw)))

    def rechaza(self, texto, **kw):
        with self.assertRaises(mf.ExportInvalido) as cm:
            self.plan(**kw)
        self.assertIn(texto, str(cm.exception))
        self.assertEqual(cm.exception.code, 3)

    def test_export_correcto(self):
        p = self.plan()
        r = mf.resumen_plan(p)
        self.assertEqual(r['miembros'], 3)
        self.assertEqual(r['diferencias_saldo_vs_firestore'], 0)
        self.assertEqual(mf.problemas_plan(p, r), [])
        self.assertEqual(r['vencimientos_136'], 2)   # un vencimiento por referente

    def test_21_otro_negocio_aborta(self):
        self.rechaza('no es Satori', negocio=OTRO_NEGOCIO)

    def test_21_manifiesto_provisional_aborta(self):
        self.rechaza('provisional', provisional=True)
        self.rechaza('provisional', provisional=True, manifiesto='md')

    def test_21_manifiesto_md_valido(self):
        self.assertEqual(len(self.plan(manifiesto='md').miembros), 3)

    def test_21_sin_manifiesto_aborta(self):
        self.rechaza('no hay MANIFEST', manifiesto='ninguno')

    def test_21_sha_distinto_aborta(self):
        self.rechaza('sha256 no coincide', romper_sha=True)

    def test_21_vencimientos(self):
        self.rechaza('no son débitos', venc_no_debit=True)
        self.rechaza('fuera del 05-nov', venc_fuera=True)
        self.rechaza('repetidos', venc_repetido=True)

    def test_22_pm_una_definicion(self):
        p = self.plan()
        # cargos no anulados (refB 15.000) − pagos (5.000); el cargo de la cuenta borrada (refC) está anulado
        self.assertEqual(mf.pm_pendiente_plan(p), Decimal('10000'))
        self.assertEqual(mf.resumen_plan(p)['pm_pendiente'], '10000')


class Sql(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = mf.armar_plan(mf.cargar(export_sintetico(Path(self.tmp.name) / 'e')))

    def tearDown(self):
        self.tmp.cleanup()

    def test_20_datos_personales_en_un_solo_literal(self):
        sql = mf.sql_apply(self.p)
        self.assertEqual(sql.count(EMAIL_FICTICIO), 1)
        self.assertEqual(sql.count('Referente Uno'), 1)
        self.assertIn('jsonb_to_recordset', sql)

    def test_19_validacion_antes_del_commit(self):
        sql = mf.sql_apply(self.p, {'miembros': 3})
        self.assertLess(sql.index('validación fallida'), sql.rindex('commit;'))
        self.assertTrue(sql.rstrip().endswith('commit;'))
        self.assertTrue(mf.sql_apply(self.p, ensayo=True).rstrip().endswith('rollback;'))

    def test_23_conserva_identidades_y_frena_con_cierres(self):
        sql = mf.sql_apply(self.p)
        self.assertIn('coalesce(pv.codigo', sql)
        self.assertIn('coalesce(pv.token_portal', sql)
        self.assertIn('club_reportes_cerrados', sql)

    def test_20_errores_sin_datos_personales(self):
        cuerpo = ('{"message":"Failed to run sql query: ERROR:  22P02: invalid input syntax for type integer\\n'
                  'LINE 1: ... {\\"email\\": \\"' + EMAIL_FICTICIO + '\\", \\"telefono\\": \\"+50660000001\\"} ...\\n"}')
        msg = mf.mensaje_error(cuerpo)
        self.assertIn('22P02', msg)
        self.assertNotIn('@', msg)
        self.assertNotIn('+506', msg)
        propio = mf.mensaje_error('ERROR:  P0001: CLUB: validación fallida, no se guarda nada: miembros: base=3 esperado=4')
        self.assertIn('miembros: base=3 esperado=4', propio)

    # ── 09-nov · B2 (frena con papel) y B11 (carga única: sin deletes, cero socios, fecha de carga, inactivos) ──
    def test_b2_frena_si_hay_carga_de_papel(self):
        for primera in (False, True):
            sql = mf.sql_apply(self.p, primera=primera)
            self.assertIn("where origen = 'papel') or exists (select 1 from public.club_cargas_papel)", sql)
            self.assertIn('el migrador no corre (nunca la borra', sql)

    def test_b11_primera_carga_sin_deletes_y_con_cero_socios(self):
        sql = mf.sql_apply(self.p, primera=True, fecha_carga=True)
        self.assertNotRegex(sql, r'(?im)^\s*delete\b')
        self.assertNotIn('libro_mantenimiento', sql)
        self.assertIn('precondición «cero socios»', sql)
        self.assertLess(sql.index('cero socios'), sql.index('insert into public.club_miembros'))
        self.assertIn("now(), now(), 'migracion', j.nota", sql)
        self.assertTrue(sql.rstrip().endswith('commit;'))
        # sin fecha de carga, las fechas originales
        self.assertIn("coalesce(j.fecha, now()), coalesce(j.fecha, now()), 'migracion'", mf.sql_apply(self.p, primera=True))
        # el vaciado de ensayo solo existe con ensayo y primera carga
        with self.assertRaises(AssertionError):
            mf.sql_apply(self.p, primera=True, vaciar_ensayo=True)
        self.assertIn('truncate public.club_miembros', mf.sql_apply(self.p, ensayo=True, primera=True, vaciar_ensayo=True))

    def test_b11_inactivos_sobre_la_fuente(self):
        todos = mf.inactivos_fuente(self.p, '2099-01-01', 12)   # dentro de 70 años, toda cuenta con saldo está inactiva
        con_saldo = [m for m in self.p.miembros if m['estado'] == 'activo'
                     and sum(x['personas'] for x in self.p.movimientos if x['miembro_id'] == m['id']) > 0]
        self.assertEqual(len(todos), len(con_saldo))
        self.assertTrue(all(set(x) == {'legacy_id', 'personas', 'ultima_actividad'} for x in todos))   # sin nombres
        self.assertEqual(mf.inactivos_fuente(self.p, '2000-01-01', 12), [])


class Cruce115(unittest.TestCase):
    """(09-nov, Grok 115) carga única: papel ↔ Firestore por legacy_id, antes de emitir y dentro de la transacción."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = mf.armar_plan(mf.cargar(export_sintetico(Path(self.tmp.name) / 'e')))
        import saldos_papel as sp
        self.sp = sp
        legacy_de = {m['id']: m['legacy_id'] for m in self.p.miembros}
        self.tarjeta = next(mv for mv in self.p.movimientos if mv['tipo'] == 'tarjeta')
        self.legacy = legacy_de[self.tarjeta['miembro_id']]
        self.fecha = self.sp._fecha_cr(self.tarjeta['fecha']).isoformat()

    def tearDown(self):
        self.tmp.cleanup()

    def filas(self, *lineas):
        filas, err = self.sp.validar('legacy_id,personas,fecha_tarjeta,referencia\n' + ''.join(lineas), mf_date_today())
        self.assertEqual(err, [])
        return filas

    def test_interseccion_en_python(self):
        f = self.filas(f"{self.legacy},{self.tarjeta['personas']},{self.fecha},PAPEL-115\n")
        self.assertEqual([x['linea'] for x in mf.cruce_papel_firestore(self.p, f)['en_los_dos']], [2])
        f = self.filas(f"{self.legacy},{self.tarjeta['personas'] + 1},{self.fecha},PAPEL-115\n")
        self.assertEqual(mf.cruce_papel_firestore(self.p, f)['en_los_dos'], [])

    def test_el_cruce_va_en_la_transaccion_y_pasa_la_lista_cerrada(self):
        f = self.filas(f"{self.legacy},{self.tarjeta['personas'] + 1},{self.fecha},PAPEL-115\n")
        papel = self.sp.sql_cruce_firestore(f, mf.LOCATION) + self.sp.cuerpo_sql(f, mf.LOCATION, 'prod', 'carga')
        sql = mf.sql_apply(self.p, primera=True, fecha_carga=True, papel=papel)
        self.assertLess(sql.index('YA están en Firestore'), sql.index('insert into public.club_cargas_papel'))
        self.assertGreater(sql.index('YA están en Firestore'), sql.index('create temp table _datos'))
        import sql_g56
        self.assertEqual(sql_g56.revisar_migrador(sql, papel=True), [])


class AplicarFirmado(unittest.TestCase):
    """(09-nov, punto 4) La primera carga emitida pasa la lista cerrada del migrador y se aplica solo firmada."""
    MF = str(Path(__file__).resolve().parent / 'migrar_firestore.py')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.exp = export_sintetico(self.dir / 'e')

    def tearDown(self):
        self.tmp.cleanup()

    def correr(self, *args, env=None):
        import subprocess
        return subprocess.run([sys.executable, '-I', self.MF, *args], capture_output=True, text=True,
                              env={**os.environ, **(env or {})})

    def emitir(self):
        r = self.correr('--export', str(self.exp), '--local', 'santa-teresa', '--primera-carga', '--acepto-inactivos',
                        str(self._inactivos()), '--out', str(self.dir / 'out'), '--emitir', str(self.dir / 'emit'))
        self.assertEqual(r.returncode, 0, r.stdout[-800:] + r.stderr[-800:])
        carga = self.dir / 'emit' / 'carga.sql'
        h = json.loads((self.dir / 'emit' / 'resumen.json').read_text())['sha256_sql']
        self.assertEqual(hashlib.sha256(carga.read_text(encoding='utf-8').encode()).hexdigest(), h)
        return carga, h

    def _inactivos(self):
        import datetime as _dt
        p = mf.armar_plan(mf.cargar(self.exp))
        return len(mf.inactivos_fuente(p, _dt.date.today().isoformat(), 12))

    def test_emitir_pasa_la_lista_cerrada_y_aplicar_niega_sin_firma_o_sin_confirmar_prod(self):
        carga, h = self.emitir()
        import sql_g56
        self.assertEqual(sql_g56.revisar_migrador(carga.read_text(encoding='utf-8'), papel=False), [])
        r = self.correr('aplicar-firmado', '--archivo', str(carga), '--sha256', '0' * 64)
        self.assertNotEqual(r.returncode, 0); self.assertIn('no es el firmado', r.stdout + r.stderr)
        r = self.correr('aplicar-firmado', '--archivo', str(carga), '--sha256', h, '--ref', mf.PROD_REF, env={'CLUB_G56_PROD': ''})
        self.assertNotEqual(r.returncode, 0); self.assertIn('NEGADO', r.stdout + r.stderr)
        r = self.correr('aplicar-firmado', '--archivo', str(carga), '--sha256', h, '--ref', mf.PROD_REF,
                        '--confirmo-ref', 'otro', env={'CLUB_G56_PROD': 'si'})
        self.assertNotEqual(r.returncode, 0); self.assertIn('NEGADO', r.stdout + r.stderr)
        # un ensayo (termina en rollback) no se aplica, aunque la firma sea la suya
        ens = self.dir / 'ensayo.sql'
        ens.write_text(carga.read_text(encoding='utf-8').rstrip()[:-len('commit;')] + 'rollback;\n', encoding='utf-8')
        r = self.correr('aplicar-firmado', '--archivo', str(ens), '--sha256', hashlib.sha256(ens.read_bytes()).hexdigest())
        self.assertNotEqual(r.returncode, 0); self.assertIn('termina en commit', r.stdout + r.stderr)
        # trucado (con su propio sha256): el filtro lo frena antes de mandar nada
        tr = self.dir / 'trucado.sql'
        tr.write_text(carga.read_text(encoding='utf-8').replace('commit;', 'delete from public.club_movimientos;\ncommit;'), encoding='utf-8')
        r = self.correr('aplicar-firmado', '--archivo', str(tr), '--sha256', hashlib.sha256(tr.read_bytes()).hexdigest())
        self.assertNotEqual(r.returncode, 0); self.assertIn('FILTRO G-56 (migrador)', r.stdout + r.stderr)

    @unittest.skipUnless(os.environ.get('CLUB_ENSAYO_STAGING') == '1', 'contra staging (CLUB_ENSAYO_STAGING=1)')
    def test_staging_la_primera_carga_firmada_frena_por_cero_socios_y_no_escribe(self):
        carga, h = self.emitir()
        q = ("select (select count(*) from public.club_movimientos) m, (select count(*) from public.club_miembros) mi, "
             "(select count(*) from public.club_negocios) n")
        antes = mf.ejecutar(mf.STAGING_REF, q, read_only=True)
        r = self.correr('aplicar-firmado', '--archivo', str(carga), '--sha256', h)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('cero socios', r.stdout + r.stderr)
        self.assertEqual(mf.ejecutar(mf.STAGING_REF, q, read_only=True), antes)


@unittest.skipUnless(os.environ.get('CLUB_ENSAYO_STAGING') == '1', 'ensayo contra staging (CLUB_ENSAYO_STAGING=1)')
class EnsayoStaging(unittest.TestCase):
    """Contra STAGING, siempre con ensayo=True (ROLLBACK). Nunca --apply."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = mf.armar_plan(mf.cargar(export_sintetico(Path(self.tmp.name) / 'e')))
        # LC-ML: el local destino se pasa con --local; en staging, el del Club de prueba (CLUB_LOCAL para otro).
        self._loc = mf.LOCATION
        mf.LOCATION = os.environ.get('CLUB_LOCAL', 'santa-teresa')

    def tearDown(self):
        mf.LOCATION = self._loc
        self.tmp.cleanup()

    def conteo(self):
        return mf.ejecutar(mf.STAGING_REF, "select (select count(*) from public.club_movimientos) m, (select count(*) from public.club_miembros) mi",
                           read_only=True)[0]

    def test_ensayo_valida_y_no_deja_nada(self):
        antes = self.conteo()
        val = mf.ejecutar(mf.STAGING_REF, mf.sql_apply(self.p, {'miembros': 3, 'diferencias_saldo_vs_firestore': 0}, ensayo=True))[0]['r']
        self.assertEqual(val['miembros'], 3)
        self.assertEqual(val['diferencias_saldo_vs_firestore'], 0)
        self.assertEqual(val['vencer_simular_hoy'], 0)
        self.assertEqual(self.conteo(), antes)

    def test_19_esperado_distinto_hace_rollback(self):
        antes = self.conteo()
        with self.assertRaises(SystemExit) as cm:
            mf.ejecutar(mf.STAGING_REF, mf.sql_apply(self.p, {'miembros': 4}))   # sin ensayo: la validación lo frena
        self.assertIn('miembros: base=3 esperado=4', str(cm.exception))
        self.assertEqual(self.conteo(), antes)

    def test_20_error_forzado_sin_datos_personales(self):
        self.p.movimientos[0]['tipo'] = 'tipo-invalido'   # rompe el CHECK de club_movimientos
        with self.assertRaises(SystemExit) as cm:
            mf.ejecutar(mf.STAGING_REF, mf.sql_apply(self.p, ensayo=True))
        msg = str(cm.exception)
        self.assertIn('SQLSTATE', msg)
        self.assertNotIn('@', msg)
        self.assertNotIn('+506', msg)


    def test_b11_primera_carga_frena_si_la_base_no_esta_vacia(self):
        antes = self.conteo()
        with self.assertRaises(SystemExit) as cm:
            mf.ejecutar(mf.STAGING_REF, mf.sql_apply(self.p, ensayo=True, primera=True, fecha_carga=True))
        self.assertIn('cero socios', str(cm.exception))
        self.assertEqual(self.conteo(), antes)

    def test_b11_primera_carga_sobre_base_vacia_valida_y_no_deja_nada(self):
        antes = self.conteo()
        val = mf.ejecutar(mf.STAGING_REF, mf.sql_apply(self.p, {'miembros': 3, 'diferencias_saldo_vs_firestore': 0},
                                                      ensayo=True, primera=True, fecha_carga=True, vaciar_ensayo=True))[0]['r']
        self.assertEqual(val['miembros'], 3)
        self.assertEqual(val['diferencias_saldo_vs_firestore'], 0)
        self.assertEqual(val['vencer_simular_hoy'], 0)
        self.assertEqual(self.conteo(), antes)

    def test_b11_carga_unica_con_papel_en_la_misma_transaccion(self):
        import saldos_papel as sp
        legacy = [m['legacy_id'] for m in self.p.miembros if m['estado'] == 'activo'][:2]
        filas, err = sp.validar('legacy_id,personas,fecha_tarjeta,referencia\n' + ''.join(
            f'{l},6,2026-10-01,PAPEL-{i}\n' for i, l in enumerate(legacy)), mf_date_today())
        self.assertEqual(err, [])
        antes = self.conteo()
        papel = sp.sql_cruce_firestore(filas, mf.LOCATION) + sp.cuerpo_sql(filas, mf.LOCATION, 'staging', 'carga')
        val = mf.ejecutar(mf.STAGING_REF, mf.sql_apply(self.p, {'miembros': 3, 'diferencias_saldo_vs_firestore': 0},
                                                      ensayo=True, primera=True, fecha_carga=True, vaciar_ensayo=True,
                                                      papel=papel))[0]['r']
        self.assertEqual(val['miembros'], 3)
        self.assertEqual(val['diferencias_saldo_vs_firestore'], 0)   # el papel no se mezcla con el cuadre de la página vieja
        self.assertEqual(self.conteo(), antes)


    def _papel_aborta(self, lineas: str, motivo: str):
        import saldos_papel as sp
        filas, err = sp.validar('legacy_id,personas,fecha_tarjeta,referencia\n' + lineas, mf_date_today())
        self.assertEqual(err, [])
        antes = self.conteo()
        papel = sp.sql_cruce_firestore(filas, mf.LOCATION) + sp.cuerpo_sql(filas, mf.LOCATION, 'staging', 'carga')
        with self.assertRaises((Exception, SystemExit)) as cm:
            mf.ejecutar(mf.STAGING_REF, mf.sql_apply(self.p, {'miembros': 3}, ensayo=True, primera=True, fecha_carga=True,
                                                    vaciar_ensayo=True, papel=papel))
        self.assertIn(motivo, str(cm.exception))
        self.assertEqual(self.conteo(), antes)

    def test_115_interseccion_con_firestore_aborta_en_la_transaccion(self):
        legacy_de = {m['id']: m['legacy_id'] for m in self.p.miembros}
        t = next(mv for mv in self.p.movimientos if mv['tipo'] == 'tarjeta')
        import saldos_papel as sp
        self._papel_aborta(f"{legacy_de[t['miembro_id']]},{t['personas']},{sp._fecha_cr(t['fecha']).isoformat()},PAPEL-115\n",
                           'YA están en Firestore')

    def test_115_fila_sin_cruzar_aborta_en_la_transaccion(self):
        self._papel_aborta('legacy-que-no-existe-115,6,2026-10-01,PAPEL-115\n', 'sin cruzar')


def mf_date_today():
    import datetime as _dt
    return _dt.date.today()


if __name__ == '__main__':
    unittest.main()
