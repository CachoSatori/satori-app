# Perfil técnico — Sistema de créditos Satori Sushi Bar

**Solo lectura.** Informe para spec React + Supabase y migración.  
**Sin datos de contacto** (teléfonos, emails, cédulas → ejemplos `XXXX`).  
**Zona horaria reportada:** America/Costa_Rica (CR, UTC-6).

| Ítem | Valor |
|------|-------|
| URL | https://creditos-73bac.web.app |
| Proyecto Firebase | `creditos-73bac` |
| Informe | `/workspace/creditos/perfil_tecnico/perfil-tecnico-sistema-creditos.md` |
| Lectura fresca | **OK** (2026-11-05 ~12:29 CR) |
| Export migración (con contactos, solo caja) | `/workspace/creditos/perfil_tecnico/export_migracion/` |
| Script reutilizable | `/workspace/creditos/bot/leer_firestore.py` |

---

## 1. Stack

| Pieza | Hallazgo | Evidencia |
|-------|----------|-----------|
| Front | Ionic React (CRA), PWA `manifest.json`, título «Créditos CR» | `index.html`, bundle `main.aaffacf4.js` |
| Hosting | Firebase Hosting | `*.web.app`, `fire_config.js` |
| DB | Cloud Firestore | SDK web en bundle + REST |
| Auth | Email/password (`signInWithPassword`) | pantalla `/login` |
| Quién entra | Usuarios Firebase Auth cuyo `uid` está en `businesses.membersId` | query `array-contains` |
| Roles | Custom claim `role` (cuenta dueño: `"root"`). **No** hay roles gestor/cajero/dueño en el front: cualquier member del business ve las mismas pantallas | Auth lookup; bundle sin checks de rol de UI |
| Negocios | 2: **Satori Terrace Sushi Bar** (`uPberDoE9w19ydF6bZSA`, 2 members) y **Burger House** (`nueOeYoaWKJhYZavomUe`, 1 member) | lectura fresca `businesses` |
| Cloud Functions | **NO VERIFICADO** (no hay `httpsCallable` / `cloudfunctions` en el bundle) | bundle |
| Reglas seguridad | **NO VERIFICADO** texto de rules (hace falta admin). Inferido por REST: ver tabla abajo | pruebas REST |
| Analytics | `measurementId` en config | `fire_config.js` |
| Storage | `storageBucket` en config; **NO VERIFICADO** uso real de archivos | config |

### Reglas inferidas (comportamiento REST, 2026-11-05)

| Operación | Resultado |
|-----------|-----------|
| `list` `businesses`, `referrers`, `users_info` | OK si autenticado |
| `list` / `runQuery` sin filtro en `referrals*` | 403 |
| `runQuery` `referrals`/`referrals_club` con `businessId ==` negocio donde `uid ∈ membersId` | OK |
| `get` doc `referrals/{id}` | OK (probado) |
| `listCollectionIds` | 403 |
| Lectura referrals de Burger House con cuenta Satori | 403 |

**NO VERIFICADO:** si `role=root` cambia permisos; reglas de write; existencia de otras colecciones no listables.

### firebaseConfig (público)

```js
projectId: 'creditos-73bac'
authDomain: 'creditos-73bac.firebaseapp.com'
// apiKey / appId / measurementId en fire_config.js del hosting
```

---

## 2. Modelo de datos

Colecciones top-level (sin subcolecciones en el cliente). Conteos = lectura fresca Satori salvo nota.

| Colección | Docs | Método lectura |
|-----------|-----:|----------------|
| `businesses` | 2 | list |
| `referrers` | 340 | list |
| `referrals` | 2742 (credit 1816, debit 926) | runQuery businessId Satori |
| `referrals_club` | 125 (credit 104, debit 21) | runQuery businessId Satori |
| `users_info` | 314 | list |

Otras colecciones: **NO VERIFICADO** (listCollectionIds 403). Bundle solo nombra las cinco de arriba.

### `businesses`

