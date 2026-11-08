// ── Columnas de employees (SAL-AUD-01, mig 084) ───────────────────────────────────────────

/**
 * Las columnas de `employees` que lee la app. NUNCA `select('*')` sobre employees (test:
 * employees.selectExplicito.test.ts): la planilla (tarifa, salario fijo, datos bancarios) vive en
 * `employee_payroll`, que solo leen owner y contador activos (mig 084, SAL-AUD-01). Esta lista no
 * incluye ninguna columna de planilla; las que quedan en employees por el paso 1 están vacías.
 */
export const EMPLOYEE_COLUMNS =
  'id, full_name, role, profile_id, is_active, pos_name, pos_login, participa_servicio, ' +
  'biotime_emp_code, fecha_ingreso, hora_entrada_habitual, hora_salida_habitual, created_at, updated_at'

/** Las columnas de planilla: van a `employee_payroll`, nunca a `employees`. */
export const PLANILLA_KEYS = ['hourly_rate_crc', 'fixed_salary_crc'] as const
