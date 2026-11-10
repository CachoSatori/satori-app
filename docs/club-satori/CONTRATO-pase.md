# Contrato · pase de Wallet ↔ base del Club (v1, 07-nov-2026; revisado con «anfitrión y cliente»)

> Para la **sesión B** (pase de Wallet) y la **sesión A** (Local Club en la 075). Este documento es la frontera
> entre las dos: B arranca con el JSON de ejemplo de abajo, sin esperar a A. **Cualquier cambio de este contrato
> se acuerda acá primero** (y sube `contrato` a 2).
>
> Alcance: **solo staging** hasta la firma del pase a prod (RUNBOOK, paso 7). **Google arranca ya** (no depende del
> D-U-N-S); Apple con el código listo y **apagado** hasta el D-U-N-S.

## 1. Principios
- **Un pase por persona** = un `club_miembros.id`. La misma persona puede ser referente y socio: un solo pase.
- **B no lee tablas del Club.** Todo pasa por las funciones de este contrato: SECURITY DEFINER y ejecutables **solo
  por `service_role`** (el Edge de B). Ni `anon` ni `authenticated` las ven.
- **El pase no lleva datos de contacto** (ni teléfono, ni email) ni el token del portal (CLUB-AUD-69). El botón
  «Canjear» usa un **token de pase** propio, revocable y regenerable, que solo abre «Canjear».
- **Una persona, dos roles posibles:** **socio** (cliente del Local Club) y **anfitrión** (= referente: comparte
  cupones y gana créditos). Son las pestañas «Mi Club» y «Anfitrión» del pase y del portal; con un solo rol, una sola.
- **Código de barras del pase** (lo dice `codigo_barras`, B no lo deduce):
  - **si es socio** (pendiente o activo): el **QR fijo del socio** `/s/{codigo9}`. Solo identifica en caja (10 % y
    cortesía), **nunca da créditos**. Si además es anfitrión, el QR de cupones va en la pestaña «Anfitrión» y como link
    en el reverso (`anfitrion.qr_url`);
  - **si es solo anfitrión:** el QR de cupones `/r/{codigo8}`, como hoy.
- **Créditos:** solo con el código de un solo uso del botón «Canjear» (R-01). Ni el QR del socio ni el de cupones
  sirven para canjear.
- La base da **datos**; los textos los arma B en ES y EN. Las únicas cadenas libres son los nombres de promociones y
  cortesías (en español; `nombre_en` opcional).

## 2. Datos del pase: `club_pase_datos(p_miembro uuid) → jsonb`
Ejecutable solo por `service_role`. Devuelve `null` si el miembro no existe. Ejemplo (datos ficticios):

```json
{
  "contrato": 1,
  "miembro_id": "00000000-0000-4000-8000-00000000c0de",
  "version": 418,
  "actualizado_en": "2026-11-07T19:30:00Z",
  "nombre_pila": "Ana",
  "estado": "activo",
  "local": { "id": "santa-teresa", "nombre": "Satori Sushi Bar · Santa Teresa" },
  "pestanas": ["mi_club", "anfitrion"],
  "codigo_barras": { "tipo": "socio", "valor": "https://club.satoricostarica.com/s/ABCD2345K" },
  "socio": {
    "estado": "activo",
    "desde": "2026-11-10",
    "qr_url": "https://club.satoricostarica.com/s/ABCD2345K",
    "beneficio": "Vale en todos los Satori",   // Club compartido (08-nov): texto genérico; null si está pendiente
    "visitas_mes": 3,
    "cortesias": [
      { "sorpresa": true, "cantidad": 1, "motivo": "promo", "vence_en": null },
      { "sorpresa": true, "cantidad": 1, "motivo": "premio_referido", "vence_en": "2026-12-31" }
    ]
  },
  "anfitrion": {
    "activo": true,
    "tipo": "referente",
    "codigo_publico": "ABCD2345",
    "qr_url": "https://club.satoricostarica.com/r/ABCD2345",
    "personas": 14,
    "creditos": 2.0,
    "personas_proximo_medio": 1,
    "valor_credito_crc": 18000,
    "referidos_mes": 9,
    "creditos_ganados_mes": 1.5
  },
  "promociones": [
    { "id": "8f0e…", "nombre": "Local Club", "nombre_en": null, "beneficio": "10 % + 1 postre", "para": ["socio"],
      "vigente_hasta": null, "dias": [1,2,3,4,5,6,7], "horario": null }
  ],
  "canjear_url": "https://club.satoricostarica.com/w/<token_pase64>"
}
```

