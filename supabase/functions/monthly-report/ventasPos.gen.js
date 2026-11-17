// GENERADO — no editar a mano. Fuente: src/modules/ventas/ventasPosPuro.ts @ 0515017
// Regenerar: node scripts/edge/empaquetar-ventas-pos.mjs <salida>  ·  sha256(cuerpo) 9b74828d8a55a1b34cb69e016d6cf6b9179d5bbbf4d9285ec71b9551ebd56686
// deno-lint-ignore-file
// @ts-nocheck
//#region src/shared/api/posNdf.ts
/** Offset de Costa Rica. Fijo, sin horario de verano. */
const CR_OFFSET = "-06:00";
/**
* El rango de jornadas `[desde, hasta]` → la ventana de `fecha_registra` que hay que LEER.
*
* Es un SUPERSET a propósito, y por los dos lados:
*
* · +1 día al final — un lote de noche puede cerrar pasada la medianoche, así que la jornada
*   `hasta` todavía tiene facturas al día siguiente. Sin este margen se perderían.
*
* · −1 día al principio — el que NO es obvio. La jornada de un lote es la fecha del PRIMER
*   ticket del lote. Si el rango arranca justo después de que un turno cruzó la medianoche, y
*   solo se leyera desde `desde`, se vería el pedazo de madrugada SIN su apertura: ese lote
*   truncado calcularía su jornada como `desde` y se colaría en el día equivocado. Con el día
*   de atrás, el lote entra completo, su jornada da el día anterior y el filtro lo descarta.
*
* Un margen de un día alcanza: un turno cierra a las horas, no a los días. Lo que sobra del
* superset se descarta después por jornada, así que la ventana ancha no ensucia el resultado.
*/
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
/**
* Instante con zona → el DÍA en Costa Rica (`YYYY-MM-DD`).
*
* Equivale a `(x at time zone 'America/Costa_Rica')::date`. `null` si no es un instante.
*/
function fechaCR(iso) {
	if (!iso) return null;
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return null;
	return new Date(t + -6 * MS_HORA).toISOString().slice(0, 10);
}
//#endregion
//#region src/shared/ndf/mapTicket.ts
/**
* Logins de sistema: fuera del breakdown de mesero, NUNCA fuera del total.
*   · 002 = cocina express · 02 = login compartido / bajas
*
* El `01` NO es sistema: es ROSAURA (salonera), unificada con su login de manager `235` en
* `personasNdf.ts`. Firmado por el dueño el 2026-10-29. Ojo: esto decide `registrado_por` al
* INGESTAR; los tickets del `01` ya guardados como `sistema` no cambian solos (hace falta
* re-ingestarlos con el backfill).
*/
const LOGINS_SISTEMA = ["002", "02"];
/**
* Roster activo de `FAC_Empleados`, login → nombre. **Solo para MOSTRAR**: no decide quién es
* salonero (eso lo hace `mapSalonero` por descarte de 111/222 y los logins de sistema), no
* entra en ningún cálculo de plata y no cambia una sola columna guardada.
*
* Es la SEGUNDA capa de resolución de nombre, no la primera: manda `employees.pos_login` de la
* app, que es el que el negocio mantiene. Esto es el respaldo para que un login que todavía no
* se cargó en Empleados salga con su nombre en vez de con un número — y si tampoco está acá,
* sale marcado «sin asignar», nunca inventado.
*
* Un login que se va del roster NO se borra de acá: los días viejos lo siguen necesitando para
* poder leerse.
*/
const SALONEROS_CONOCIDOS = {
	"023": "Esteban",
	"024": "Juancho",
	"025": "Dolores",
	"026": "MAXO",
	"027": "GUILLE",
	"028": "FRANCISCO",
	"029": "Ignacio",
	"030": "Jota",
	"032": "GONZA",
	"033": "FEDERICO",
	"034": "INE",
	"035": "RODRIGO BAR",
	"235": "ROSAURA M",
	"266": "NACHO",
	"444": "MAXI",
	"01": "ROSAURA M",
	"036": "FRANCO",
	"037": "VALENTINO",
	"038": "NACHO",
	"039": "AMPI"
};
/**
* Las familias que suman al **VALOR SERVIDO** (el neto fiscal): comida 2, 3, 4, 13,
* 16, 29 + bebida 5.
*
* ⚠️ Es un conjunto DISTINTO del `FAMILIAS_COMIDA` del mix, a propósito y por dos
* diferencias que están firmadas:
*   · **29 (GreenSeason) ENTRA** acá y hoy no existe en el mix (cae en "otro").
*   · **6 ENTRA al mix como comida pero NO al neto**: es el cajón mixto donde también
*     se carga la comida del personal ("XX" a ₡0).
* Quedan afuera del neto, además: pax 19 · ingredientes 20 · extras 22 · gift 12 ·
* merch 21/23/24/26/27 · cortesías 17 · dueños 28 · cajón/personal 1, 6, 9, 11, 15, 25.
*/
const FAMILIAS_VALOR_SERVIDO = [
	2,
	3,
	4,
	5,
	13,
	16,
	29
];
/** Texto limpio o `null`. Nunca `undefined`, nunca `''`. */
function texto(v) {
	if (v === null || v === void 0) return null;
	const s = String(v).trim();
	return s === "" ? null : s;
}
/** Login de sistema (`002` cocina express, `01`/`02` bajas). */
function esLoginSistema(login) {
	const l = texto(login);
	return l !== null && LOGINS_SISTEMA.includes(l);
}
//#endregion
//#region src/shared/ndf/personasNdf.ts
/** El código que se usa como id cuando la línea no trae ninguno. */
const SIN_CODIGO = "(sin codigo)";
/** `código → persona`. Se arma una sola vez; incluye TODOS los alias, no solo el canónico. */
const POR_CODIGO = new Map([
	{
		id: "0909",
		rol: "mesero",
		etiqueta: "Rocío",
		codigos: ["0909"],
		vigencias: { "0909": {
			desde: "2025-01-07",
			hasta: "2026-05-09"
		} }
	},
	{
		id: "333",
		rol: "mesero",
		etiqueta: "Emma",
		codigos: ["333"],
		vigencias: { "333": {
			desde: "2025-01-01",
			hasta: "2025-10-22"
		} }
	},
	{
		id: "999",
		rol: "mesero",
		etiqueta: "Jazmín",
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
		etiqueta: "Maxi",
		codigos: ["444"]
	},
	{
		id: "026",
		rol: "mesero",
		etiqueta: "Maxo",
		codigos: ["026"]
	},
	{
		id: "028",
		rol: "mesero",
		etiqueta: "Francisco",
		codigos: ["028"]
	},
	{
		id: "03",
		rol: "mesero",
		etiqueta: "Alan",
		codigos: ["03"],
		vigencias: { "03": {
			desde: "2025-01-01",
			hasta: "2026-01-18"
		} }
	},
	{
		id: "027",
		rol: "mesero",
		etiqueta: "Guille",
		codigos: ["027"]
	},
	{
		id: "025",
		rol: "mesero",
		etiqueta: "Dolores",
		codigos: ["025"]
	},
	{
		id: "032",
		rol: "mesero",
		etiqueta: "Gonza",
		codigos: ["032"]
	},
	{
		id: "029",
		rol: "mesero",
		etiqueta: "Ignacio",
		codigos: ["029"]
	},
	{
		id: "034",
		rol: "mesero",
		etiqueta: "Ine",
		codigos: ["034"]
	},
	{
		id: "024",
		rol: "mesero",
		etiqueta: "Juancho",
		codigos: ["024"]
	},
	{
		id: "04",
		rol: "mesero",
		etiqueta: "Wesley",
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
		etiqueta: "Jota",
		codigos: ["030"]
	},
	{
		id: "033",
		rol: "mesero",
		etiqueta: "Federico",
		codigos: ["033"]
	},
	{
		id: "035",
		rol: "mesero",
		etiqueta: "Rodri",
		codigos: ["035"]
	},
	{
		id: "036",
		rol: "mesero",
		etiqueta: "Franco",
		codigos: ["036"]
	},
	{
		id: "037",
		rol: "mesero",
		etiqueta: "Valentino",
		codigos: ["037"]
	},
	{
		id: "039",
		rol: "mesero",
		etiqueta: "Ampi",
		codigos: ["039"]
	},
	{
		id: "01",
		rol: "mesero",
		etiqueta: "Rosaura",
		codigos: ["01", "235"]
	},
	{
		id: "023",
		rol: "mesero",
		etiqueta: "Esteban",
		codigos: ["023", "555"]
	},
	{
		id: "038",
		rol: "mesero",
		etiqueta: "Nacho",
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
/** El balde de los códigos sin dueño conocido. Uno por código, para no perder de vista cuál era. */
const desconocidas = /* @__PURE__ */ new Map();
/** Los códigos de la tabla usados fuera de su vigencia. Uno por código, como `desconocidas`. */
const sinNombre = /* @__PURE__ */ new Map();
/** ¿El código vale para esta persona ese día? Sin fecha o sin vigencia, vale (lo de siempre). */
function vigente(persona, codigo, fecha) {
	const v = persona.vigencias?.[codigo];
	if (!v || !fecha) return true;
	return (v.desde === void 0 || fecha >= v.desde) && (v.hasta === void 0 || fecha <= v.hasta);
}
/**
* El mismo código, pero sin persona: «login XXXX». Conserva el ROL de la tabla (un `0909` fuera
* de fecha sigue siendo un mesero: va al ranking en su propia fila, sin nombre). `codigos` es el
* código mismo —sirve de desempate estable, ver `duenoDeMesa`— y `nombreDePersona` no lo busca
* en ninguna capa: devuelve la etiqueta.
*/
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
/**
* `usuario_registra` de una línea → su persona.
*
* `fecha` es el día CR de la factura (`fechaCR(fecha_registra)`). Si el código tiene vigencia y
* la fecha cae afuera, devuelve «login XXXX» (`fueraDeVigencia`). Sin `fecha` no se mira la
* vigencia: es para lo que no tiene un día detrás (el vínculo empleado → ventas).
*
* NUNCA devuelve `null`: la plata de una línea siempre tiene que caer en algún balde (regla 4
* de la firma). Los tres casos que no están en la tabla:
*
* · Sin código (`null` / vacío) → la persona `(sin codigo)`, rol `otro`. Son 10 líneas en todo
*   el histórico (₡40k).
* · Código que la tabla no conoce → rol `otro`, conservando el código como id y como etiqueta.
*   NO se adivina que es un mesero: si mañana entra alguien nuevo, su plata aparece en el balde
*   "otro" con su código a la vista, y eso es justamente la señal de que hay que agregarlo a la
*   tabla de arriba. Adivinar sería repetir el error de `01`.
* · Espacios alrededor → se recortan antes de buscar.
*/
function clasificarCodigo(codigo, fecha) {
	const c = (codigo ?? "").trim();
	if (c === "") return PERSONA_SIN_CODIGO;
	const conocida = POR_CODIGO.get(c);
	if (conocida) return vigente(conocida, c, fecha) ? conocida : loginSinNombre(conocida, c);
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
/**
* El nombre a mostrar de una persona. Es LA regla de nombre de todas las vistas de ventas:
* el ranking por factura (`nombreSalonero`) y las lentes por línea la usan igual, así que una
* persona con dos códigos sale con el MISMO nombre en una sola fila en todas partes.
*
* Tres capas, y en cada una se busca por TODOS los códigos de la persona, el canónico primero:
*   1. `employees` (`pos_login → full_name`): el nombre que el dueño mantiene. Así ROSAURA sale
*      con su nombre aunque el `pos_login` cargado sea el de su login de manager.
*   2. `SALONEROS_CONOCIDOS`, el roster que viaja con el código, para el entorno que todavía
*      no tiene `pos_login` cargado.
*   3. La etiqueta curada. Nunca se muestra un número solo.
*/
function nombreDePersona(persona, nombres) {
	if (persona.fueraDeVigencia) return persona.etiqueta;
	for (const c of persona.codigos) {
		const n = nombres[c]?.trim();
		if (n) return n;
	}
	for (const c of persona.codigos) {
		const n = SALONEROS_CONOCIDOS[c]?.trim();
		if (n) return n;
	}
	return persona.etiqueta;
}
/**
* El nombre con el que un login del PoS aparece en el ranking, o `null` si no hay ninguno.
*
* Persona conocida → `nombreDePersona` (sus alias dan el mismo nombre). Si no: `employees` y
* después el roster. Es la regla que usa `nombreSalonero` (que además marca «sin asignar").
* Con `fecha` (día CR de la factura) y el código fuera de su vigencia → «login XXXX».
*/
function nombreDeCodigo(codigo, nombres, fecha) {
	const c = (codigo ?? "").trim();
	if (c === "") return null;
	const persona = clasificarCodigo(c, fecha);
	if (persona.rol === "mesero") return nombreDePersona(persona, nombres);
	return nombres[c]?.trim() || SALONEROS_CONOCIDOS[c]?.trim() || null;
}
//#endregion
//#region src/modules/ventas/baldesNoMesero.ts
/**
* El `turno` que guarda el PoS → cómo se dice en pantalla.
*
* El valor guardado del turno de la noche es `'noche'` y **no se toca**: está en la columna
* `turno` de `pos_ndf_tickets`, lo escribe el mapper y lo defiende un CHECK. Pero el negocio a
* ese turno le dice «tarde» (el cajero 222 arranca a las 16:00, no de noche), así que la
* TRADUCCIÓN vive acá, en el borde de la pantalla, y en ningún lado más.
*/
const ETIQUETA_TURNO_POS = {
	"mañana": "Mañana",
	"manana": "Mañana",
	"noche": "Tarde",
	"tarde": "Tarde"
};
const CLAVE_CAJERO_MANANA = `Cajero turno ${ETIQUETA_TURNO_POS["mañana"].toLowerCase()}`;
const CLAVE_CAJERO_TARDE = `Cajero turno ${ETIQUETA_TURNO_POS["noche"].toLowerCase()}`;
/**
* Venta de SALÓN que la factura no le acredita a ningún mesero.
*
* Se llama «Salón sin mesero» y NO «Sin asignar» a propósito: el roster ya usa
* `«099 · sin asignar»` (`nombreSalonero`) para un MESERO real al que no se le pudo poner
* nombre. Son cosas distintas —una factura sin dueño contra una persona sin nombre— y con el
* rótulo viejo se leían igual.
*/
const CLAVE_SALON_SIN_MESERO = "Salón sin mesero";
/**
* Venta de SALÓN timbrada por la caja, sin mesero en la factura. Tarjeta propia en Cajeros,
* fuera del Total Cajeros (que es delivery/llevar) y fuera del ranking (no es una persona).
*/
const CLAVE_CAJERO_SALON = "Cajero-salón";
const CLAVE_SISTEMA_OTROS = "Sistema y otros";
/**
* El balde de una factura que no es de un mesero. Ver el bloque de arriba.
*
* `canal` llega crudo de `pos_ndf_tickets.canal`; lo único que se pregunta es si es `'salon'`,
* así que barra / llevar / otro caen del lado de los cajeros sin necesidad de enumerarlos.
*/
function claveNoMesero(registradoPor, cajeroLogin = null, canal = null) {
	const esSalon = canal === "salon";
	if (registradoPor === "cajero") {
		if (esSalon) return CLAVE_CAJERO_SALON;
		return cajeroLogin === "222" ? CLAVE_CAJERO_TARDE : CLAVE_CAJERO_MANANA;
	}
	if (registradoPor === "sin_pedido" && esSalon) return CLAVE_SALON_SIN_MESERO;
	return CLAVE_SISTEMA_OTROS;
}
//#endregion
//#region src/modules/ventas/netaVenta.ts
/** Las ÚNICAS familias cuya plata no es venta: 6 PERSONAL · 17 X CORTESIAS · 20 Ingredientes. */
const FAMILIAS_NO_VENTA = [
	6,
	17,
	20
];
/**
* Las familias que el catálogo del PoS (`FAC_Clasificaciones`) tiene identificadas hoy. Solo
* sirve para AVISAR: una línea con plata fuera de esta lista cuenta igual en la neta.
*/
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
const n$1 = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
/** ¿La plata de esta línea es venta? `null` (sin familia) también: se cuenta y se avisa. */
function esLineaDeVenta(familia) {
	return familia === null || familia === void 0 || !FAMILIAS_NO_VENTA.includes(familia);
}
/**
* La neta de UN ticket: Σ `monto` de sus líneas de venta.
*
* Un ticket sin ninguna línea guardada cae a `valor_servido_crc` (que el agente calcula de las
* MISMAS líneas, así que en ese caso también sería 0 o el dato del puente) y se avisa: es un
* hueco de ingesta, no un ticket sin venta.
*/
function netaDelTicket(t, lineas, avisos) {
	if (!lineas || lineas.length === 0) {
		const vs = n$1(t.valor_servido_crc);
		if (avisos && vs !== 0) avisos.push({
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
		if (!esLineaDeVenta(l.familia)) continue;
		const monto = n$1(l.monto);
		neta += monto;
		if (!avisos || monto === 0) continue;
		const tipo = l.familia === null || l.familia === void 0 ? "sin_familia" : FAMILIAS_CATALOGO.includes(l.familia) ? null : "familia_desconocida";
		if (tipo) avisos.push({
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
/** Resumen de una línea para el log: cuántos avisos de cada tipo y cuánta plata tocan. */
function resumirAvisos(avisos) {
	const acc = /* @__PURE__ */ new Map();
	for (const a of avisos) {
		const e = acc.get(a.tipo) ?? {
			n: 0,
			monto: 0,
			ejemplos: /* @__PURE__ */ new Set()
		};
		e.n += 1;
		e.monto += a.monto;
		if (e.ejemplos.size < 3) e.ejemplos.add(a.nombre ?? a.codigo ?? `factura ${a.numero_factura}`);
		acc.set(a.tipo, e);
	}
	return [...acc.entries()].map(([tipo, e]) => `${tipo}: ${e.n} (₡${Math.round(e.monto)}; ej. ${[...e.ejemplos].join(", ")})`).join(" · ");
}
//#endregion
//#region src/modules/ventas/ventasEnVivoMock.ts
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
//#endregion
//#region src/modules/ventas/ventasEnVivoDatos.ts
/**
* Familias que suman al valor servido. **Importadas de la fuente de verdad**, no copiadas:
* `FAMILIAS_VALOR_SERVIDO` de `src/shared/ndf/mapTicket.ts` es el mismo conjunto que usa el
* mapper del puente para calcular `valor_servido_crc` en la ingesta.
*
* Acá solo sirve para FILTRAR el mix de producto. Que sea el MISMO array es lo que garantiza la
* invariante: la suma del mix es el VALOR SERVIDO del día (no la neta, que suma además merch,
* BOXING, gift cards… — ver `netaVenta.ts`).
*/
const FAMILIAS_NETO = FAMILIAS_VALOR_SERVIDO;
/**
* Familia del PoS → la etiqueta con la que se agrupa el mix.
*
* Se agrupa por el NÚMERO de familia, que es dato duro del PoS, y no por el `ProductMap` de
* la app: el ProductMap se carga a mano producto por producto y un producto sin cargar caería
* en «SIN CLASIFICAR» aunque el PoS sí sepa qué es. Esto es ETIQUETAR, no recalcular plata.
*
* ⚠️ INVARIANTE: las claves de este mapa son EXACTAMENTE `FAMILIAS_NETO`, las mismas que
* alimentan `valor_servido_crc`. Por eso **la suma del mix es el valor servido del día**.
* Agregar acá una familia que no esté en el valor servido rompería esa igualdad — hay un test
* que lo fija.
*/
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
/**
* Los comensales de un ticket, con la **fuente primaria del SPEC §3.F: el ARTÍCULO pax**.
*
* NO se usa la columna `pax` directamente. Esa la resuelve el mapper con la regla del puente
* (manda el nativo cuando está), y el SPEC dice lo contrario mientras el nativo no sea
* confiable: el campo nativo no es obligatorio y hoy viene sin cargar. Si no hay artículo, se
* cae al `pax` ya resuelto — así un ticket con solo nativo no queda en cero.
*
* El día que el nativo llegue al 100 % (§3.F) esto se invierte y el artículo se retira.
*/
function paxDelTicket(t) {
	const articulo = n(t.pax_articulo);
	return articulo > 0 ? articulo : n(t.pax);
}
/** Con quién se acredita el ticket. `null` = cajero, sistema o sin pedido: no es un mesero. */
function claveSalonero(t) {
	if (t.registrado_por !== "salonero") return null;
	if (esLoginSistema(t.salonero_login)) return null;
	return t.salonero_login ?? null;
}
/** ¿El ticket es delivery? El ÚNICO predicado del canal: lo usan `ventasPorCanal` y `armarDia`. */
function esDelivery(t) {
	return t.canal === "delivery";
}
/**
* Salón vs delivery, en NETO y **ticket por ticket**.
*
* En el modelo del xls el delivery solo se puede ver por el cajero que lo cobró; el PoS lo sabe
* factura por factura (`canal`), así que acá se parte por el dato duro y no por quién la cerró.
* Todo lo que no es delivery cuenta como salón: barra, para llevar y mesa son piso.
*
* `netoDe` es la neta de cada ticket (la de `armarDia`, desde las líneas). Sin él se cae al
* valor servido de la cabecera, que es lo que devolvía antes.
*/
function ventasPorCanal(tickets, netoDe = (t) => n(t.valor_servido_crc)) {
	let salon = 0, delivery = 0;
	for (const t of tickets) {
		const v = netoDe(t);
		if (esDelivery(t)) delivery += v;
		else salon += v;
	}
	return {
		salon: Math.round(salon),
		delivery: Math.round(delivery)
	};
}
/** ¿Este ticket entra en la venta oficial? */
function esTicketOficial(t) {
	return t.estado === "C";
}
function armarDia(fecha, entrada, lineas, uploadedAt, nombres = {}) {
	const tickets = entrada.filter(esTicketOficial);
	const porTicket = /* @__PURE__ */ new Map();
	for (const l of lineas) {
		const lista = porTicket.get(l.ticket_id);
		if (lista) lista.push(l);
		else porTicket.set(l.ticket_id, [l]);
	}
	const avisosCatalogo = [];
	const netaPorTicket = /* @__PURE__ */ new Map();
	for (const t of tickets) netaPorTicket.set(t.id, netaDelTicket(t, porTicket.get(t.id), avisosCatalogo));
	const netoDe = (t) => netaPorTicket.get(t.id) ?? 0;
	const acc = /* @__PURE__ */ new Map();
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
			prods: /* @__PURE__ */ new Map()
		};
		e.pax += paxDelTicket(t);
		e.total += netoDe(t);
		e.serv += n(t.servicio_crc);
		e.iva += n(t.iva_crc);
		e.ordenes += 1;
		if (esDelivery(t)) e.delivery += netoDe(t);
		for (const l of porTicket.get(t.id) ?? []) {
			if (!esFamiliaNeto(l.familia)) continue;
			const nombre = (l.nombre ?? l.codigo_producto ?? "").trim().toUpperCase();
			if (nombre === "" || nombre === "PAX") continue;
			const cat = CATEGORIA_FAMILIA[l.familia] ?? "Otros";
			const esBebida = l.familia === 5;
			const monto = n(l.monto), qty = Math.round(n(l.cantidad));
			if (esBebida) {
				e.beb += monto;
				e.iBeb += qty;
			} else {
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
			if (!pm[nombre]) pm[nombre] = {
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
				prods
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
			prods
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
/**
* El login del PoS → cómo se muestra. Es la CLAVE del ranking: todo lo que agrupa por salonero
* (ranking, comparativos, metas, ICP, Mi Rendimiento…) agrupa por este nombre.
*
* · Si el login es de una persona conocida (`personasNdf.ts`), sale el nombre de la PERSONA
*   (`nombreDePersona`), buscado por todos sus códigos. Así dos logins de la misma persona
*   (`266`/`038` NACHO, `01`/`235` ROSAURA, `023`/`555` ESTEBAN) caen en UNA sola fila, con el
*   mismo nombre que en las lentes por línea.
* · Si no, las tres capas de siempre:
*   1. `employees.pos_login` — el mapeo que mantiene el negocio en Empleados.
*   2. `SALONEROS_CONOCIDOS` — el roster que viaja con el código.
*   3. El número **marcado** `«026 · sin asignar»`. No se inventa un nombre y tampoco se lo
*      esconde: sigue en el ranking, con la marca puesta, que es lo que hace visible el mapeo
*      que falta.
*
* `fecha` = día CR de la factura. Un código de la tabla usado fuera de su vigencia (códigos
* reciclados, ver `Vigencia` en `personasNdf.ts`) sale «login XXXX»: sin nombre y sin la marca de
* «sin asignar», porque no falta un mapeo, falta saber quién era.
*/
function nombreSalonero(login, nombres, fecha) {
	return nombreDeCodigo(login, nombres, fecha) ?? `${login} · sin asignar`;
}
//#endregion
//#region src/modules/ventas/ventasUtils.ts
/**
* Los `tipo` que la app entiende. Es el vocabulario del selector de Config
* (`VentasConfig.tsx`), y el mismo que leen `VentasMix` (sus secciones), `aggGeneral`
* (`cortesia`/`personal`) y `topProds`.
*
* `desconocido` está en la lista porque es el valor que la pantalla ofrece, pero significa
* «todavía nadie lo clasificó» — por eso NO cuenta como curado en `esTipoCurado`.
*/
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
/**
* ¿Este `tipo` es una clasificación que alguien puso a mano y hay que respetar?
*
* Dice que NO para tres casos, que son justo los que la familia puede rellenar sin pisar a
* nadie: vacío, `desconocido`, y **cualquier valor fuera del vocabulario**. Ese tercer caso no
* es teórico: `scripts/import-carta.py:62` escribió en `tipo` la CATEGORÍA del CSV
* (`SUSHI ROLLS`, `BEBIDAS`, `X CORTESIAS`, `GREENSEASON`…), que ninguna pantalla sabe leer —
* esos productos hoy caen en «MERCHANDISING / OTROS» del Mix aunque estén cargados.
*/
function esTipoCurado(tipo) {
	const t = (tipo ?? "").trim().toLowerCase();
	return t !== "" && t !== "desconocido" && TIPOS_PRODUCTO.includes(t);
}
/**
* El `ProductMap` curado + el que deriva de la FAMILIA del PoS, fusionados CAMPO POR CAMPO.
*
* ── La regla (firmada, versión conservadora) ─────────────────────────────────────────────
*   · `tipo` y `clasificacion`: gana la familia **solo si el curado no tiene un tipo válido**.
*     Un `cortesia` / `personal` / `merchandising` puesto a mano NUNCA se pisa — que es lo que
*     garantiza que `aggGeneral.cortTotal`/`persTotal`, Menu Engineering y la Paridad no se
*     muevan ni un colón, y que los días del .xls queden idénticos.
*   · `multiplicador` y `costo_unitario`: gana SIEMPRE el curado. La familia no los sabe
*     (los deja en 1 y 0) y los usan Menu Engineering y el ICP.
*   · Producto solo en el curado (típico del .xls): queda tal cual.
*   · Producto solo en el PoS: entra con lo que dice su familia.
*
* La familia solo conoce productos de `FAMILIAS_NETO`, así que cortesías (17), personal (6),
* merch, gift, pax y extras no están en `familia` y no pueden ser pisados por esta vía.
*/
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
function getDayStats(dia) {
	let ventaNeta = 0, iva = 0, serv = 0, salon = 0, delivery = 0, pax = 0;
	const saloneroNames = [];
	for (const [name, s] of Object.entries(dia.saloneros)) if (s.esCajero) {
		const c = s;
		ventaNeta += c.total;
		iva += c.iva ?? 0;
		serv += c.serv ?? 0;
		delivery += c.delivery;
		salon += c.salon;
		pax += c.pax ?? 0;
	} else {
		const sl = s;
		const dl = sl.delivery ?? 0;
		ventaNeta += sl.total;
		iva += sl.iva ?? 0;
		serv += sl.serv ?? 0;
		salon += sl.total - dl;
		delivery += dl;
		pax += sl.pax ?? 0;
		saloneroNames.push(name);
	}
	return {
		fecha: "",
		ventaBruta: ventaNeta + iva + serv,
		ventaNeta,
		iva,
		serv,
		salon,
		delivery,
		pax,
		promPax: pax > 0 ? salon / pax : 0,
		saloneroNames
	};
}
//#endregion
//#region src/modules/ventas/ventasDiasDesdePos.ts
/** `'2026-09-04' <= f <= '2026-09-06'`. Comparación de strings: `YYYY-MM-DD` ordena solo. */
function dentro(fecha, r) {
	return fecha !== null && fecha >= r.desde && fecha <= r.hasta;
}
/**
* El día del reporte de un ticket: `(fecha_registra AT TIME ZONE 'America/Costa_Rica')::date`.
* `null` si el instante no se puede leer (ese ticket no entra a ningún día).
*/
function diaDeFactura(t) {
	return fechaCR(t.fecha_registra);
}
/**
* El corazón, PURO: tickets + líneas → `DiasMap`. Se prueba sin base de datos.
*
* Los tickets vienen del superset de `ventanaRangoJornadas` (un día antes, dos después), así
* que hay de más: los que caen fuera de `[desde, hasta]` por su día de factura se descartan acá.
*/
function armarDiasMap(tickets, lineas, rango, opciones) {
	const porJornada = /* @__PURE__ */ new Map();
	for (const t of tickets) {
		const dia = diaDeFactura(t);
		if (!dentro(dia, rango)) continue;
		const lista = porJornada.get(dia);
		if (lista) lista.push(t);
		else porJornada.set(dia, [t]);
	}
	const lineasPorTicket = /* @__PURE__ */ new Map();
	for (const l of lineas) {
		const lista = lineasPorTicket.get(l.ticket_id);
		if (lista) lista.push(l);
		else lineasPorTicket.set(l.ticket_id, [l]);
	}
	const dias = {};
	const pm = {};
	const avisos = [];
	for (const [jornada, delDia] of [...porJornada.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		const armado = armarDia(jornada, delDia, delDia.flatMap((t) => lineasPorTicket.get(t.id) ?? []), opciones.uploadedAt, opciones.nombres ?? {});
		dias[jornada] = armado.dia;
		avisos.push(...armado.avisosCatalogo);
		for (const [nombre, info] of Object.entries(armado.pm)) if (!pm[nombre]) pm[nombre] = info;
	}
	if (avisos.length > 0) (opciones.avisar ?? console.warn)(`[ventas] neta ${rango.desde}→${rango.hasta}: líneas con plata fuera del catálogo — ${resumirAvisos(avisos)}`);
	return {
		dias,
		pm
	};
}
/**
* `source` SIEMPRE `'hist'`.
*
* No es un valor elegido a ojo: en `HistDay` el campo es el literal `'hist'` (no una unión),
* y ningún consumidor lo ramifica —se buscó: nadie hace `if (d.source === …)` sobre un
* `HistDay`—. Inventar un `'pos'` rompería el tipo y no le serviría a nadie. Que el día venga
* del PoS o del xls se sabe por de dónde se pidió el `HistMap`, no por dentro de la fila.
*/
const SOURCE_HIST = "hist";
/** Un `DiaData` → su `HistDay`. Puro re-shape de `getDayStats`. */
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
/** Un `DiasMap` → su `HistMap`, jornada por jornada. PURO: se prueba sin base de datos. */
function aHistMap(dias) {
	const hist = {};
	for (const [jornada, dia] of Object.entries(dias)) hist[jornada] = aHistDay(dia);
	return hist;
}
//#endregion
//#region src/modules/ventas/ventasPosPuro.ts
/** Las columnas que devuelve `pos_ventas_tickets_rango` (mig 067), en orden. */
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
/** Las columnas que devuelve `pos_ventas_lineas` (mig 067), en orden. */
const COLS_LINEAS_067 = [
	"ticket_id",
	"codigo_producto",
	"nombre",
	"cantidad",
	"monto",
	"familia",
	"usuario_registra"
];
//#endregion
export { COLS_LINEAS_067, COLS_TICKETS_067, aHistMap, armarDiasMap, fusionarProductMap, getDayStats, ventanaRangoJornadas };