| Campo | Tipo | Ej. anonimizado | % presente |
|-------|------|-----------------|------------|
| `_id` | string | `uPberDoE9w19ydF6bZSA` | 100 % |
| `name` | string | `Satori Terrace Sushi Bar` | 100 % |
| `peoplePointsRate` | number | `6` | 100 % |
| `amountPointsRate` | string **o** number | `"1"` | 100 % |
| `membersId` | array\<uid\> | `["XXXX…"]` | 100 % |
| `profilePic` | string | `satori.jpeg` | 100 % |
| `createdAt` | — | — | **NO VERIFICADO** en docs actuales (sí se setea al crear en UI) |

Alta de negocio (bundle): `peoplePointsRate:6`, `amountPointsRate:1`, `membersId:[uid]`.

### `referrers` (personas / referentes)

| Campo | Tipo | Ej. | % presente (fresco) |
|-------|------|-----|---------------------|
| `_id` | string | `07SyEz…` | 100 % |
| `name` | string | `NN/ Nombre PM` | 339/340 (1 vacío) |
| `workPlace` | string | `Negocio` | 100 % |
| `businessId` | string | `uPberDoE9w19ydF6bZSA` | 100 % |
| `email` | string | `XXXX` | 72/340 |
| `phoneNumber` | string | `XXXX` | ~100 % (muchos basura/`None`) |
| `deleted` | bool | `false` | 100 % |
| `createdAt` | timestamp | ISO | 100 % |
| `updatedAt` | timestamp | ISO | 100 % |

Soft-delete: `deleted:true` (88). Relación: `users_info._id == referrers._id`.

### `referrals` (movimientos tarjeta / consumo)

| Campo | Tipo | Ej. | % |
|-------|------|-----|---|
| `_id` | string compuesto | `{referrerId}\|{businessId}\|{unixSeg}\|{peopleCount}\|{credit\|debit}` | 100 % |
| `referrerId` | string | | 100 % |
| `businessId` | string | | 100 % |
| `referralType` | `"credit"` \| `"debit"` | | 100 % |
| `peopleCount` | number | tarjeta: personas; consumo: `6` o `3` (rate/2) | 100 % |
| `peoplePointsRateSnapshot` | number | `6` | 100 % |
| `createdAt` | timestamp server | | 100 % |

**No guarda:** quién cargó, n° de tarjeta, mesa, factura, nota, usuario operador.

### `referrals_club` (comisiones / pagos)

| Campo | Tipo | Ej. | % |
|-------|------|-----|---|
| `_id` | mismo patrón, 4º segmento = `amount` | | 100 % |
| `referrerId`, `businessId` | string | | 100 % |
| `referralType` | credit=carga comisión; debit=pago | | 100 % |
| `amount` | int | centavos de la UI (`importe * 100`) | 100 % |
| `amountPointsRateSnapshot` | string/number | `"1"` | 100 % |
| `createdAt` | timestamp | | 100 % |

**No guarda:** % comisión, n° factura, mesa, operador.

### `users_info` (saldo denormalizado; `_id` = referrerId)

| Campo | Tipo | % |
|-------|------|---|
| `businessId` | string | 100 % |
| `deleted` | bool | 100 % |
| `peopleBalance` | number (personas netas, no créditos) | 293/314 |
| `amountBalance` | number (centavos club) | 35/314 |

Actualización: `FieldValue.increment` en la misma transacción que crea el movimiento (`dC` / `increment` en bundle).

### Relaciones

```
businesses 1───* referrers (businessId)
referrers 1───1 users_info (_id)
referrers 1───* referrals / referrals_club (referrerId)
```

---

## 3. Movimientos (créditos / personas)

### Carga de tarjeta (`referralType=credit`)

| Qué | Valor |
|-----|-------|
| UI | `/credits/add-credit` — persona + «Cantidad de personas» + Guardar |
| Guarda | `peopleCount`, `peoplePointsRateSnapshot`, `createdAt`, ids |
| No guarda | operador, n° tarjeta, nota |
| Efecto saldo | `peopleBalance += peopleCount` |
| Texto historial | `Carga de tarjeta por N persona(s)` |

### Consumo (`referralType=debit`)