Reglas de los campos:
| Campo | Regla |
|---|---|
| `version` | Sube con cualquier cambio que afecte al pase (ver §3). B solo actualiza el objeto si `version` subió. |
| `estado` | `activo` o `baja` de la persona. Con `baja`: B **expira** el pase (estado `EXPIRED` en Google). |
| `pestanas` | `["mi_club"]`, `["anfitrion"]` o las dos, en ese orden. |
| `codigo_barras` | `{tipo: "socio" \| "cupones", valor: url}`. Es el código de barras del pase (ver §1). `null` si no tiene ningún rol activo o pendiente. |
| `anfitrion` | `null` si no es anfitrión (referente, concierge PM o equipo). `creditos` con un decimal (0,5 de paso). `codigo_publico` cambia si se regenera el QR. |
| `socio` | `null` si no es socio. `estado`: `pendiente` (mostrar «Validá tu alta en tu próxima visita»), `activo` o `baja`. Con `pendiente` el beneficio **no** aplica y `cortesias` va vacío. `qr_url` es el QR fijo del socio (solo identifica). |
| `socio.cortesias` | Lo que le corresponde **en su próxima visita** (promo vigente + premios por referido pendientes). **Es un sorteo:** el producto se decide en caja al escanear; el pase muestra «1 cortesía sorpresa» (`sorpresa: true`, sin producto). |
| `promociones` | Solo las vigentes hoy para los roles que tiene. |
| `canjear_url` | Solo si es anfitrión. **CLUB-AUD-69:** usa el **token de pase** (propio, revocable y regenerable), **nunca** el del portal. Con él solo se abre «Canjear», que genera el código de un solo uso (R-01). Si se revoca o se regenera, el link viejo deja de servir y el pase se actualiza (evento `datos`). El pase **no** lleva `portal_url`. |

## 3. Cómo se avisa un cambio: eventos (cola de solo inserción)
`club_pase_eventos(id bigint identity, miembro_id uuid null, motivo text, creado_en timestamptz)`.
La llenan **triggers de la base**; `miembro_id` null = afecta a **todos** los pases (una promoción nueva o terminada).

| `motivo` | Cuándo |
|---|---|
| `movimiento` | tarjeta, canje, vencimiento, ajuste o restitución del miembro |
| `rol` | alta o cambio de estado de anfitrión o de socio (incluye pendiente → activo y «activar como anfitrión») |
| `datos` | nombre, baja/reactivación, código del QR o token regenerados |
| `cortesia` | premio por referido creado o usado; cortesía entregada |
| `promociones` | promoción creada, editada, vigente o terminada (`miembro_id` null) |
| `config` | (08-nov) cambió el valor del crédito o las personas por crédito del local (`miembro_id` null): cambia el ₡ y los créditos de todos los pases |

Funciones para B (solo `service_role`):
- `club_pase_eventos_leer(p_despues bigint, p_limite int default 500) → table(id, miembro_id, motivo, creado_en)`
- `club_pases_emitidos(p_plataforma text, p_despues uuid default null, p_limite int default 500) → table(miembro_id,
  object_id, emitido_en)`: los pases emitidos, paginados por `miembro_id`. Para los eventos con `miembro_id` null
  (promociones): B recorre esta lista y actualiza cada objeto (08-nov).
- `club_pase_cursor_leer(p_nombre text) → bigint` y `club_pase_cursor_guardar(p_nombre text, p_id bigint)`: B guarda
  hasta dónde procesó (`p_nombre` = `'google'` o `'apple'`), así un reinicio no reprocesa ni pierde.
  **CLUB-AUD-70:** `guardar` **solo avanza** (dos sincronizaciones simultáneas dejan el máximo). Para reprocesar hay
  una función aparte y explícita: `club_pase_cursor_rebobinar(p_nombre, p_id, p_motivo)` (motivo obligatorio), que
  queda en la auditoría. Hecho en A2: prueba 57 y carrera 17 (dos `guardar` a la vez → queda el máximo).

**Entrega:** B corre su sincronización **cada 2 minutos** (programada en el Edge de B) y también **a pedido** desde el
portal («Actualizar mi pase»). Para cada `miembro_id` distinto del lote: `club_pase_datos` → si `version` subió,
PATCH del objeto. Si `miembro_id` es null: recorrer los pases emitidos. Los eventos **no** llevan datos: siempre se
releen con `club_pase_datos` (así un evento perdido o repetido no rompe nada).

## 4. Mensajes al dueño del pase: `club_alertas`
Ya existe (R-01): una fila por canje (`tipo = 'canje'`, `miembro_id`, `movimiento_id`, `creado_en`, `enviado_en`, `canal`).
- `club_alertas_pendientes(p_limite int) → table(id, miembro_id, tipo, creditos, saldo_creditos, fecha)`
- `club_alerta_enviada(p_id bigint, p_canal text)`: marca `enviado_en = now()` y `canal` (`google`, `apple`).

