// Comprobantes FICTICIOS para las pruebas del parser (F1). Nada real: emisor «Proveedor de prueba N», cédulas con
// patrón obvio (receptor 3101999999NN; emisor 9990000000NN, que no puede ser ninguna identificación real), montos inventados. Las muestras reales se
// prueban en staging y NO se suben (repo público, spec §4.4).

export const CEDULA_RECEPTOR = '310199999901'
// Emisor IMPOSIBLE de verdad: en los 12 dígitos de la clave toda identificación de Hacienda va rellenada con ceros a la
// izquierda (física 9 → «000…», jurídica 10 y empieza con 3 → «003…», NITE 10 → «00…») salvo el DIMEX (11–12, empieza
// con 1). Doce dígitos que empiezan con 9 no son física, ni jurídica, ni DIMEX, ni NITE.
export const CEDULA_EMISOR = '999000000001'

/** Clave de 50: 506 · DDMMAA · emisor (12) · consecutivo (20) · situación (1) · seguridad (8). */
export function claveFicticia(o: { ddmmaa?: string; emisor?: string; numero?: number; tipo?: string } = {}): string {
  const consecutivo = '001' + '00001' + (o.tipo ?? '01') + String(o.numero ?? 1).padStart(10, '0')
  return '506' + (o.ddmmaa ?? '301126') + (o.emisor ?? CEDULA_EMISOR) + consecutivo + '1' + '00000001'
}

export interface OpcionesXml {
  raiz?: string
  version?: '4.4' | '4.3' | '9.9'
  clave?: string | null
  fecha?: string
  receptor?: string | null
  moneda?: string | null
  lineas?: { total: string; impuesto?: string; codigo?: string }[]
  total?: string
  referencia?: string | null
  extra?: string
}

const NS: Record<string, string> = {
  FacturaElectronica: 'facturaElectronica',
  NotaCreditoElectronica: 'notaCreditoElectronica',
  NotaDebitoElectronica: 'notaDebitoElectronica',
  TiqueteElectronico: 'tiqueteElectronico',
  FacturaElectronicaCompra: 'facturaElectronicaCompra',
}

