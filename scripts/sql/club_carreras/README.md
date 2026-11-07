# Carreras de dos sesiones del Club (CLUB-AUD-03, 04, 07, 08 y 15)

Son el script que pidió la revisión del 07-nov: «versionar el script de dos sesiones». **Solo staging.**

```bash
CAJERO_UUID=<perfil cajero activo> OWNER_UUID=<perfil owner activo> scripts/sql/club_carreras/correr.sh
```

| Carrera | Sesión 1 | Sesión 2 (arranca 1,5 s después) | Esperado |
|---|---|---|---|
| 03 vencer contra canje | canje de 1 crédito y espera 4 s | `club_vencer` con el total de la simulación, **ROLLBACK** | no vence lo que acaba de tener actividad; saldo 12 − 6 = **6**, nunca −6 |
| 07 baja contra cupón | baja del referente y espera 4 s | usa un cupón de ese referente | la caja ve `REFERENTE_INACTIVO`; saldo 0 |
| 08 mismo `p_op` | canje con un `p_op` fijo y espera 3 s | el mismo canje con el mismo `p_op` | replay: mismo resultado y **1** canje |
| 16 mismo código de canje (R-01) | canje de 1 con el código y espera 3 s | otro canje (otro `p_op`) con el mismo código | espera a s1 y falla «ya se usó»; **1** canje |
| 15 misma visita, otro camino | referente A, 3 personas, por la factura del plan B | referente B, 2 personas, con la factura tipeada | misma clave de visita: espera a A y rechaza (3 + 2 > 4 pax) |
| 04 cierre concurrente | cierra un mes y espera 4 s, **ROLLBACK** | cierra el mismo mes, **ROLLBACK** | s2 espera a que termine s1 |

- **Datos sintéticos:** «Carrera …», la factura `990951` y el pedido `9501`. Se borran al final, aunque algo falle.
- **Sesiones en ROLLBACK:** `club_vencer` vence **todas** las cuentas candidatas del local, y los cierres son inmutables, así que esas sesiones terminan siempre en ROLLBACK.
