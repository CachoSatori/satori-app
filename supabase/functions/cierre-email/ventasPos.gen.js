// GENERADO — no editar a mano. Fuente: src/modules/ventas/resumenCierrePuro.ts @ ce4974e6
// Regenerar: node scripts/edge/empaquetar-ventas-pos.mjs --entrada src/modules/ventas/resumenCierrePuro.ts <salida>  ·  sha256(cuerpo) e01620c3524726cee05e6e2232b87f463d64815a7853391d018ab183d257e0fc
// deno-lint-ignore-file
// @ts-nocheck
const CR_OFFSET = "-06:00";
function ventanaRangoJornadas(desde, hasta) {
    const dia = (fecha, mas) => {
        const [y, m, d] = fecha.split("-").map(Number);
        return new Date(Date.UTC(y, m - 1, d + mas)).toISOString().slice(0, 10);
    };
    return {
        desde: `${dia(desde, -1)}T00:00:00${CR_OFFSET}`,
        hasta: `${dia(hasta, 2)}T00:00:00${CR_OFFSET}`
    };
}
const MS_HORA = 36e5;
const CAJAS_POR_LOGIN = Object.freeze({
    "111": {
        turno: "manana",
        etiqueta: "Mañana · almuerzo",
        orden: 1
    },
    "222": {
        turno: "tarde",
        etiqueta: "Tarde · noche",
        orden: 2
    }
});
function cajaDeLogin(cajeroLogin) {
    const l = cajeroLogin?.trim();
    return l ? CAJAS_POR_LOGIN[l] ?? null : null;
}
function fechaCR(iso) {
    if (!iso)
        return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t))
        return null;
    return new Date(t + -6 * MS_HORA).toISOString().slice(0, 10);
}
function instanteCanonico(iso) {
    if (!iso)
        return null;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
}
function turnoDeCajero(cajeroLogin) {
    return cajaDeLogin(cajeroLogin)?.turno ?? null;
}
function claveLote(t) {
    const cajero = t.cajero_login?.trim() || "(sin cajero)";
    const cierre = instanteCanonico(t.fecha_cierra);
    if (cierre !== null)
        return `${cajero}|${cierre}`;
    return `${cajero}|abierto|${fechaCR(t.fecha_registra) ?? "(sin fecha)"}`;
}
function agruparEnLotes(tickets) {
    const porClave = new Map();
    for (const t of tickets) {
        const k = claveLote(t);
        const lista = porClave.get(k);
        if (lista)
            lista.push(t);
        else
            porClave.set(k, [t]);
    }
    const lotes = [];
    for (const [clave, propios] of porClave) {
        const cierre = instanteCanonico(propios[0]?.fecha_cierra);
        let apertura = null;
        let aperturaMs = Number.POSITIVE_INFINITY;
        for (const t of propios) {
            const ms = Date.parse(t.fecha_registra);
            if (!Number.isNaN(ms) && ms < aperturaMs) {
                aperturaMs = ms;
                apertura = new Date(ms).toISOString();
            }
        }
        lotes.push({
            clave,
            cajeroLogin: propios[0]?.cajero_login?.trim() || null,
            fechaCierra: cierre,
            turno: turnoDeCajero(propios[0]?.cajero_login),
            jornada: fechaCR(apertura),
            abierto: cierre === null,
            apertura,
            tickets: propios
        });
    }
    return lotes.sort((a, b) => (a.apertura ?? "").localeCompare(b.apertura ?? "") || a.clave.localeCompare(b.clave));
}
function jornadaPorTicket(tickets) {
    const out = new Map();
    for (const lote of agruparEnLotes(tickets))
        for (const t of lote.tickets)
            out.set(t, {
                jornada: lote.jornada,
                turno: lote.turno,
                lote
            });
    return out;
}
const LOGINS_SISTEMA = ["002", "02"];
const SALONEROS_CONOCIDOS = {};
const FAMILIAS_VALOR_SERVIDO = [
    2,
    3,
    4,
    5,
    13,
    16,
    29
];
function texto(v) {
    if (v === null || v === void 0)
        return null;
    const s = String(v).trim();
    return s === "" ? null : s;
}
function esLoginSistema(login) {
    const l = texto(login);
    return l !== null && LOGINS_SISTEMA.includes(l);
}
const SIN_CODIGO = "(sin codigo)";
const POR_CODIGO = new Map([
    {
        id: "0909",
        rol: "mesero",
        etiqueta: "0909 · sin asignar",
        codigos: ["0909"],
        vigencias: { "0909": {
                desde: "2025-01-07",
                hasta: "2026-05-09"
            } }
    },
    {
        id: "333",
        rol: "mesero",
        etiqueta: "333 · sin asignar",
        codigos: ["333"],
        vigencias: { "333": {
                desde: "2025-01-01",
                hasta: "2025-10-22"
            } }
    },
    {
        id: "999",
        rol: "mesero",
        etiqueta: "999 · sin asignar",
        codigos: ["999"],
        inactivo: true,
        vigencias: { "999": {
                desde: "2025-01-01",
                hasta: "2025-07-02"
            } }
    },
    {
        id: "444",
        rol: "mesero",
        etiqueta: "444 · sin asignar",
        codigos: ["444"]
    },
    {
        id: "026",
        rol: "mesero",
        etiqueta: "026 · sin asignar",
        codigos: ["026"]
    },
    {
        id: "028",
        rol: "mesero",
        etiqueta: "028 · sin asignar",
        codigos: ["028"]
    },
    {
        id: "03",
        rol: "mesero",
        etiqueta: "03 · sin asignar",
        codigos: ["03"],
        vigencias: { "03": {
                desde: "2025-01-01",
                hasta: "2026-01-18"
            } }
    },
    {
        id: "027",
        rol: "mesero",
        etiqueta: "027 · sin asignar",
        codigos: ["027"]
    },
    {
        id: "025",
        rol: "mesero",
        etiqueta: "025 · sin asignar",
        codigos: ["025"]
    },
    {
        id: "032",
        rol: "mesero",
        etiqueta: "032 · sin asignar",
        codigos: ["032"]
    },
    {
        id: "029",
        rol: "mesero",
        etiqueta: "029 · sin asignar",
        codigos: ["029"]
    },
    {
        id: "034",
        rol: "mesero",
        etiqueta: "034 · sin asignar",
        codigos: ["034"]
    },
    {
        id: "024",
        rol: "mesero",
        etiqueta: "024 · sin asignar",
        codigos: ["024"]
    },
    {
        id: "04",
        rol: "mesero",
        etiqueta: "04 · sin asignar",
        codigos: ["04"],
        inactivo: true,
        vigencias: { "04": {
                desde: "2025-02-23",
                hasta: "2025-05-07"
            } }
    },
    {
        id: "030",
        rol: "mesero",
        etiqueta: "030 · sin asignar",
        codigos: ["030"]
    },
    {
        id: "033",
        rol: "mesero",
        etiqueta: "033 · sin asignar",
        codigos: ["033"]
    },
    {
        id: "035",
        rol: "mesero",
        etiqueta: "035 · sin asignar",
        codigos: ["035"]
    },
    {
        id: "036",
        rol: "mesero",
        etiqueta: "036 · sin asignar",
        codigos: ["036"]
    },
    {
        id: "037",
        rol: "mesero",
        etiqueta: "037 · sin asignar",
        codigos: ["037"]
    },
    {
        id: "039",
        rol: "mesero",
        etiqueta: "039 · sin asignar",
        codigos: ["039"]
    },
    {
        id: "01",
        rol: "mesero",
        etiqueta: "01 · sin asignar",
        codigos: ["01", "235"]
    },
    {
        id: "023",
        rol: "mesero",
        etiqueta: "023 · sin asignar",
        codigos: ["023", "555"]
    },
    {
        id: "038",
        rol: "mesero",
        etiqueta: "038 · sin asignar",
        codigos: ["038", "266"]
    },
    {
        id: "111",
        rol: "caja",
        etiqueta: "Caja mañana",
        codigos: ["111"]
    },
    {
        id: "222",
        rol: "caja",
        etiqueta: "Caja noche",
        codigos: ["222"]
    },
    {
        id: "388",
        rol: "caja",
        etiqueta: "Caja bar",
        codigos: ["388"]
    },
    {
        id: "02",
        rol: "generico",
        etiqueta: "Login compartido (xx)",
        codigos: ["02"]
    }
].flatMap((p) => p.codigos.map((c) => [c, Object.freeze(p)])));
const desconocidas = new Map();
const sinNombre = new Map();
function vigente(persona, codigo, fecha) {
    const v = persona.vigencias?.[codigo];
    if (!v || !fecha)
        return true;
    return (v.desde === void 0 || fecha >= v.desde) && (v.hasta === void 0 || fecha <= v.hasta);
}
function loginSinNombre(persona, codigo) {
    let p = sinNombre.get(codigo);
    if (!p) {
        p = Object.freeze({
            id: `login ${codigo}`,
            rol: persona.rol,
            etiqueta: `login ${codigo}`,
            codigos: Object.freeze([codigo]),
            fueraDeVigencia: true
        });
        sinNombre.set(codigo, p);
    }
    return p;
}
function clasificarCodigo(codigo, fecha) {
    const c = (codigo ?? "").trim();
    if (c === "")
        return PERSONA_SIN_CODIGO;
    const conocida = POR_CODIGO.get(c);
    if (conocida)
        return vigente(conocida, c, fecha) ? conocida : loginSinNombre(conocida, c);
    let suelta = desconocidas.get(c);
    if (!suelta) {
        suelta = Object.freeze({
            id: c,
            rol: "otro",
            etiqueta: c,
            codigos: Object.freeze([c])
        });
        desconocidas.set(c, suelta);
    }
    return suelta;
}
const PERSONA_SIN_CODIGO = Object.freeze({
    id: SIN_CODIGO,
    rol: "otro",
    etiqueta: "Sin código",
    codigos: Object.freeze([])
});
function nombreDePersona(persona, nombres) {
    if (persona.fueraDeVigencia)
        return persona.etiqueta;
    for (const c of persona.codigos) {
        const n = nombres[c]?.trim();
        if (n)
            return n;
    }
    for (const c of persona.codigos) {
        const n = SALONEROS_CONOCIDOS[c]?.trim();
        if (n)
            return n;
    }
    return persona.etiqueta;
}
function nombreDeCodigo(codigo, nombres, fecha) {
    const c = (codigo ?? "").trim();
    if (c === "")
        return null;
    const persona = clasificarCodigo(c, fecha);
    if (persona.rol === "mesero")
        return nombreDePersona(persona, nombres);
    return nombres[c]?.trim() || SALONEROS_CONOCIDOS[c]?.trim() || null;
}
const ETIQUETA_TURNO_POS = {
    "mañana": "Mañana",
    "manana": "Mañana",
    "noche": "Tarde",
    "tarde": "Tarde"
};
const CLAVE_CAJERO_MANANA = `Cajero turno ${ETIQUETA_TURNO_POS["mañana"].toLowerCase()}`;
const CLAVE_CAJERO_TARDE = `Cajero turno ${ETIQUETA_TURNO_POS["noche"].toLowerCase()}`;
const CLAVE_SALON_SIN_MESERO = "Salón sin mesero";
const CLAVE_CAJERO_SALON = "Cajero-salón";
const CLAVE_SISTEMA_OTROS = "Sistema y otros";
function claveNoMesero(registradoPor, cajeroLogin = null, canal = null) {
    const esSalon = canal === "salon";
    if (registradoPor === "cajero") {
        if (esSalon)
            return CLAVE_CAJERO_SALON;
        return cajeroLogin === "222" ? CLAVE_CAJERO_TARDE : CLAVE_CAJERO_MANANA;
    }
    if (registradoPor === "sin_pedido" && esSalon)
        return CLAVE_SALON_SIN_MESERO;
    return CLAVE_SISTEMA_OTROS;
}
const FAMILIAS_NO_VENTA = [
    6,
    17,
    20
];
const FAMILIAS_CATALOGO = [
    1,
    2,
    3,
    4,
    5,
    6,
    9,
    11,
    12,
    13,
    15,
    16,
    17,
    19,
    20,
    21,
    22,
    23,
    24,
    25,
    26,
    27,
    28,
    29
];
const n$2 = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
function esLineaDeVenta(familia) {
    return familia === null || familia === void 0 || !FAMILIAS_NO_VENTA.includes(familia);
}
function netaDelTicket(t, lineas, avisos) {
    if (!lineas || lineas.length === 0) {
        const vs = n$2(t.valor_servido_crc);
        if (avisos && vs !== 0)
            avisos.push({
                tipo: "sin_lineas",
                numero_factura: t.numero_factura ?? "?",
                codigo: null,
                nombre: null,
                familia: null,
                monto: vs
            });
        return vs;
    }
    let neta = 0;
    for (const l of lineas) {
        if (!esLineaDeVenta(l.familia))
            continue;
        const monto = n$2(l.monto);
        neta += monto;
        if (!avisos || monto === 0)
            continue;
        const tipo = l.familia === null || l.familia === void 0 ? "sin_familia" : FAMILIAS_CATALOGO.includes(l.familia) ? null : "familia_desconocida";
        if (tipo)
            avisos.push({
                tipo,
                numero_factura: t.numero_factura ?? "?",
                codigo: l.codigo_producto,
                nombre: l.nombre ?? null,
                familia: l.familia ?? null,
                monto
            });
    }
    return neta;
}
function netaPorTicket(tickets, lineas) {
    const porTicket = new Map();
    for (const l of lineas) {
        const lista = porTicket.get(l.ticket_id);
        if (lista)
            lista.push(l);
        else
            porTicket.set(l.ticket_id, [l]);
    }
    const out = new Map();
    for (const t of tickets)
        out.set(t.id, netaDelTicket(t, porTicket.get(t.id)));
    return out;
}
const DIA_MS = 864e5;
const aMs = (d) => Date.parse(`${d}T00:00:00Z`);
const aDia = (ms) => new Date(ms).toISOString().slice(0, 10);
function sumarDias(d, n) {
    return aDia(aMs(d) + n * DIA_MS);
}
function diaSemana(d) {
    return (new Date(aMs(d)).getUTCDay() + 6) % 7;
}
function lunesDe(d) {
    return sumarDias(d, -diaSemana(d));
}
function turnoDeFranja(f) {
    return f === "mañana" ? "mañana" : "noche";
}
const n$1 = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
const HORA_MS = 36e5;
const CON_ZONA = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
function msParedCR(fecha) {
    const iso = CON_ZONA.test(fecha.trim()) ? fecha.trim() : `${fecha.trim().replace(" ", "T")}-06:00`;
    return Date.parse(iso) - 6 * HORA_MS;
}
function diaCRDeFactura(fecha) {
    const ms = msParedCR(fecha);
    return Number.isNaN(ms) ? "" : new Date(ms).toISOString().slice(0, 10);
}
function horaCRDeFactura(fecha) {
    const ms = msParedCR(fecha);
    return Number.isNaN(ms) ? -1 : new Date(ms).getUTCHours();
}
function franjaDeHora(h) {
    if (h >= 6 && h <= 16)
        return "mañana";
    if (h >= 17 && h <= 23)
        return "noche";
    return "madrugada";
}
function turnoPorHora(f) {
    return turnoDeFranja(franjaDeHora(horaCRDeFactura(f.fecha_registra)));
}
function turnoDeCaja(t) {
    if (t === "manana")
        return "mañana";
    if (t === "tarde")
        return "noche";
    return null;
}
function ubicarFacturas(facturas) {
    const out = new Map();
    const lotes = jornadaPorTicket(facturas);
    for (const f of facturas) {
        const diaReloj = diaCRDeFactura(f.fecha_registra);
        if (!diaReloj)
            continue;
        const l = lotes.get(f);
        const turno = turnoDeCaja(l?.turno ?? null);
        if (!l || !turno || !l.jornada) {
            out.set(f, {
                dia: diaReloj,
                turno: turnoPorHora(f),
                inferido: true
            });
            continue;
        }
        let dia = l.jornada;
        if (l.lote.abierto && turno === "noche" && horaCRDeFactura(f.fecha_registra) < 7)
            dia = sumarDias(diaReloj, -1);
        out.set(f, {
            dia,
            turno,
            inferido: false
        });
    }
    return out;
}
function esMesaDeDuenos(f) {
    if (typeof f.neta_duenos === "number")
        return f.neta_duenos > 0 && f.neta_duenos * 2 > n$1(f.neta);
    return f.clase_ingreso === "duenos";
}
function quedaFueraDelIndicador(f) {
    if (esMesaDeDuenos(f))
        return "duenos";
    if (esRegaliaTotal(f))
        return "regalia";
    return null;
}
const CLASES_REGALIA_TOTAL = [
    "cortesia",
    "duenos",
    "sin_cobro"
];
function esRegaliaTotal(f) {
    if (f.clase_ingreso === "sin_cobro")
        return true;
    if (!(typeof f.total_crc === "number" && f.total_crc <= 0))
        return false;
    return CLASES_REGALIA_TOTAL.includes(f.clase_ingreso ?? "") || n$1(f.neta) === 0;
}
function personasCargadas(f) {
    const articulo = n$1(f.pax_articulo);
    return articulo > 0 ? articulo : n$1(f.pax);
}
function esFacturaDeSalon(f) {
    return (f.estado === void 0 || f.estado === null || f.estado === "C") && f.canal === "salon";
}
function enRango(dia, r) {
    return dia !== "" && dia >= r.desde && dia <= r.hasta;
}
function facturasDesdePos(tickets, lineas) {
    const neta = netaPorTicket(tickets, lineas);
    const duenos = new Map();
    const conLineas = new Set();
    for (const l of lineas) {
        conLineas.add(l.ticket_id);
        if (l.familia === 28)
            duenos.set(l.ticket_id, (duenos.get(l.ticket_id) ?? 0) + n$1(l.monto));
    }
    return tickets.map((t) => ({
        id: t.id,
        fecha_registra: t.fecha_registra,
        estado: t.estado,
        canal: t.canal,
        salonero_login: t.salonero_login,
        pax: t.pax,
        pax_articulo: t.pax_articulo,
        neta: neta.get(t.id) ?? 0,
        cajero_login: t.cajero_login,
        fecha_cierra: t.fecha_cierra,
        total_crc: t.total_crc,
        clase_ingreso: t.clase_ingreso ?? null,
        ...conLineas.has(t.id) ? { neta_duenos: duenos.get(t.id) ?? 0 } : {}
    }));
}
function estimadorPorNeta(historial) {
    const ubic = ubicarFacturas(historial);
    const acc = new Map();
    for (const f of historial) {
        if (!esFacturaDeSalon(f) || quedaFueraDelIndicador(f))
            continue;
        const p = personasCargadas(f);
        if (p <= 0)
            continue;
        const u = ubic.get(f);
        if (!u)
            continue;
        const k = `${lunesDe(u.dia)}|${u.turno}`;
        const e = acc.get(k) ?? {
            neta: 0,
            personas: 0
        };
        e.neta += n$1(f.neta);
        e.personas += p;
        acc.set(k, e);
    }
    const referencia = (lunes, turno) => {
        const e = acc.get(`${lunes}|${turno}`);
        if (e && e.personas > 0 && e.neta > 0)
            return e.neta / e.personas;
        let neta = 0, personas = 0;
        for (let i = 1; i <= 4; i++) {
            const r = acc.get(`${sumarDias(lunes, -7 * i)}|${turno}`);
            if (r) {
                neta += r.neta;
                personas += r.personas;
            }
        }
        return personas > 0 && neta > 0 ? neta / personas : null;
    };
    return {
        id: "v1-neta",
        estimar(f, u) {
            const ref = referencia(lunesDe(u.dia), u.turno);
            if (ref === null)
                return null;
            return Math.max(1, Math.round(n$1(f.neta) / ref));
        }
    };
}
function ventaPorPersona(facturas, r, opciones = {}) {
    const estimador = opciones.estimador ?? estimadorPorNeta(facturas);
    const ubic = ubicarFacturas(facturas);
    let netaSalon = 0, netaConPax = 0, cargadas = 0, estimadas = 0;
    let facturasSalon = 0, sinPax = 0, sinRef = 0, netaSinRef = 0;
    let regalias = 0, netaRegalias = 0, duenos = 0, netaDuenos = 0, inferidos = 0, sinSalonero = 0;
    for (const f of facturas) {
        if (!esFacturaDeSalon(f))
            continue;
        const u = ubic.get(f);
        if (!u || !enRango(u.dia, r))
            continue;
        if (opciones.turno && u.turno !== opciones.turno)
            continue;
        if (opciones.filtro && !opciones.filtro(f))
            continue;
        const neta = n$1(f.neta);
        facturasSalon += 1;
        if (u.inferido)
            inferidos += 1;
        if (!f.salonero_login)
            sinSalonero += 1;
        const fuera = quedaFueraDelIndicador(f);
        if (fuera === "duenos") {
            duenos += 1;
            netaDuenos += neta;
            continue;
        }
        if (fuera === "regalia") {
            regalias += 1;
            netaRegalias += neta;
            continue;
        }
        netaSalon += neta;
        const p = personasCargadas(f);
        if (p > 0) {
            cargadas += p;
            netaConPax += neta;
            continue;
        }
        sinPax += 1;
        const e = estimador.estimar(f, u);
        if (e === null) {
            sinRef += 1;
            netaSinRef += neta;
        }
        else
            estimadas += e;
    }
    const personas = cargadas + estimadas;
    return {
        valor: personas > 0 ? netaSalon / personas : null,
        valorSoloConPax: cargadas > 0 ? netaConPax / cargadas : null,
        netaSalon,
        personasCargadas: cargadas,
        personasEstimadas: estimadas,
        pctEstimado: personas > 0 ? estimadas / personas * 100 : 0,
        facturasSalon,
        facturasSinPax: sinPax,
        facturasSinReferencia: sinRef,
        netaSinReferencia: netaSinRef,
        regaliasTotales: regalias,
        netaRegaliasTotales: netaRegalias,
        mesasDuenos: duenos,
        netaMesasDuenos: netaDuenos,
        turnosInferidos: inferidos,
        facturasSinSalonero: sinSalonero,
        estimador: estimador.id
    };
}
function ventaPorPersonaDeTotales(netaSalon, personas) {
    const p = n$1(personas);
    return p > 0 ? n$1(netaSalon) / p : null;
}
function netaSalonDeSalonero(s) {
    return n$1(s.total) - n$1(s.delivery);
}
function ventaPorPersonaPorSalonero(facturas, r, opciones = {}) {
    const op = {
        ...opciones,
        estimador: opciones.estimador ?? estimadorPorNeta(facturas)
    };
    return {
        porSalonero: [...new Set(facturas.map((f) => f.salonero_login).filter((l) => !!l))].sort().map((login) => ({
            salonero_login: login,
            ...ventaPorPersona(facturas, r, {
                ...op,
                filtro: (f) => f.salonero_login === login
            })
        })).filter((s) => s.facturasSalon > 0),
        sinSalonero: ventaPorPersona(facturas, r, {
            ...op,
            filtro: (f) => !f.salonero_login
        })
    };
}
const CATALOGO = [
    {
        nombre: "ROLL SATORI",
        clasificacion: "SUSHI",
        tipo: "comida",
        peso: 100,
        precio: 11500
    },
    {
        nombre: "ROLL TEMPURA CAMARON",
        clasificacion: "SUSHI",
        tipo: "comida",
        peso: 86,
        precio: 12e3
    },
    {
        nombre: "SASHIMI MIXTO",
        clasificacion: "SUSHI",
        tipo: "comida",
        peso: 35,
        precio: 14e3
    },
    {
        nombre: "POKE BOWL ATUN",
        clasificacion: "COCINA",
        tipo: "comida",
        peso: 74,
        precio: 13500
    },
    {
        nombre: "RAMEN TONKOTSU",
        clasificacion: "COCINA",
        tipo: "comida",
        peso: 47,
        precio: 12800
    },
    {
        nombre: "GYOZAS (6)",
        clasificacion: "ENTRADAS",
        tipo: "comida",
        peso: 62,
        precio: 5800
    },
    {
        nombre: "IMPERIAL 350ML",
        clasificacion: "BEBIDAS",
        tipo: "bebida",
        peso: 58,
        precio: 3200
    },
    {
        nombre: "AGUA 600ML",
        clasificacion: "BEBIDAS",
        tipo: "bebida",
        peso: 30,
        precio: 1800
    },
    {
        nombre: "MARGARITA MARACUYA",
        clasificacion: "COCTELES",
        tipo: "bebida",
        peso: 41,
        precio: 7200
    },
    {
        nombre: "MOCHI (2)",
        clasificacion: "POSTRES",
        tipo: "comida",
        peso: 22,
        precio: 4800
    }
];
Object.fromEntries(CATALOGO.map((p) => [p.nombre, {
        tipo: p.tipo,
        clasificacion: p.clasificacion,
        subclasificacion: "",
        multiplicador: 1,
        costo_unitario: 0
    }]));
