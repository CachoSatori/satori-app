// ── pos-bridge · candado read-only ─────────────────────────────────────────────
// Archivo aparte (sin `mssql`) para que el candado se pueda probar sin driver.

/**
 * Última línea de defensa antes del socket: una sola sentencia, que empiece con
 * SELECT y sin un solo verbo de escritura. Redundante con el hecho de que el SQL lo
 * arma este mismo paquete — a propósito.
 */
export function assertSoloSelect(texto: string): void {
  const s = texto.trim()
  if (!/^select\s/i.test(s)) throw new Error(`SQL rechazado (no empieza con SELECT): ${s.slice(0, 80)}`)
  if (s.replace(/;\s*$/, '').includes(';')) throw new Error('SQL rechazado (más de una sentencia)')
  const prohibido =
    /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|merge|exec|execute|backup|restore|bulk|openrowset|shutdown|waitfor)\b/i
  const hit = prohibido.exec(s)
  if (hit) throw new Error(`SQL rechazado (verbo de escritura "${hit[1]}")`)
}