| Qué | Valor |
|-----|-------|
| UI | `/credits/add-debit` — «Créditos a consumir» (number; enteros o `.5`) |
| Split | N créditos → N documentos: cada uno `peopleCount = rate` (1 crédito) o `rate/2` (0,5) |
| Validación | solo full o half credit: `peopleCount % rate == 0` **o** `rate/peopleCount == 2` |
| Efecto saldo | `peopleBalance -= peopleCount` por cada doc |
| Texto | `Consumo de 1 crédito` si `peopleCount == snapshot`; si no `Consumo de 0.5 créditos` |
| Mesa/factura/quién | **no** |

Cancelación 05-nov: 103 créditos → **136 docs** debit (porque 0,5 suma docs extra).

### Cálculo «personas para próximo crédito» y medios créditos

Constantes en bundle: `vj = 0.5`; default rate `wj = peoplePointsRate || 6`.

```js
// créditos disponibles a partir de personas netas
Oj = (personas, rate) => {
  const n = personas / rate;
  return Math.floor(n) + (n % 1 >= 0.5 ? 0.5 : 0);
}
// personas que faltan para el próximo crédito
Pj = (sumCreditPeople, sumDebitPeople, rate) => { /* resto hasta múltiplo */ }
```

UI de actividad: suma movimientos (`credit` − `debit` en `peopleCount`) y aplica `Oj` / `Pj` — **no** lee solo `peopleBalance` para el card (aunque el saldo se mantiene en paralelo). Drift activo observado: **2** cuentas (`peopleBalance` ≠ suma movimientos) — limpiar en migración.

### ¿Saldo guardado o calculado?

**Ambos:** denormalizado en `users_info.peopleBalance` (increment) **y** recalculable desde `referrals`. La UI de canje usa el recalculo (`canDebit` si créditos disponibles > 0).

---

## 4. Club PM

### Carga de comisión (`/club/add-credit`, título «Cargar crédito»)

| Campo UI | Persistencia |
|----------|--------------|
| Persona | `referrerId` |
| **Importe** | `amount = parseInt(100 * valorUI)` (enteros ≥ 1) |
| — | `referralType=credit`, `amountBalance += amount` |

No pide % ni factura. Toast interno: `"Club Add Dinner"`. Éxito: «Carga de consumo realizada satisfactoriamente».

### Pago (`/club/add-debit`, título «Pagar»)

| Campo UI | Persistencia |
|----------|--------------|
| **Valor a pagar** | `amount = 100 * amountToDebit` |
| — | `referralType=debit`, `amountBalance -= amount` |

`canDebit` si hay al menos 1 carga club y monto disponible. Display: `amount/100` con `Intl` **USD** (posible desajuste vs colones del negocio — **NO VERIFICADO** unidad vs PoS).

### Sufijo «PM»

**Convención de nombre**, no flag en DB. Concierges: patrón `NN/ Nombre PM`. Activos con sufijo PM: **31** / total nombres PM **36**.

### «Monto a cobrar» en no-PM

`Monto a cobrar` = `Oj(sum amount credit − debit, amountPointsRate)` ≈ `amountBalance` si rate=1. **Cualquier** referente puede tener movimientos club; 12 cuentas activas no-PM tienen `amountBalance ≠ 0`. El bot de reportes trata PM por sufijo de nombre, no por saldo.

---

## 5. Pantallas y flujos

Rutas (bundle):  
`/login` · `/credits` · `/credits/add-credit` · `/credits/add-debit` · `/club` · `/club/add-credit` · `/club/add-debit` · `/info` · `/profile` · `/users-info` · `/users-info/credits` · `/users-info/club` · `/referrer-info/:id` · `/referrer-history/:businessId/:referrerId/:credits|club`

Barra: Créditos / Club / Información / Mi cuenta.

| Pantalla | Uso | Quién (práctica) |
|----------|-----|------------------|
| Login | email + password | cualquiera con cuenta Auth + member |
| `/credits` | métricas del mes, selector mes, listado con créditos, Cargar Tarjeta / Consumir | cajero / gestor / dueño (mismo UI) |
| add-credit / add-debit | alta movimientos personas | idem |
| `/club` + add-* | comisiones / pagos | idem |
| `/info`, referrer-info | ficha, editar, historial, eliminar soft | idem |
| `/users-info/*` | listas lectura | idem |
| `/profile` | «Mi cuenta», logout | idem |