export function xmlFicticio(o: OpcionesXml = {}): string {
  const raiz = o.raiz ?? 'FacturaElectronica'
  const v = o.version ?? '4.4'
  const lineas = o.lineas ?? [{ total: '5650.00000', impuesto: '650.00000', codigo: 'ABC-24' }, { total: '4350.00000' }]
  const total = o.total ?? '10000.00000'
  const clave = o.clave === undefined ? claveFicticia() : o.clave
  const cabys = v === '4.4' ? 'CodigoCABYS' : 'Codigo'
  const tarifa = v === '4.4' ? 'CodigoTarifaIVA' : 'CodigoTarifa'
  const medio44 = v === '4.4' ? '<MedioPago><TipoMedioPago>04</TipoMedioPago></MedioPago>' : ''
  const medio43 = v === '4.3' ? '<MedioPago>04</MedioPago>' : ''
  const ld = lineas.map((l, i) => `
    <LineaDetalle>
      <NumeroLinea>${i + 1}</NumeroLinea>
      <${cabys}>1234567890123</${cabys}>
      ${l.codigo ? `<CodigoComercial><Tipo>04</Tipo><Codigo>OTRO-${i}</Codigo></CodigoComercial><CodigoComercial><Tipo>01</Tipo><Codigo>${l.codigo}</Codigo></CodigoComercial>` : ''}
      <Cantidad>3.000</Cantidad>
      <UnidadMedida>Unid</UnidadMedida>
      <UnidadMedidaComercial>caja</UnidadMedidaComercial>
      <Detalle>Producto ${String.fromCharCode(65 + i)} caja 24 Ud &amp; más</Detalle>
      <PrecioUnitario>1000.00000</PrecioUnitario>
      <MontoTotal>3000.00000</MontoTotal>
      <Descuento><MontoDescuento>0.00000</MontoDescuento><NaturalezaDescuento>ninguno</NaturalezaDescuento></Descuento>
      <SubTotal>3000.00000</SubTotal>
      ${l.impuesto ? `<Impuesto><Codigo>01</Codigo><${tarifa}>08</${tarifa}><Tarifa>13.00</Tarifa><Monto>${l.impuesto}</Monto></Impuesto>` : ''}
      <ImpuestoNeto>${l.impuesto ?? '0.00000'}</ImpuestoNeto>
      <MontoTotalLinea>${l.total}</MontoTotalLinea>
    </LineaDetalle>`).join('')
  const receptor = o.receptor === null ? '' :
    `<Receptor><Nombre>Negocio de prueba</Nombre><Identificacion><Tipo>02</Tipo><Numero>${o.receptor ?? CEDULA_RECEPTOR}</Numero></Identificacion></Receptor>`
  const moneda = o.moneda === null ? '' :
    `<CodigoTipoMoneda><CodigoMoneda>${o.moneda ?? 'CRC'}</CodigoMoneda><TipoCambio>1.00000</TipoCambio></CodigoTipoMoneda>`
  const ref = o.referencia ? `<InformacionReferencia><${v === '4.4' ? 'TipoDocIR' : 'TipoDoc'}>01</${v === '4.4' ? 'TipoDocIR' : 'TipoDoc'}><Numero>${o.referencia}</Numero><FechaEmisionIR>2026-11-30T08:00:00-06:00</FechaEmisionIR><Codigo>01</Codigo><Razon>Anula documento de prueba</Razon></InformacionReferencia>` : ''
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- comprobante ficticio de prueba -->
<${raiz} xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v${v}/${NS[raiz] ?? 'otro'}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  ${clave == null ? '' : `<Clave>${clave}</Clave>`}
  <ProveedorSistemas>${CEDULA_EMISOR}</ProveedorSistemas>
  <CodigoActividadEmisor>000000</CodigoActividadEmisor>
  <NumeroConsecutivo>00100001010000000001</NumeroConsecutivo>
  <FechaEmision>${o.fecha ?? '2026-11-30T09:15:00-06:00'}</FechaEmision>
  <Emisor>
    <Nombre>Proveedor de prueba 1</Nombre>
    <Identificacion><Tipo>02</Tipo><Numero>${CEDULA_EMISOR}</Numero></Identificacion>
    <NombreComercial>Proveedor de prueba 1</NombreComercial>
  </Emisor>
  ${receptor}
  <CondicionVenta>02</CondicionVenta>
  <PlazoCredito>30</PlazoCredito>
  ${medio43}
  <DetalleServicio>${ld}
  </DetalleServicio>
  <ResumenFactura>
    ${moneda}
    <TotalVentaNeta>9000.00000</TotalVentaNeta>
    <TotalImpuesto>650.00000</TotalImpuesto>
    <TotalDescuentos>0.00000</TotalDescuentos>
    ${medio44}
    <TotalComprobante>${total}</TotalComprobante>
  </ResumenFactura>
  ${ref}
  ${o.extra ?? ''}
  <ds:Signature Id="firma-ficticia"><ds:SignedInfo/><ds:SignatureValue>AAAA</ds:SignatureValue></ds:Signature>
</${raiz}>`
}

export function mensajeHaciendaFicticio(clave: string, mensaje = '1'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MensajeHacienda xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda">
  <Clave>${clave}</Clave>
  <NombreEmisor>Proveedor de prueba 1</NombreEmisor>
  <TipoIdentificacionEmisor>02</TipoIdentificacionEmisor>
  <NumeroCedulaEmisor>${CEDULA_EMISOR}</NumeroCedulaEmisor>
  <NumeroCedulaReceptor>${CEDULA_RECEPTOR}</NumeroCedulaReceptor>
  <Mensaje>${mensaje}</Mensaje>
  <DetalleMensaje>Mensaje de prueba</DetalleMensaje>
  <MontoTotalImpuesto>650.00000</MontoTotalImpuesto>
  <TotalFactura>10000.00000</TotalFactura>
</MensajeHacienda>`
}

export const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
