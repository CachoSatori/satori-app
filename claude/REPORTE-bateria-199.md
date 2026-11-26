# Reporte · batería de la 199 y punta a punta de fe-ingesta (staging)

Turno solo de **staging**. Prod no se tocó. Rama probada: `feat/compras-f1-ingesta` @ `b6558af`.
Sin secretos ni datos reales: el XML, las cédulas (receptor `310199999901`, emisor `999000000001`) y los montos son
los ficticios de `src/shared/fe/fixturasFe.testutil.ts`.

## 1. Secreto `FE_INGESTA_SECRET`

- Generado al azar (64 caracteres hex) y cargado en staging por la Management API.
- Confirmado por la lista de secretos: el nombre aparece y su huella coincide con el sha256 del valor generado.
- El valor no se imprimió, no se pegó y no está en el repo.

## 2. Batería de la 199: abortó en el primer paso

Se armó en una sola transacción: `begin;`, después `scripts/sql/199_rollback.sql`, después
`python3 scripts/sql/199_pruebas.py --armar --compacto` (que cierra con `rollback;`).

Salida:

```
ERROR: 42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.
CONTEXT: PL/pgSQL function storage.protect_delete() line 5 at RAISE
```

- **Causa:** la última línea de `199_rollback.sql` (`delete from storage.buckets where id = 'fe-xml';`). Supabase
  la bloquea con el trigger `storage.protect_delete`. No se corrió ningún caso de la batería.
- **Efecto:** ninguno, porque la transacción entera se descartó. Después del intento: ledger en **199**, tablas
  `fe_*` en **0 filas**, bucket `fe-xml` vacío.
- **El SQL no se editó.** El mismo `delete` frena el caso 90 de la batería y una vuelta atrás real, así que
  `199_rollback.sql` tiene que vaciar y borrar el bucket por la API de Storage.

## 3. Punta a punta contra la Edge `fe-ingesta` de staging

| caso | esperado | real |
|---|---|---|
| XML ficticio con el secreto correcto | 200 «nuevo» | 200 «nuevo» |
| el mismo XML de nuevo | 200 «duplicado» | 200 «duplicado» |
| secreto equivocado | 401 | 401 |
| sin secreto | 401 | 401 |

Para el caso «nuevo» se cargó un receptor ficticio (`310199999901` → `santa-teresa`) en `fe_receptores`.

## 4. Limpieza: queda pendiente

- **Hecho:** el objeto del XML en el bucket `fe-xml` se borró por la API de Storage. El bucket quedó con 0 objetos.
- **Pendiente:** siguen en staging 1 comprobante, 2 líneas, 2 filas de bitácora, 1 latido (fuente `prueba-cc`) y el
  receptor ficticio. La guardia del repo (`scripts/hooks/guardia.mjs`) frena un `delete` con `commit` por la
  Management API si no hay migración firmada, y no se esquivó. Hace falta el OK del dueño para borrarlas.

## Otro hallazgo de la rama (no lo causó este turno)

El gate de `feat/compras-f1-ingesta` @ `b6558af` falla en la prueba R16 de `supabase/migraciones.test.ts`: 2
migraciones nuevas tienen un número que no es mayor que `ultimo_ledger_prod`. Hay que corregirlo en su PR antes de
mergear.
