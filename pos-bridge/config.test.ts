import { describe, it, expect } from 'vitest'

import {
  describirConfig,
  loadPosConfig,
  overridesColumnas,
  parseEnvFile,
  partirHost,
  USUARIOS_PROHIBIDOS,
  type Env,
} from './config.ts'
import { assertSoloSelect } from './sqlGuard.ts'

const ENV_MINIMO: Env = {
  POS_DB_HOST:     'DESKTOP-25PRDR1\\SQLNUBE',
  POS_DB_PORT:     '1433',
  POS_DB_USER:     'ClienteConsulta',
  POS_DB_PASSWORD: 'secreto-que-no-va-al-repo',
}

describe('parseEnvFile', () => {
  it('lee KEY=VALUE, ignora comentarios y saca las comillas', () => {
    expect(parseEnvFile([
      '# comentario',
      '',
      'POS_DB_HOST=DESKTOP-25PRDR1\\SQLNUBE   # la instancia',
      'POS_DB_PASSWORD="con espacios y # adentro"',
      "POS_DB_USER='ClienteConsulta'",
    ].join('\n'))).toEqual({
      POS_DB_HOST:     'DESKTOP-25PRDR1\\SQLNUBE',
      POS_DB_PASSWORD: 'con espacios y # adentro',
      POS_DB_USER:     'ClienteConsulta',
    })
  })
})

describe('partirHost', () => {
  it('separa la instancia nombrada', () => {
    expect(partirHost('DESKTOP-25PRDR1\\SQLNUBE')).toEqual({ server: 'DESKTOP-25PRDR1', instanceName: 'SQLNUBE' })
    expect(partirHost('192.168.0.10')).toEqual({ server: '192.168.0.10', instanceName: null })
  })
})

describe('loadPosConfig', () => {
  it('arma la configuración con los defaults de una instalación local', () => {
    const cfg = loadPosConfig(ENV_MINIMO)
    expect(cfg.server).toBe('DESKTOP-25PRDR1')
    expect(cfg.port).toBe(1433)
    expect(cfg.database).toBe('ndf')
    expect(cfg.encrypt).toBe(false)
    expect(cfg.trustServerCertificate).toBe(true)
  })

  it('puerto e instancia son excluyentes: con puerto, la instancia se descarta', () => {
    expect(loadPosConfig(ENV_MINIMO).instanceName).toBeNull()
    const sinPuerto = loadPosConfig({ ...ENV_MINIMO, POS_DB_PORT: '' })
    expect(sinPuerto.instanceName).toBe('SQLNUBE')
    expect(sinPuerto.port).toBeNull()
  })

  it('el admin del PoS NO se usa jamás', () => {
    for (const prohibido of USUARIOS_PROHIBIDOS) {
      expect(() => loadPosConfig({ ...ENV_MINIMO, POS_DB_USER: prohibido.toUpperCase() }))
        .toThrow(/administrativo/)
    }
  })

  it('sin contraseña no arranca', () => {
    expect(() => loadPosConfig({ ...ENV_MINIMO, POS_DB_PASSWORD: '' })).toThrow(/POS_DB_PASSWORD/)
  })

  it('sin host no arranca', () => {
    expect(() => loadPosConfig({ ...ENV_MINIMO, POS_DB_HOST: '' })).toThrow(/POS_DB_HOST/)
  })

  it('valida los enteros y los booleanos del .env', () => {
    expect(() => loadPosConfig({ ...ENV_MINIMO, POS_DB_PORT: 'mil' })).toThrow(/POS_DB_PORT/)
    expect(() => loadPosConfig({ ...ENV_MINIMO, POS_DB_ENCRYPT: 'quizás' })).toThrow(/POS_DB_ENCRYPT/)
    expect(loadPosConfig({ ...ENV_MINIMO, POS_DB_ENCRYPT: 'true' }).encrypt).toBe(true)
  })
})

describe('overridesColumnas', () => {
  it('POS_COL_<TABLA>_<CAMPO> → clave del esquema', () => {
    expect(overridesColumnas({
      POS_COL_FACTURASDET_MONTO: 'MontoTotal',
      POS_COL_PRODUCTOS_CLASIFICACION: ' CodigoClasificacion ',
      POS_COL_VACIO: '',
      OTRA_COSA: 'x',
    })).toEqual({
      'facturasdet.monto': 'MontoTotal',
      'productos.clasificacion': 'CodigoClasificacion',
    })
  })
})

describe('describirConfig', () => {
  it('NUNCA imprime la contraseña', () => {
    const cfg = loadPosConfig(ENV_MINIMO)
    const linea = describirConfig(cfg)
    expect(linea).not.toContain(cfg.password)
    expect(linea).toContain('DESKTOP-25PRDR1:1433/ndf')
    expect(linea).toContain('ClienteConsulta')
  })
})

describe('assertSoloSelect', () => {
  it('deja pasar un SELECT solo', () => {
    expect(() => assertSoloSelect('SELECT a FROM t WHERE b = @x')).not.toThrow()
  })

  it('frena escrituras, DDL y sentencias encadenadas', () => {
    expect(() => assertSoloSelect('UPDATE t SET a = 1')).toThrow(/no empieza con SELECT/)
    expect(() => assertSoloSelect('SELECT 1; DROP TABLE FAC_Facturas')).toThrow(/más de una sentencia/)
    expect(() => assertSoloSelect('SELECT * FROM t WHERE 1=1 DELETE FROM t')).toThrow(/verbo de escritura/)
    expect(() => assertSoloSelect('SELECT 1 EXEC sp_who')).toThrow(/verbo de escritura/)
  })
})