B manda el mensaje del pase («Se canjearon 1,5 créditos de tu cuenta. Te quedan 2. ¿No fuiste vos? Avisanos.») y lo
marca enviado. Mientras el miembro no tenga pase, sigue el link wa.me en caja.

## 5. Emisión: quién crea el pase
- En el portal (`/p/{token}`) aparece «Agregar a Google Wallet». club-web llama a la Edge de B
  (`POST /club-pase/google` con el token) — **mismo patrón que las funciones públicas: header `x-club-web` + tope por IP**.
- B resuelve el token **del portal** con `club_pase_por_token(p_token text) → uuid` (solo `service_role`; solo para
  emitir el pase desde el portal), arma el objeto con
  `club_pase_datos` y devuelve el link «Save to Google Wallet» (JWT firmado). El objectId es
  `<issuerId>.club-<miembro_id>` (estable: regenerar el QR o el token **no** cambia el pase).
- `club_pase_emitido(p_miembro uuid, p_plataforma text, p_object_id text)`: B registra el pase emitido
  (tabla `club_pases`), para saber a quién actualizar y para la baja.
- **Autoalta de socio:** el formulario de club-web (`/alta`), al terminar, ofrece el mismo botón (pase en estado
  pendiente). Solo a una persona **nueva**: si el WhatsApp ya existía, la respuesta no trae el portal (A2).
- **Botón «Canjear» del pase:** `canjear_url` = `https://club.satoricostarica.com/w/{token_pase}`. club-web llama a
  `club_canje_codigo_generar_pase` (pública por club-web, como el portal). Owner o manager lo revocan o regeneran en
  Miembros (`club_pase_token`).

### Notas de B1 (08-nov)
- **Tipo de pase:** genérico (`genericClass` `<issuerId>.club-satori`, `genericObject` `<issuerId>.club-<miembro_id>`).
  Código en `src/shared/wallet/` y el Edge en `supabase/functions/club-pase/` (rama `claude/club-wallet`).
- **Largo del JWT:** el completo (clase + objeto) ronda los **3 KB**; Google recomienda ≤ ~1.800 caracteres. Para eso
  está el **JWT flaco** (solo `id` y `classId`), que sirve cuando el objeto ya existe en Google: lo crea o actualiza
  la sincronización por API REST (B3). Hasta B3 se usa el completo (DECISIÓN PROVISORIA; se prueba en B5 con un
  teléfono real).
- **`club_pase_emitido` se registra al generar el link**, no cuando la persona toca «Guardar» (Google no avisa). B3 tiene
  que tolerar un objeto que no existe en Google (404 al actualizar → no es error).

## 6. Apple (apagado)
Mismo contrato. Flag `club_config.wallet_apple_activo = false` (lo agrega A). B deja listo el `.pkpass` y el web
service de actualización de Apple, y no se ofrece el botón mientras el flag esté apagado.

## 7. Secretos y configuración (los carga el dueño, nunca por chat ni en el repo)
- Google: `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_KEY` (JSON de la cuenta de servicio) como secretos del Edge de B.
- Apple (más adelante): certificado del Pass Type ID y su clave.
- Diseño: logo, colores e imagen del local (B propone; el dueño aprueba).

## 8. Qué entrega A y cuándo (para que B no espere)
| Entrega de A | Día de A | B mientras tanto |
|---|---|---|
| **Stub** de `club_pase_datos`, `club_pase_por_token`, `club_pase_emitido`, eventos y cursor, con datos REALES de referentes y `socio: null` | **día 1** | trabaja con el JSON de ejemplo de §2 |
| `socio`, `cortesias` y `promociones` reales; eventos de `rol`, `cortesia` y `promociones` | día 5 (**A3, 08-nov: `promociones`, `socio.beneficio`, la «cortesía sorpresa» de la promo y el evento `promociones` ya son reales; A4, 08-nov: `visitas_mes` y los premios por referir en `socio.cortesias` también** — el contrato v1 de A está completo) | prueba el pendiente → activo con datos sintéticos |
| Contrato congelado (v1) + datos de prueba sintéticos en staging para B | día 6 | integración de punta a punta |

## 9. Pruebas que comparten A y B
- Los `service_role`-only: `anon` y `authenticated` no ejecutan ninguna función de este contrato.
- `club_pase_datos` nunca contiene `@`, `+506` ni el token del portal (`canjear_url` lleva el token de pase).
- Token de pase revocado → `/w/` no genera código y `canjear_url` vuelve `null` (A2, prueba 57).
- Un canje genera un evento `movimiento` y una alerta; la versión sube; el pase muestra el saldo nuevo en ≤ 2 min.
- Socio pendiente → validado en caja → evento `rol` → el pase pasa a activo y muestra la cortesía.
- Baja → el pase queda expirado.
