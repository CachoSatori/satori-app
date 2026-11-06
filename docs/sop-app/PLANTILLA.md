---
codigo: "6.X"
titulo: "Nombre del módulo"
tipo: "SOP"
area: "6. App Satori"
modulo: "Nombre en la app (tarjeta de Inicio)"
ruta: "/ruta"
roles: ["owner", "manager"]        # roles que ven el módulo
version: "AAAA-MM"
verificado_en_commit: "abc1234"    # commit de main contra el que se verificó la guía
libro_empleado: true               # si va en el libro del empleado
estado: "borrador, validar en el local"
---

# SOP 6.X — Nombre del módulo

> **Borrador, validar en el local.** Escrito a partir del código de `main` en el commit de
> `verificado_en_commit`. Antes de publicarlo, alguien lo recorre en la app real y corrige lo que no coincida.

## Ficha franquicia

**Objetivo:** una frase: para qué sirve el módulo y qué resultado deja.

**Responsable:** rol que responde por que se use bien.

**Alcance:** quién lo usa, cuándo (turno, día, quincena) y qué queda fuera.

### Responsabilidades por rol

| Rol | Qué puede hacer | Qué no puede |
|---|---|---|
| owner | … | … |
| manager | … | … |

> «Qué puede» y «qué no» describen **solo el comportamiento esperado**: lo que la pantalla permite a cada
> rol (tarjetas, pestañas, botones, contraseña de gerencia). Nada de detalles internos de la base ni de
> diferencias de permisos: esas se documentan fuera del repo.

### Controles del manager

- Qué revisa el manager, cuándo y contra qué.

### Indicadores

| Indicador | Cómo se mide | Meta |
|---|---|---|
| … | … | … |

## Antes de empezar

- Rol y sesión necesarios.
- Lo que tiene que existir antes (turno abierto, tipo de cambio cargado…).
- Dispositivo recomendado (celular, tablet, compu).

## Paso a paso

Una sección por tarea. Nombres de pantallas, pestañas y botones **exactos**, entre «comillas», tal como
aparecen en la app.

### Tarea 1 — Nombre de la tarea

1. En «Inicio», toca la tarjeta «…».
2. Toca «…».
3. …

> Resultado esperado: qué se ve cuando salió bien.

## Reglas del sistema

- Validaciones, redondeos, tolerancias, montos fijos, cálculos y bloqueos que aplica la app.
- Qué pasa sin conexión (offline), si aplica.
- Qué queda registrado y quién puede deshacerlo.

## Errores comunes

| Lo que ves | Por qué pasa | Qué hacer |
|---|---|---|
| Mensaje exacto de la app | Causa | Acción |

---

**Datos de ejemplo:** siempre ficticios (personas «Ana», «Luis»; montos redondos como ₡10.000).
Nunca nombres reales de personas, clientes o proveedores, teléfonos, correos, cédulas, contraseñas
ni montos reales: el repo es público.