**Roles diferenciados en UI:** no hay. **NO VERIFICADO** si hay más users Auth no-member.

### Paso a paso — cargar tarjeta

1. `/credits` → **Cargar Tarjeta**  
2. Seleccionar persona (o agregar)  
3. Ingresar **Cantidad de personas** (> 0)  
4. Guardar → doc `referrals` credit + increment `peopleBalance`  
5. Toast «Tarjeta cargada satisfactoriamente»

### Paso a paso — canjear

1. `/credits` → **Consumir Crédito**  
2. Seleccionar persona → ve resumen (disponibles, personas p/ próximo, etc.)  
3. «Créditos a consumir» (n o n.5); botón disabled sin saldo  
4. Submit → **un write por crédito/medio**; toast éxito  
5. Sin mesa/factura/nota

### Paso a paso — pagar comisión club

1. `/club` → **Pagar**  
2. Seleccionar persona con monto a cobrar  
3. **Valor a pagar** → debit club  
4. Toast (reusa textos de créditos; copy imperfecto)

---

## 6. Reglas de negocio EN EL CÓDIGO

| Regla | Valor / comportamiento | Dónde |
|-------|------------------------|-------|
| Personas por crédito | `peoplePointsRate = 6` (default negocio) | create business + snapshots |
| Medio crédito | `0.5`; consume `peopleCount = rate/2` | `vj`, debit split |
| Validación consumo | solo 1 o 0.5 créditos (vía rate) | `FM` / «Unable to consume credit…» |
| Créditos a consumir | `>0` y entero o `.5` (`Aj`) | add-debit |
| Personas tarjeta | `>0` | validator form |
| Club importe | entero ≥ 1 en UI; ×100 al guardar | yup `transform` |
| Club pago | ≥ 1; ×100; no exceder disponible | form + check |
| Snapshot rate | debe coincidir con business actual | create tx |
| Soft delete | `referrers.deleted` + `users_info.deleted` | Eliminar |
| Reportes mes | sumas por `createdAt` (UTC en práctica del sitio «Mes a mes») | CreditsMonthlyStats / ClubMonthlyStats |
| Valor cara crédito ₡18.000 | **NO está en el bundle** — solo en bot reportes (`VALOR_CREDITO`) | bot LEEME |
| Máximo créditos por visita | **no** en código cliente | — |
| % comisión club | **no** en código; se carga el importe ya calculado | — |

Fragmentos clave (`main.aaffacf4.js`):

- ID: `` `${referrerId}|${businessId}|${unix}|${peopleCount|amount}|${type}` `` (+ sleep 1s anti-colisión)
- Split debit: array de 1s y opcional 0.5 → `peopleCount = rate` o `rate/2`
- WhatsApp: `https://wa.me/${phoneDigits}`

---

## 7. Mensajes / integraciones

| Canal | ¿Hay? | Detalle |
|-------|-------|---------|
| WhatsApp | Sí (link manual) | Botón en ficha: `wa.me` con dígitos de `phoneNumber` (saca `+` y espacios). No envía mensaje automático |
| Email | No mailto / no send | Campo editable; sin integración |
| QR / link por referente | **No** en bundle | — |
| Push / SMS | **NO VERIFICADO** | — |

---

## 8. Calidad de datos (pre-migración)

| Tema | Hallazgo |
|------|----------|
| Borrados | referrers `deleted` 88/340; users_info 80/314 |
| Duplicados nombre (activos) | 13 nombres con >1 cuenta; 13 con distinto `workPlace` |
| Email vacío | 268/340 |
| Teléfono | patrones (sin números): `+506XXXXXXXX` ×112; `8 dígitos sin prefijo` ×50; `506XXXXXXXX sin +` ×31; `+549…` ×33; texto/`None` ×67+; otros internacionales varios |
| Nombre vacío | 1 |
| `amountPointsRate` | string `"1"` en Firestore (código asume número) |
| Drift saldo | 2 activos `peopleBalance` ≠ suma referrals |
| Segunda business | Burger House en mismo proyecto; no migrar salvo pedido |
| Cancelación | 136 débitos 05-nov 11:09–11:42 CR; marcar en migración |

