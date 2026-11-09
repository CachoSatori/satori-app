# Noche 08→09-nov · resumen de integración (04:30) · corte para la auditoría de Grok

> Sesión desatendida. Solo staging y ramas propias; nada en prod, main, Edge ni secretos.
> **Corte de código para la auditoría:** `claude/club-integracion` @ **`c29af16`**. Es epic-tesla `ed447b2` +
> club-wallet `c76e6c4`, más el remoto viejo de integración, del que solo cambian docs. El código es idéntico a
> club-wallet. Este resumen va en el commit siguiente.

## 0. PUENTE (arriba de todo) · 082 v3 en staging: control en verde
Staging tiene **la 082 v3** a propósito: decisión del dueño, Grok 113, aplicada el 09-nov a las 01:43 -06:00.
- ledger `edb7ffc58976804e55968f75df530a05`;
- columna `max_factura_vista`;
- Edge `ingest-ndf` versión 16 desde `5da233a516d1a6c4c2c95eb165be448be5416697`.

No se tocó. Control en solo lectura (04:31–04:38):

| Control | Resultado |
|---|---|
| Consulta C (§6.2) | `r_bajo_corte` 0 · `r_igual_corte` 0 · `r_no_ordenables` 0 · `last_factura` 112536 = `max_factura_vista` 112536 |
| Duplicados (§5.4, desde 01:43:56) | 0 filas |
| Lo que entró desde las 01:43 | 11 anuladas (`X`) releídas; **ninguna `R`** (no hubo ventas de noche): el R → C **con la v3** todavía no se vio en staging real (con la v2 sí: 08-nov 22:43) |
| Latido | sigue (último 04:37), `last_error` null, `last_factura` ≥ 112536 |

Pruebas de la rama `claude/puente-item11-prod-v2` @ `3b78ffd` (sin cambiar nada):

| Prueba | Resultado |
|---|---|
| `puente-compat/correr.sh` | **8/8** |
| `puente_carreras/pruebas.sh` | **38/38** |
| `test_armar_mapa.sh` | **17/17** |
| `probar_sql_paquete.py` | **8/8** |
| vitest `src/shared/ndf` | **203** |

En `claude/puente-locales-genericos` @ `37ffcfb`: vitest de `ndf` y `pos-bridge` **471**.

El #71 (`0a33df42`: 081 `d4acf8da…`, 082 v3 `edb7ffc5…`) no se tocó.

## 1. Qué entró (tandas del 08 y del 09-nov)
- **Noche A** (`736414a`, `4a0f202`):
  - tarjeta del anfitrión a 390 px;
  - ítem 43: 16 asserts fuertes con mutaciones;
  - bug real en `club_sin_cruce_elegir`: no guardaba el actor; ya lo guarda.
- **Madrugada** (`1f040bb`, `ed447b2`):
  - Grok 114: lista blanca de funciones en G-56;
  - Grok 115: cruce papel ↔ Firestore por `legacy_id` dentro de la transacción;
  - Grok 116: prueba API sin secretos en argv, con un usuario sintético.
- **Puente** (otra rama): 082 v3 (Grok 113), Grok 119 y 118 en el paquete y la guía, y el kit de PowerShell en
  Actions, 35/35 en 5.1 y 7.
- **Noche B** (`7bc5532`, `f130c37`, `9088aba`, `c76e6c4`):
  - Grok 75: un miembro con error no traba el cursor del pase; la tabla de reintentos queda como propuesta, fuera
    de la 075;
  - B4: el pase de Apple apagado (`pass.json`, firma PKCS#7, `.pkpass`).

## 2. Pruebas en `c29af16`

| Prueba | Resultado |
|---|---|
| Batería | **568/568** |
| Paridad | **970 = 970**, sin diferencias |
| gate61_test | **19/19** |
| gate61 staging ↔ staging | 3686 = 3686, sin diferencias |
| Carreras | 8/8 |
| vitest | **1.568** (+4 omitidas), con `dominioRepo` |
| club-web | **28** |
| Build de la app | OK |
| Build de club-web | sin `VITE_CLUB_URL` **no compila, a propósito** (B9); con un dominio ficticio, OK |
| Python | **122** OK (15 omitidas sin staging); con `CLUB_ENSAYO_STAGING=1`, OK contra staging sin dejar nada |
| Ensayo de saldos de papel | OK, nada queda |
| Prueba 106/116 por la API | 3/3: 403/42501, el nombre se edita, 0 residuos |

- **Lint:** `eslint .` da 78 errores, todos en módulos fuera del Club que vienen de `main` (admin, caja, CRM,
  finanzas, inbox, scripts de ledger). Los **40** archivos `.ts`/`.tsx` que estas ramas cambian contra `main` están
  **limpios**.

## 3. Staging al cierre (en su base)
- Club: 2538 movimientos, 338 miembros, 338 roles.
- Papel: 0 movimientos y `club_cargas_papel` vacía.
- Sin «Empleado Prueba*», sin usuarios `prueba.invalid`, sin locales `prueba-*` y sin `prueba_rls_82`.
- El manager de prueba, inactivo.
- `club_config_global`: 1 visita por día, 24 meses, `club_url` cargado.
- santa-teresa: encendido, aviso v1.1, corte 16:00, logins 111 y 222, tope de búsqueda 30.
- nosara: apagado, aviso v1.1.
- Descuentos «Descuento 10 % / 15 % / 30 %».
- La 082 v3 y el Edge v16, aplicados. Sin cursor de nosara.

## 4. Necesita al dueño
1. Revisar el cambio de `club_sin_cruce_elegir` en la 075 (noche A): guarda el actor como el resolvedor general.
2. Decidir las **excepciones de la lista blanca de funciones de G-56** (Grok 114):
   - G-56: `now` y `to_char`;
   - el migrador suma 8, cada una con su motivo en `scripts/club/sql_g56.py`;
   - no son inmutables: aceptarlas, o pedir que se reescriban los generadores.
3. Aprobar la **tabla de reintentos del pase** (`docs/club-satori/propuestas/club_pase_reintentos.sql`) para la 075.
   Sin ella, el Grok 75 funciona en modo conservador.
4. Dónde ver los miembros del pase que pasaron el tope de reintentos, para cuando se encienda.
5. La cuenta de Google Wallet y la prueba del pase v4 en un teléfono (B5). Para Apple: Apple Developer y el
   certificado del Pass Type ID.
6. Aprobar el aviso corto del cupón.
7. El dominio del Club en prod se carga en el pase.
8. Las fichas de Grok que no llegaron (77–89, 92, 94–98) y el texto de Grok 76.
9. Revisar y firmar G-56 y G-61.
10. Las 22 tablas de fuera del Club que marca la prueba 82.
11. Que `TURNSTILE_SECRET` en prod también habilita los cupones.
12. Los correos que ya estaban en el repo antes de la regla: decidir. Están en `STAGING.md`,
    `PROMPT-CONTINUACION.md`, `ROADMAP-ARCHIVO.md`, `ESTADO-ARCHIVO.md`, `cierre-email` y `monthly-report`.
13. La auditoría de Grok del paquete del puente con la 082 v3: rama `claude/puente-item11-prod-v2` @ `3b78ffd`, código
    `5da233a`.

**Ya no van como pendientes:**
- el kit de PowerShell (Actions, 35/35);
- la dirección y los 24 meses del aviso;
- la fecha del movimiento de papel;
- C1 del 08-nov (sin efecto);
- la firma del camino v2 (08-nov 19:08);
- la huella de `secrets list` (verificada en staging).
