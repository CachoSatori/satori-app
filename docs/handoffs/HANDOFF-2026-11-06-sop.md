# HANDOFF · 2026-11-06 · SoP noviembre 2026 (módulo SoP en prod)

> Complementa a [HANDOFF-2026-11-06.md](HANDOFF-2026-11-06.md), que sigue siendo el punto de arranque general.
> Este cubre solo la sesión de los SoP. Estado vivo y reglas → [ESTADO.md](../../ESTADO.md).

## 1. Foto al cierre (06/11, ~14:10 CR)

| Cosa | Estado |
|---|---|
| `main` | `e7de76e` (merge del #49). Deploy de Pages run 274 OK (19:55 UTC). |
| `staging` | `4793cf3`: merge de `main`, sin conflictos. Ya no le falta nada de `main`. |
| Ledger de prod | 53 filas, hasta la **077**. La 076 y la 077 se aplicaron a mano el 06/11 entre 18:03:48 y 18:05:14 UTC. |
| Ledger de staging | 77 filas: además la 075 (Club Satori) y la 078 (Prom/PAX). **Próximo libre: 079.** |
| Branching (solo prod, mira `main`) | «All migrations are up to date» en los push del #52 y del #49. Staging no tiene Branching. |
| `public.sops` en prod | 27 activas con código + 20 viejas inactivas (nada borrado). |
| Storage de prod | 29 objetos bajo `documents/sops/`: 27 PDF en `sops/2026-11/<código>.pdf` + 2 libros. |

## 2. Qué se hizo

- **Paquete de SoP de noviembre 2026:** 27 documentos en 5 áreas (Cultura y servicio, Salón y recepción, Menú y producto, Administración y caja, Equipo). La fuente es el paquete del dueño en Drive (`paquete app SoP`): `indice.json` + un markdown por documento + los PDF.
- **Migraciones:**
  - **076** (`sops_code_area`): columnas opcionales `code` (único si no es null), `area`, `doc_type`, `version`, `employee_book` y `pdf_path`;
  - **077** (`sops_pdf_storage`): lectura de `documents/sops/*` para `authenticated` y una policy restrictiva que deja el libro de franquicia solo a owner y manager.
- **Script `scripts/sync_sops`:**
  - `sync.ts` hace upsert por `code` en una transacción, respalda antes, desactiva las filas viejas (no borra) y aborta si encuentra correos, teléfonos, cédulas o contraseñas;
  - `subir_pdfs.ts` sube los PDF y los libros con la llave `service_role` del entorno y guarda `pdf_path`.
  - Los dos son un ensayo por defecto, y prod exige `--confirmo-prod`.
- **App (módulo SoP):**
  - lista por área, ordenada por código (2.9 < 2.10), con el código visible y buscable y el resumen del objetivo;
  - lector con el Estándar SOP: Cormorant Garamond y DM Sans, oro solo en líneas, laca solo en alertas, títulos en minúscula y tablas con filete de oro;
  - impresión A4 con página nombrada (`sop-a4`), que no toca otras impresiones;
  - «Ver PDF» con URL firmada de 10 minutos; en los documentos tipo «Documento» (menú, platos, plano…) es la acción principal;
  - sección «Libros».
- **PR:** #45 y #47 (staging) · #50 (fix `@page` a staging) · #52 (`.sql` 076/077 a `main`) · #49 (SoP a `main`).

## 3. Verificaciones en prod (solo lectura)

- `.sql` de la 076 y la 077 = statements del ledger de prod y de staging, byte a byte (md5 `fc26bfea…`, `ef17f371…`).
- Sync: 27 activas con código, 0 viejas activas, 20 inactivas con su contenido intacto (hash igual al respaldo), todas con `area`.
- PDF: 29 objetos, `pdf_path` en los 27, sin rutas huérfanas.
- Libros por rol, con usuarios reales: owner y manager leen el de franquicia; cajero, contador y salonero no. Los cinco leen el del empleado y los 27 PDF. Lo que ya veían del bucket `documents` no cambió.

## 4. Pendientes

1. **🔐 Mig 079:** `sops_read` (010, `USING (true)`) y `sops_storage_read` (077) no miran `is_active`. Un usuario inactivo con sesión vigente lee todas las filas de `sops` y los PDF de `sops/*`, salvo el libro de franquicia. Corregir **las dos juntas** con `public.get_my_role() is not null`.
2. **Rollbacks de la 076 y la 077:** si se corre alguno, quitar también su `.sql` de `main` en el mismo momento. Detalle en ESTADO § Migraciones.
3. **Contradicciones de reglas** entre los SoP viejos y los nuevos (para el dueño, no bloquean):
   - «¿tienen reserva?»;
   - acompañar «un paso delante» o «al ritmo del cliente»;
   - tiempos del saludo;
   - responsable del inventario de bebidas;
   - cortesía «+ manager».
4. **Filas viejas inactivas:** quedan en la tabla con su texto original (algunas tienen datos de contacto de la empresa). Se limpian cuando el dueño lo decida; el original está en los respaldos de Drive.
5. **`version.json` de prod:** esta sesión no puede abrir `cachosatori.github.io` (red del entorno). El deploy se verificó por el run de Actions; el dueño confirma `commit = e7de76e` en `https://cachosatori.github.io/satori-app/version.json`.
