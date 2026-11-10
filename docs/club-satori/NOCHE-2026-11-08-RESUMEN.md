# Noche 07→08-nov · RESUMEN de integración (04:30)

> Rama **`claude/club-integracion`** = `claude/epic-tesla-pyo77m` + `claude/club-wallet`. **Sin merge a `main`.**
> Solo staging. Nada desplegado, ningún secreto nuevo, prod sin tocar.

## SHA de corte para la auditoría de Grok
**`5fd7ab1`**: el código integrado. Es la punta de `claude/club-wallet`, que ya contiene a `claude/epic-tesla-pyo77m`
(`5a244c4`), así que la integración no tuvo conflictos ni commits propios de código. Este documento y AVANCE van en un
commit de solo docs encima.

Además, fuera de esta rama: **`831b3ee`** en `claude/puente-item11` (puente, sin desplegar).

- Diferencia contra `main`: 84 commits, 108 archivos.
- La 075 de la integración es **idéntica** a la de `epic-tesla`; se aplicó en staging sin cambios.

## Qué entró esta noche
### Sesión A (`claude/epic-tesla-pyo77m`)
| Tanda | Qué | SHA |
|---|---|---|
| pre | CLUB-AUD-36 (resolver solo lo que figura hoy; segregación por registrante) | `3e294a5` |
| pre | R02 «pendiente de configuración» sin el código de PROMO CLUB | `8a76ed8` |
| pre | CLUB-AUD-68 (cruce por factura tipeada exige estado C) | `f3b65cb` |
| pre | CLUB-AUD-38 (lock antes de contar intentos; carrera 18) | `2b306ff` |
| pre2 | CLUB-AUD-71 (provisional vencido no se renueva en caja) | `64d969a` |
| pre2 | CLUB-AUD-72 (autoalta con teléfono existente → solicitud, no cambia nada) | `208cdc2` |
| pre2 | CLUB-AUD-73 (purga borra el contacto sin otro rol activo; aviso fiel; aviso_version en caja) | `b6ab9b3` |
| pre2 | CLUB-AUD-74 (tope por prefijo de red, alerta al 80 %, RUNBOOK Turnstile de prod) | `80cbfa3` |
| 01:00 | **A3**: promociones mínimas, productos de las facturas, cortesías del sorteo (SQL + pantalla) | `fc53012`, `600b868` |
| 01:00 | CLUB-AUD-42 (modo `pruebas` solo con la base marcada como staging) | `5b441c9` |
| 01:00 | CLUB-AUD-43 **parcial** (4 asserts débiles reforzados; falta la lista W1–W14) | `3439244` |

### Sesión B (`claude/club-wallet`, sin desplegar)
| Qué | SHA |
|---|---|
| **B1**: Edge `club-pase`. Clase y objeto genéricos de Google y JWT «Save to Google Wallet» RS256. Portón `x-club-web`; falla cerrada sin secretos | `adfa208` |
| **B2**: botón «Agregar a Google Wallet» en el portal y en la autoalta, **apagado por flag** | `5bede8d` |
| **B3 parcial**: sincronización pura (token OAuth, PATCH, mensajes de canje, cursor) y rutas `sync` y `actualizar` | `f3f53d9`, `2654b7e` |

### Puente (`claude/puente-item11`, sin desplegar)
- CLUB-AUD-46/47/48: el cursor solo avanza; secretos ≥ 32 y sin repetir; topes de largo. SHA `831b3ee`.
- vitest de esa rama: 1.455.

