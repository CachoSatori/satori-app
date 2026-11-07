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


@unittest.skipUnless(os.environ.get('CLUB_ENSAYO_STAGING') == '1', 'ensayo contra staging (CLUB_ENSAYO_STAGING=1)')
class EnsayoStaging(unittest.TestCase):
    """Contra STAGING, siempre con ensayo=True (ROLLBACK). Nunca --apply."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = mf.armar_plan(mf.cargar(export_sintetico(Path(self.tmp.name) / 'e')))

    def tearDown(self):
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


if __name__ == '__main__':
    unittest.main()
