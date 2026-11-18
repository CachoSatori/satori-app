// GENERADO — no editar a mano. Fuente: src/modules/ventas/ventasDiaContadorPuro.ts @ ce4974e6
// Regenerar: node scripts/edge/empaquetar-ventas-pos.mjs --entrada src/modules/ventas/ventasDiaContadorPuro.ts <salida>  ·  sha256(cuerpo) b68c506eedb957b6e0322ed79a54dd8001692f9921ef1f41247f22c724b5dabd
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
Object.freeze({
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
function fechaCR(iso) {
    if (!iso)
        return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t))
        return null;
    return new Date(t + -6 * MS_HORA).toISOString().slice(0, 10);
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
function resumirAvisos(avisos) {
    const acc = new Map();
    for (const a of avisos) {
        const e = acc.get(a.tipo) ?? {
            n: 0,
            monto: 0,
            ejemplos: new Set()
        };
        e.n += 1;
        e.monto += a.monto;
        if (e.ejemplos.size < 3)
            e.ejemplos.add(a.nombre ?? a.codigo ?? `factura ${a.numero_factura}`);
        acc.set(a.tipo, e);
    }
    return [...acc.entries()].map(([tipo, e]) => `${tipo}: ${e.n} (₡${Math.round(e.monto)}; ej. ${[...e.ejemplos].join(", ")})`).join(" · ");
}
const n$1 = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
function ventaPorPersonaDeTotales(netaSalon, personas) {
    const p = n$1(personas);
    return p > 0 ? n$1(netaSalon) / p : null;
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
function dayOfWeek(date) {
    return (new Date(date + "T12:00:00")).getDay();
}
const DOW_LABELS = [
    "Dom",
    "Lun",
    "Mar",
    "Mié",
    "Jue",
    "Vie",
    "Sáb"
];
function dowLabel(d) {
    return DOW_LABELS[d];
}
const TIPOS_PRODUCTO = [
    "comida",
    "bebida",
    "cortesia",
    "personal",
    "nofood",
    "comensales",
    "merchandising",
    "desconocido"
];
function esTipoCurado(tipo) {
    const t = (tipo ?? "").trim().toLowerCase();
    return t !== "" && t !== "desconocido" && TIPOS_PRODUCTO.includes(t);
}
function fusionarProductMap(curado, familia) {
    const out = { ...curado };
    for (const [nombre, fam] of Object.entries(familia)) {
        const cur = curado[nombre];
        if (!cur) {
            out[nombre] = fam;
            continue;
        }
        const respetar = esTipoCurado(cur.tipo);
        out[nombre] = {
            tipo: respetar ? cur.tipo : fam.tipo,
            clasificacion: respetar ? cur.clasificacion : fam.clasificacion,
            tipoDeFamilia: !respetar,
            subclasificacion: cur.subclasificacion || fam.subclasificacion,
            multiplicador: cur.multiplicador || fam.multiplicador,
            costo_unitario: cur.costo_unitario || fam.costo_unitario
        };
    }
    return out;
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
function getContabilidadDays(year, month, dias, hist) {
    const result = [];
    const allD = [...new Set([...Object.keys(dias), ...Object.keys(hist)])].sort();
    for (const date of allD) {
        const [y, m] = date.split("-").map(Number);
        if (y !== year)
            continue;
        if (month !== null && m !== month)
            continue;
        if (dias[date]) {
            const stats = getDayStats(dias[date]);
            result.push({
                ...stats,
                fecha: date
            });
        }
        else if (hist[date]) {
            const h = hist[date];
            result.push({
                fecha: date,
                ventaBruta: h.ventaBruta,
                ventaNeta: h.ventaNeta,
                iva: h.iva,
                serv: h.serv,
                salon: h.salon,
                delivery: h.delivery,
                pax: h.pax,
                promPax: h.promPax
            });
        }
    }
    return result;
}
function totalesContabilidad(days) {
    const t = {
        ventaBruta: 0,
        iva: 0,
        serv: 0,
        ventaNeta: 0,
        salon: 0,
        delivery: 0,
        pax: 0,
        promPax: 0
    };
    for (const d of days) {
        t.ventaBruta += d.ventaBruta;
        t.iva += d.iva;
        t.serv += d.serv;
        t.ventaNeta += d.ventaNeta;
        t.salon += d.salon;
        t.delivery += d.delivery;
        t.pax += d.pax;
    }
    t.promPax = ventaPorPersonaDeTotales(t.salon, t.pax) ?? 0;
    return t;
}
function dentro(fecha, r) {
    return fecha !== null && fecha >= r.desde && fecha <= r.hasta;
}
function diaDeFactura(t) {
    return fechaCR(t.fecha_registra);
}
function armarDiasMap(tickets, lineas, rango, opciones) {
    const porJornada = new Map();
    for (const t of tickets) {
        const dia = diaDeFactura(t);
        if (!dentro(dia, rango))
            continue;
        const lista = porJornada.get(dia);
        if (lista)
            lista.push(t);
        else
            porJornada.set(dia, [t]);
    }
    const lineasPorTicket = new Map();
    for (const l of lineas) {
        const lista = lineasPorTicket.get(l.ticket_id);
        if (lista)
            lista.push(l);
        else
            lineasPorTicket.set(l.ticket_id, [l]);
    }
    const dias = {};
    const pm = {};
    const avisos = [];
    for (const [jornada, delDia] of [...porJornada.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const armado = armarDia(jornada, delDia, delDia.flatMap((t) => lineasPorTicket.get(t.id) ?? []), opciones.uploadedAt, opciones.nombres ?? {});
        dias[jornada] = armado.dia;
        avisos.push(...armado.avisosCatalogo);
        for (const [nombre, info] of Object.entries(armado.pm))
            if (!pm[nombre])
                pm[nombre] = info;
    }
    if (avisos.length > 0)
        (opciones.avisar ?? console.warn)(`[ventas] neta ${rango.desde}→${rango.hasta}: líneas con plata fuera del catálogo — ${resumirAvisos(avisos)}`);
    return {
        dias,
        pm
    };
}
const SOURCE_HIST = "hist";
function aHistDay(dia) {
    const s = getDayStats(dia);
    return {
        ventaBruta: s.ventaBruta,
        ventaNeta: s.ventaNeta,
        iva: s.iva,
        serv: s.serv,
        salon: s.salon,
        delivery: s.delivery,
        pax: s.pax,
        promPax: s.promPax,
        source: SOURCE_HIST
    };
}
function aHistMap(dias) {
    const hist = {};
    for (const [jornada, dia] of Object.entries(dias))
        hist[jornada] = aHistDay(dia);
    return hist;
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
export { COLS_LINEAS_067, COLS_TICKETS_067, aHistMap, armarDiasMap, dayOfWeek, dowLabel, fusionarProductMap, getContabilidadDays, getDayStats, totalesContabilidad, ventanaRangoJornadas };