**Limpiar antes de migrar:** unificar teléfonos E.164; decidir duplicados nombre+negocio; reconciliar 2 drifts; tipar `amountPointsRate`; filtrar `deleted`; excluir o marcar cancelación 12m; no importar Burger House sin revisión; normalizar `None` en phones.

---

## 9. Export para migración

### Ya generado (caja, chmod 700/600, **con contactos**)

`/workspace/creditos/perfil_tecnico/export_migracion/`

| Archivo | Contenido |
|---------|-----------|
| `*.json` | colecciones completas |
| `referentes.csv` | referrers + email/phone |
| `movimientos.csv` | referrals + `tipo` + `cancelacion_vencimiento_12m=sí\|no` (136 sí) |
| `club_movimientos.csv` | club |
| `users_info.csv`, `businesses.csv` | saldos / negocios |
| `cancelacion-creditos-2026-11-05_con_ids.csv` | 90 filas; `ids_movimientos` unidos con ` \|\| ` |
| `MANIFEST.md` | fecha CR, conteos, sha256 |

### Cómo repetir

```bash
python3 /workspace/creditos/bot/leer_firestore.py \
  --destino /ruta/export \
  --business-id uPberDoE9w19ydF6bZSA
# opcional: --sin-contacto
```

Credenciales: `/workspace/creditos/bot/.login` (600). Doc: `/workspace/creditos/bot/LEEME.md`.

### Cancelación 05-nov-2026 (verificada)

| Métrica | Valor |
|---------|-------|
| Cuentas | 90 |
| Créditos | 103.0 |
| Docs Firestore | 136 debit |
| Ventana CR | 2026-11-05 11:09:18 → 11:42:50 |
| CSV con ids | `/workspace/creditos/bot/cancelacion/cancelacion-creditos-2026-11-05_con_ids.csv` |

Respaldo pre-cancelación (09:19 CR, sin contacto): `/workspace/creditos/bot/respaldo_2026-11-05/` (2606 referrals).

---

## Hallazgos clave para la spec (Supabase)

1. **Dos monedas de puntos:** personas→créditos (rate 6, medios 0,5) y club montos×100 con rate 1; mismas ideas credit/debit.  
2. **Un consumo de N créditos = N filas** (no una fila con N); la cancelación 12m son 136 filas.  
3. **Saldo doble:** tabla saldo + hechos; UI confía en hechos; migrar ambos y reconciliar.  
4. **Casi sin auditoría:** sin operador, mesa, factura, % comisión, n° tarjeta.  
5. **PM = sufijo de nombre**, no rol/entidad.  
6. **Auth simple:** members del business; claim `role` existe pero el front no ramifica.  
7. **IDs determinísticos** con `|` y timestamp — en Supabase preferir UUID + columnas; conservar `_id` viejo para traza.  
8. **WhatsApp solo deep-link**; sin mensajería server-side.

---

## NO VERIFICADO

- Texto de Security Rules y Cloud Functions (sin consola admin)  
- Si `role=root` otorga privilegios extra en rules  
- Colecciones no referenciadas por el bundle  
- Uso real de Storage / Analytics  
- Unidad club vs colones PoS (UI formatea USD `/100`)  
- Máximo por visita u otras reglas solo en procesos humanos  
- Contenido/historial de Burger House  
- Identidad de los 2 members (uids) más allá de conteo  

---

## Fuentes

| Fuente | Uso |
|--------|-----|
| Bundle `main.aaffacf4.js` + `fire_config.js` | reglas, rutas, validaciones |
| Lectura Auth+REST 2026-11-05 ~12:29 CR | conteos, campos, export |
| Respaldo `bot/respaldo_2026-11-05/` | baseline pre-cancelación |
| UI inspeccionada (navegador, solo lectura) | flujos créditos |
| `bot/cancelacion/*` | lista y matching ids |

Snippets: `/workspace/creditos/perfil_tecnico/fuentes/`.