## Resultados (sobre `5fd7ab1`, corridos a las 04:30)
| Prueba | Resultado |
|---|---|
| Batería `075_pruebas_staging.sql` | **354/354** |
| Carreras | **8/8** (03, 07, 08, 15, 16, 17, 18) + 04 cierre concurrente |
| Paridad (staging contra 075 desde cero) | **724 = 724**, sin diferencias |
| vitest | **1.521** pasan (121 archivos; 4 omitidas, como siempre) |
| Build app / club-web | OK / OK |
| Lint de lo tocado (Club, wallet, Edge club-pase, club-web) | limpio |
| Lint del repo completo | 86 problemas en 46 archivos, **ninguno tocado por estas ramas** (vienen de `main`) |
| Migrador F1b | 15 OK (3 omitidas, como siempre) |
| Staging al cierre | **2.538 movimientos · 338 miembros · 338 roles**; 0 residuos, 0 intentos, 0 cortesías, 0 solicitudes |

Arreglos en la integración: **ninguno** (no hubo nada roto).

## Necesita al dueño (todo junto)
**Datos y decisiones**
1. El **código de «PROMO CLUB 10%»**. Apaga las dos filas «pendiente de configuración» y enciende `CUPON_SIN_PROMO` y
   `PROMO_SIN_CUPON`.
2. Crear en el PoS la **sección «CORTESÍA CLUB»** con sus artículos a ₡0, y pasarme el **número de familia y los
   códigos**.
3. **Texto final del aviso de privacidad** (hoy `v0-provisorio`, ES y EN en `club-web/src/i18n.ts`); el día que se
   firme, sube a `v1` en la base y en club-web.
4. El día del lanzamiento:
   - pasar la promo «Local Club» a **vigente**;
   - pasar el PoS de 15 % a 10 %.
5. **Logo y color** del pase de Wallet.
6. La **lista W1–W14** de la auditoría de Grok, para cerrar CLUB-AUD-43.
7. ~~Qué marca el artículo **857 «INVITADO»** (aparece junto al 856 en 90 facturas). Viene de antes; sigue abierto.~~
   **REEMPLAZADO** (08-nov): el 857 es el beneficio para quien viene con un socio, sin límite de acompañantes (decisión de
   el dueño; `bd6786e`).

**Cuentas y secretos (nunca por chat ni en el repo)**

8. **Google Wallet:** cuenta de emisor (`GOOGLE_WALLET_ISSUER_ID`) y cuenta de servicio (`GOOGLE_WALLET_SA_KEY`), como
   secretos del Edge `club-pase`.
9. En el Edge `club-pase`:
   - `CLUB_WEB_KEY` (el mismo de club-web);
   - `CLUB_PASE_SYNC_KEY` (nuevo, para el programador de B3).
10. **Turnstile:**
    - en staging alcanzan las claves de prueba de Cloudflare;
    - en prod, el widget real (`VITE_TURNSTILE_SITEKEY` y el Secret `TURNSTILE_SECRET`), nunca las de prueba (RUNBOOK
      paso 6).

**Firmas**

11. Desplegar `club-pase` en staging cuando estén los secretos, y después encender `VITE_WALLET_GOOGLE=1`.
12. Pasar CLUB-AUD-46/47/48 del puente a `claude/puente-item11-prod` y actualizar la PC del agente; la PC sigue en
    `0cf4d87`.

**Para la próxima sesión A (no es del dueño)**
- `club_pases_emitidos()`, solo de service_role: la necesita B3 para los eventos globales de promociones.
- CLUB-AUD-44/45 (ingesta transaccional por local en el puente): sigue primera en la cola.
- Después, A4: motor «qué aplicar», sorteo, visita por factura y premio por referir.

## Decisiones provisorias de la noche (detalle en cada NOCHE-…)
- **pre:** AUD-68 con `estado = 'C'` en vez de retirar el camino tipeado.
- **pre2:** tope por prefijo de red con el mismo binding de 5 por minuto (un wifi de hotel puede frenar a un grupo).
- **A:**
  - solo el owner edita promociones y cortesías;
  - la «sección» del PoS se identifica por su número de familia;
  - la promo semilla queda en borrador.
- **B:**
  - pase genérico;
  - JWT completo hasta B3 (pesa unos 3 KB; Google recomienda 1.800 caracteres);
  - no se crean objetos que nadie guardó;
  - el botón de Wallet va apagado por flag.