CATALOGO.map((p) => p.nombre);
const FAMILIAS_NETO = FAMILIAS_VALOR_SERVIDO;
const CATEGORIA_FAMILIA = {
    3: "Rolls",
    5: "Bebidas",
    2: "Entradas",
    16: "Platos fuertes",
    29: "GreenSeason",
    4: "Otros",
    13: "Otros"
};
const esFamiliaNeto = (f) => f !== null && FAMILIAS_NETO.includes(f);
const n = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
function paxDelTicket(t) {
    const articulo = n(t.pax_articulo);
    return articulo > 0 ? articulo : n(t.pax);
}
function claveSalonero(t) {
    if (t.registrado_por !== "salonero")
        return null;
    if (esLoginSistema(t.salonero_login))
        return null;
    return t.salonero_login ?? null;
}
function esDelivery(t) {
    return t.canal === "delivery";
}
function ventasPorCanal(tickets, netoDe = (t) => n(t.valor_servido_crc)) {
    let salon = 0, delivery = 0;
    for (const t of tickets) {
        const v = netoDe(t);
        if (esDelivery(t))
            delivery += v;
        else
            salon += v;
    }
    return {
        salon: Math.round(salon),
        delivery: Math.round(delivery)
    };
}
function esTicketOficial(t) {
    return t.estado === "C";
}
function armarDia(fecha, entrada, lineas, uploadedAt, nombres = {}) {
    const tickets = entrada.filter(esTicketOficial);
    const porTicket = new Map();
    for (const l of lineas) {
        const lista = porTicket.get(l.ticket_id);
        if (lista)
            lista.push(l);
        else
            porTicket.set(l.ticket_id, [l]);
    }
    const avisosCatalogo = [];
    const netaPorTicket = new Map();
    for (const t of tickets)
        netaPorTicket.set(t.id, netaDelTicket(t, porTicket.get(t.id), avisosCatalogo));
    const netoDe = (t) => netaPorTicket.get(t.id) ?? 0;
    const acc = new Map();
    const pm = {};
    let bruto = 0, servicio = 0, iva = 0, regalia = 0;
    for (const t of tickets) {
        bruto += n(t.total_crc);
        servicio += n(t.servicio_crc);
        iva += n(t.iva_crc);
        regalia += n(t.regalia_crc);
        const login = claveSalonero(t);
        const esMesero = login !== null;
        const clave = esMesero ? nombreSalonero(login, nombres, fechaCR(t.fecha_registra)) : claveNoMesero(t.registrado_por, t.cajero_login, t.canal);
        const e = acc.get(clave) ?? {
            esCajero: !esMesero,
            pax: 0,
            total: 0,
            com: 0,
            beb: 0,
            iCom: 0,
            iBeb: 0,
            iva: 0,
            serv: 0,
            delivery: 0,
            ordenes: 0,
            cts: {
                neta: 0,
                iva: 0,
                serv: 0,
                delivery: 0
            },
            prods: new Map()
        };
        e.pax += paxDelTicket(t);
        e.total += netoDe(t);
        e.serv += n(t.servicio_crc);
        e.iva += n(t.iva_crc);
        e.ordenes += 1;
        if (esDelivery(t))
            e.delivery += netoDe(t);
        e.cts.neta += aCts(netoDe(t));
        e.cts.iva += aCts(n(t.iva_crc));
        e.cts.serv += aCts(n(t.servicio_crc));
        if (esDelivery(t))
            e.cts.delivery += aCts(netoDe(t));
        for (const l of porTicket.get(t.id) ?? []) {
            if (!esFamiliaNeto(l.familia))
                continue;
            const nombre = (l.nombre ?? l.codigo_producto ?? "").trim().toUpperCase();
            if (nombre === "" || nombre === "PAX")
                continue;
            const cat = CATEGORIA_FAMILIA[l.familia] ?? "Otros";
            const esBebida = l.familia === 5;
            const monto = n(l.monto), qty = Math.round(n(l.cantidad));
            if (esBebida) {
                e.beb += monto;
                e.iBeb += qty;
            }
            else {
                e.com += monto;
                e.iCom += qty;
            }
            const p = e.prods.get(nombre) ?? {
                q: 0,
                m: 0
            };
            p.q += qty;
            p.m += monto;
            e.prods.set(nombre, p);
            if (!pm[nombre])
                pm[nombre] = {
                    tipo: esBebida ? "bebida" : "comida",
                    clasificacion: cat,
                    subclasificacion: "",
                    multiplicador: 1,
                    costo_unitario: 0,
                    tipoDeFamilia: true
                };
        }
        acc.set(clave, e);
    }
    const saloneros = {};
    for (const [nombre, e] of acc) {
        const prods = [...e.prods.entries()].sort((a, b) => b[1].m - a[1].m).map(([nom, v]) => [
            nom,
            v.q,
            Math.round(v.m)
        ]);
        const total = Math.round(e.total);
        if (e.esCajero) {
            const delivery = Math.round(e.delivery);
            saloneros[nombre] = {
                esCajero: true,
                pax: e.pax,
                total,
                salon: total - delivery,
                delivery,
                iva: Math.round(e.iva),
                serv: Math.round(e.serv),
                ordenes: e.ordenes,
                ticketProm: e.ordenes ? total / e.ordenes : 0,
                prods,
                crudoCts: e.cts
            };
            continue;
        }
        const deliveryMesero = Math.round(e.delivery);
        saloneros[nombre] = {
            pax: e.pax,
            total,
            com: Math.round(e.com),
            beb: Math.round(e.beb),
            iCom: e.iCom,
            iBeb: e.iBeb,
            ...deliveryMesero !== 0 ? { delivery: deliveryMesero } : {},
            iva: Math.round(e.iva),
            serv: Math.round(e.serv),
            promPax: e.pax ? e.total / e.pax : 0,
            promPlato: e.iCom ? e.com / e.iCom : 0,
            promBebida: e.iBeb ? e.beb / e.iBeb : 0,
            ratioCB: e.beb ? e.com / e.beb : 0,
            ratioU: e.iBeb ? e.iCom / e.iBeb : 0,
            bebPax: e.pax ? e.iBeb / e.pax : 0,
            prods,
            crudoCts: e.cts
        };
    }
    return {
        dia: {
            fileName: `ndf ${fecha}`,
            uploadedAt,
            saloneros
        },
        ordenes: Object.fromEntries([...acc.entries()].map(([k, v]) => [k, v.ordenes])),
        pm,
        bruto: Math.round(bruto),
        servicio: Math.round(servicio),
        iva: Math.round(iva),
        regalia: Math.round(regalia),
        tickets: tickets.length,
        canales: ventasPorCanal(tickets, netoDe),
        avisosCatalogo
    };
}
const aCts = (crc) => Math.round(crc * 100);
function nombreSalonero(login, nombres, fecha) {
    return nombreDeCodigo(login, nombres, fecha) ?? `${login} · sin asignar`;
}
function sumarPartesRedondeando(partes) {
    const c = {
        neta: 0,
        iva: 0,
        serv: 0,
        delivery: 0
    };
    let ajusteSalon = 0, ajusteBruta = 0;
    const lista = [...partes];
    if (!lista.some((p) => p.cts)) {
        const t = {
            ventaNeta: 0,
            iva: 0,
            serv: 0,
            delivery: 0,
            salon: 0,
            ventaBruta: 0
        };
        for (const p of lista) {
            t.ventaNeta += p.neta;
            t.iva += p.iva;
            t.serv += p.serv;
            t.delivery += p.delivery;
            t.salon += p.salon;
            t.ventaBruta += p.bruta;
        }
        return {
            ...t,
            crudoCts: c
        };
    }
    for (const p of lista) {
        c.neta += p.cts ? p.cts.neta : Math.round(p.neta * 100);
        c.iva += p.cts ? p.cts.iva : Math.round(p.iva * 100);
        c.serv += p.cts ? p.cts.serv : Math.round(p.serv * 100);
        c.delivery += p.cts ? p.cts.delivery : Math.round(p.delivery * 100);
        if (!p.cts) {
            ajusteSalon += p.salon - (p.neta - p.delivery);
            ajusteBruta += p.bruta - (p.neta + p.iva + p.serv);
        }
    }
    const ventaNeta = Math.round(c.neta / 100);
    const iva = Math.round(c.iva / 100);
    const serv = Math.round(c.serv / 100);
    const delivery = Math.round(c.delivery / 100);
    return {
        ventaNeta,
        iva,
        serv,
        delivery,
        salon: ventaNeta - delivery + ajusteSalon,
        ventaBruta: ventaNeta + iva + serv + ajusteBruta,
        crudoCts: c
    };
}
function getDayStats(dia) {
    let pax = 0;
    const saloneroNames = [];
    const partes = [];
    for (const [name, s] of Object.entries(dia.saloneros))
        if (s.esCajero) {
            const c = s;
            partes.push({
                neta: c.total,
                iva: c.iva ?? 0,
                serv: c.serv ?? 0,
                delivery: c.delivery,
                salon: c.salon,
                bruta: c.total + (c.iva ?? 0) + (c.serv ?? 0),
                cts: c.crudoCts
            });
            pax += c.pax ?? 0;
        }
        else {
            const sl = s;
            const dl = sl.delivery ?? 0;
            partes.push({
                neta: sl.total,
                iva: sl.iva ?? 0,
                serv: sl.serv ?? 0,
                delivery: dl,
                salon: sl.total - dl,
                bruta: sl.total + (sl.iva ?? 0) + (sl.serv ?? 0),
                cts: sl.crudoCts
            });
            pax += sl.pax ?? 0;
            saloneroNames.push(name);
        }
    const t = sumarPartesRedondeando(partes);
    return {
        fecha: "",
        ventaBruta: t.ventaBruta,
        ventaNeta: t.ventaNeta,
        iva: t.iva,
        serv: t.serv,
        salon: t.salon,
        delivery: t.delivery,
        pax,
        promPax: ventaPorPersonaDeTotales(t.salon, pax) ?? 0,
        saloneroNames
    };
}
function aggGeneral(dates, dias, pm) {
    let total = 0, salonMeseros = 0, cajTotal = 0, cajDelivery = 0, cajSalon = 0;
    let pax = 0, paxSaloneros = 0, iCom = 0, iBeb = 0;
    let cortTotal = 0, persTotal = 0;
    const prods = {};
    for (const date of dates) {
        const dia = dias[date];
        if (!dia)
            continue;
        for (const [, s] of Object.entries(dia.saloneros))
            if (s.esCajero) {
                const c = s;
                cajTotal += c.total;
                cajDelivery += c.delivery;
                cajSalon += c.salon;
                pax += c.pax ?? 0;
            }
            else {
                const sl = s;
                total += sl.total;
                salonMeseros += netaSalonDeSalonero(sl);
                pax += sl.pax ?? 0;
                paxSaloneros += sl.pax ?? 0;
                iCom += sl.iCom ?? 0;
                iBeb += sl.iBeb ?? 0;
                for (const [pname, qty, monto] of sl.prods ?? []) {
                    if (!prods[pname])
                        prods[pname] = {
                            q: 0,
                            m: 0
                        };
                    prods[pname].q += qty;
                    prods[pname].m += monto;
                    const info = pm[pname];
                    if (info?.tipo === "cortesia")
                        cortTotal += monto;
                    if (info?.tipo === "personal")
                        persTotal += monto;
                }
            }
    }
    const totalRest = total + cajTotal;
    const beb = Object.entries(prods).reduce((a, [n, v]) => a + (pm[n]?.tipo === "bebida" ? v.m : 0), 0);
    const com = Object.entries(prods).reduce((a, [n, v]) => a + (pm[n]?.tipo === "comida" ? v.m : 0), 0);
    return {
        total,
        cajTotal,
        cajDelivery,
        cajSalon,
        totalRest,
        salon: salonMeseros + cajSalon,
        pax,
        paxSaloneros,
        promPax: ventaPorPersonaDeTotales(salonMeseros + cajSalon, pax) ?? 0,
        iCom,
        iBeb,
        ratioCB: beb > 0 ? com / beb : 0,
        ratioU: iBeb > 0 ? iCom / iBeb : 0,
        bebPax: paxSaloneros > 0 ? iBeb / paxSaloneros : 0,
        promTicket: iCom + iBeb > 0 ? total / (iCom + iBeb) : 0,
        cortTotal,
        persTotal,
        prods
    };
}
const COLS_TICKETS_067 = [
    "id",
    "numero_factura",
    "estado",
    "fecha_registra",
    "fecha_cierra",
    "cajero_login",
    "canal",
    "mesa",
    "salonero_login",
    "registrado_por",
    "servicio_crc",
    "total_crc",
    "valor_servido_crc",
    "iva_crc",
    "regalia_crc",
    "pax",
    "pax_articulo"
];
const COLS_LINEAS_067 = [
    "ticket_id",
    "codigo_producto",
    "nombre",
    "cantidad",
    "monto",
    "familia",
    "usuario_registra"
];
const MIN_MESAS = 3;
const MIN_PERSONAS = 6;
const enDia = (dia) => ({
    desde: dia,
    hasta: dia
});
function resumenVentasDia(tickets, lineas, dia, nombres = {}) {
    const facturasTodas = facturasDesdePos(tickets, lineas);
    const ubic = ubicarFacturas(facturasTodas);
    const ids = new Set(facturasTodas.filter((f) => ubic.get(f)?.dia === dia).map((f) => f.id));
    const delDia = tickets.filter((t) => ids.has(t.id));
    const lineasDelDia = lineas.filter((l) => ids.has(l.ticket_id));
    const facturas = facturasTodas.filter((f) => ids.has(f.id));
    const armado = armarDia(dia, [...delDia], [...lineasDelDia], dia, nombres);
    const st = getDayStats(armado.dia);
    const gen = aggGeneral([dia], { [dia]: armado.dia }, armado.pm);
    const r = enDia(dia);
    const vpp = ventaPorPersona(facturas, r);
    const meseros = new Set(delDia.map((t) => claveSalonero(t)).filter((l) => !!l));
    const porSal = ventaPorPersonaPorSalonero(facturas, r).porSalonero.filter((s) => meseros.has(s.salonero_login)).map((s) => ({
        login: s.salonero_login,
        nombre: nombres[s.salonero_login] ?? null,
        netaSalon: s.netaSalon,
        promPax: s.valor,
        mesas: s.facturasSalon - s.mesasDuenos - s.regaliasTotales,
        personas: s.personasCargadas + s.personasEstimadas
    }));
    const porLogin = (a, b) => a.login.localeCompare(b.login);
    const masVendio = [...porSal].filter((s) => s.netaSalon > 0).sort((a, b) => b.netaSalon - a.netaSalon || porLogin(a, b))[0] ?? null;
    const mejorPromPax = [...porSal].filter((s) => s.promPax !== null && s.mesas >= 3 && s.personas >= 6).sort((a, b) => b.promPax - a.promPax || b.personas - a.personas || porLogin(a, b))[0] ?? null;
    return {
        dia,
        facturas: delDia.filter((t) => t.estado === "C").length,
        ventaBruta: st.ventaBruta,
        ventaNeta: st.ventaNeta,
        salon: st.salon,
        delivery: st.delivery,
        pax: st.pax,
        promPax: vpp.valor,
        pctEstimado: vpp.pctEstimado,
        mesasDuenos: vpp.mesasDuenos,
        regaliasTotales: vpp.regaliasTotales,
        bebPax: gen.paxSaloneros > 0 ? gen.bebPax : null,
        masVendio,
        mejorPromPax
    };
}
export { COLS_LINEAS_067, COLS_TICKETS_067, MIN_MESAS, MIN_PERSONAS, resumenVentasDia, sumarDias, ventanaRangoJornadas };
