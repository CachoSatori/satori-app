# Carga de saldos de las tarjetas de papel

> Decisión de Ismael (08-nov): «Tu saldo de la tarjeta de papel pasa a tu portal». **Nada contra prod:** en prod va con
> el paquete del pase y la firma (reglas de G-56, RUNBOOK §12).

1. **Plantilla:** `scripts/club/plantilla_saldos_papel.csv` (datos ficticios). Columnas: `codigo_anfitrion` (el código de
   8 caracteres de su QR), `personas` (entero 1–600: 6 personas = 1 crédito), `fecha_tarjeta` (AAAA-MM-DD, la última marca),
   `referencia` (el identificador de la tarjeta física, obligatorio).
2. **El archivo con datos reales va fuera del repo.** Validar:
   `python3 scripts/club/migrar_firestore.py saldos-papel --csv <archivo> --local <id> --validar`. Con un solo error se
   rechaza entero (línea y motivo, sin repetir el contenido). Rechaza: código mal formado, personas fuera de rango o no
   entero, fecha futura o mal escrita, referencia vacía, columnas de más o de menos, **filas duplicadas** y **la misma
   tarjeta dos veces** (mismo anfitrión y referencia).
3. **Emitir** (no conecta): `… --emitir <carpeta fuera del repo>` → `carga.sql`, `ensayo.sql` (el mismo, con ROLLBACK) y
   `resumen.json` (filas, anfitriones, personas, créditos y sha256; **sin códigos ni referencias**). Los `.sql` tienen
   datos de anfitriones: 0600, nunca al repo ni por chat; **viaja solo el sha256**.
4. **Reglas de G-56 en el SQL:** una transacción; `lock_timeout` 5 s y `statement_timeout` 5 min primero; precondiciones
   que abortan (el local existe, el entorno es el esperado, **línea de base: ninguna carga de papel previa**, todos los
   códigos son anfitriones activos del local); solo `insert into public.club_movimientos` (tipo `tarjeta`, origen
   `migracion`, nota «saldo tarjeta de papel · <referencia>», fecha de la tarjeta); validación de filas y personas;
   `commit` al final. **Filtro mecánico** al emitir y antes de ejecutar: rechaza `delete`, `truncate`, `drop`, `update`,
   `alter`, `grant`, `revoke` y cualquier sentencia fuera de la lista.
5. **Ensayo en staging** (datos ficticios, termina en ROLLBACK):
   `python3 scripts/club/migrar_firestore.py saldos-papel --ficticios 6 --local <id> --ensayo`. Prod: el script se niega.
6. Pruebas: `python3 -m unittest scripts/club/test_saldos_papel.py` (19).

**DECISIONES PROVISORIAS (para Ismael):** la unidad es **personas** (la del libro), no créditos; el movimiento es una
**tarjeta** con la fecha de la tarjeta, así cuenta como actividad para el vencimiento de 12 meses (como las tarjetas de la
página vieja en la migración F1b). Si el saldo de papel ya está dentro del export de Firestore, no se carga dos veces:
confirmar antes de cargar.
