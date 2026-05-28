-- ============================================================
-- Satori App — Schema inicial
-- Módulo 1: Supabase + Auth + Roles + Tablas base
-- Mayo 2026
-- ============================================================

-- ── TIPOS ────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM (
  'owner',
  'contador',
  'manager',
  'cajero',
  'salonero',
  'barman',
  'barback',
  'runner',
  'cocina'
);

CREATE TYPE currency_type AS ENUM ('CRC', 'USD');

CREATE TYPE movement_type AS ENUM (
  'ingreso',
  'egreso_mercaderia',
  'egreso_personal',
  'egreso_operativo',
  'egreso_socios',
  'traspaso'
);

CREATE TYPE session_status AS ENUM ('open', 'closed');
CREATE TYPE movement_status AS ENUM ('pendiente', 'aprobado', 'rechazado');

-- ── FUNCIÓN UPDATED_AT ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── PROFILES ─────────────────────────────────────────────────
-- Vinculado 1:1 con auth.users. Se crea automáticamente al registrar usuario.

CREATE TABLE public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT        NOT NULL,
  role       user_role   NOT NULL DEFAULT 'salonero',
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Trigger: crear profile automáticamente al registrar usuario en auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'salonero')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── FUNCIÓN HELPER DE ROL ────────────────────────────────────
-- SECURITY DEFINER: bypasses RLS para evitar recursión en policies.
-- Los policies de profiles NO la usan — usan auth.uid() directamente.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- RLS profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Usuarios ven y editan su propio perfil
CREATE POLICY "perfil_propio_select" ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "perfil_propio_update" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

-- Owner ve y edita todos los perfiles
CREATE POLICY "owner_select_all_profiles" ON public.profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'owner')
  );

CREATE POLICY "owner_update_all_profiles" ON public.profiles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'owner')
  );

-- ── EMPLOYEES ────────────────────────────────────────────────
-- Pueden existir sin cuenta de usuario (ej: empleados sin app)

CREATE TABLE public.employees (
  id         UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  TEXT      NOT NULL,
  role       user_role NOT NULL,
  profile_id UUID      REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active  BOOLEAN   NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_employees_role     ON public.employees(role);
CREATE INDEX idx_employees_active   ON public.employees(is_active);
CREATE INDEX idx_employees_profile  ON public.employees(profile_id);

CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "todos_ven_empleados_activos" ON public.employees
  FOR SELECT USING (
    is_active = true
    OR get_my_role() IN ('owner', 'manager', 'contador')
  );

CREATE POLICY "owner_manager_gestionan_empleados" ON public.employees
  FOR ALL USING (get_my_role() IN ('owner', 'manager'));

-- ── ROLE TIP POINTS ──────────────────────────────────────────

CREATE TABLE public.role_tip_points (
  role   user_role PRIMARY KEY,
  points INTEGER   NOT NULL DEFAULT 0
);

ALTER TABLE public.role_tip_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "todos_ven_puntos_rol" ON public.role_tip_points
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "owner_edita_puntos_rol" ON public.role_tip_points
  FOR ALL USING (get_my_role() = 'owner');

-- ── TIP SESSIONS ─────────────────────────────────────────────

CREATE TABLE public.tip_sessions (
  id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date  DATE           NOT NULL,
  opened_by     UUID           NOT NULL REFERENCES public.profiles(id),
  closed_by     UUID           REFERENCES public.profiles(id),
  status        session_status NOT NULL DEFAULT 'open',
  exchange_rate NUMERIC(10,2)  NOT NULL DEFAULT 520,
  notes         TEXT,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_tip_sessions_date   ON public.tip_sessions(session_date DESC);
CREATE INDEX idx_tip_sessions_status ON public.tip_sessions(status);

CREATE TRIGGER tip_sessions_updated_at
  BEFORE UPDATE ON public.tip_sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.tip_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gerencia_ve_sesiones_propinas" ON public.tip_sessions
  FOR SELECT USING (get_my_role() IN ('owner', 'manager', 'contador'));

CREATE POLICY "empleados_ven_sesion_abierta" ON public.tip_sessions
  FOR SELECT USING (status = 'open');

CREATE POLICY "owner_manager_gestionan_sesiones_propinas" ON public.tip_sessions
  FOR ALL USING (get_my_role() IN ('owner', 'manager'));

-- ── TIP ENTRIES ──────────────────────────────────────────────

CREATE TABLE public.tip_entries (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID          NOT NULL REFERENCES public.tip_sessions(id) ON DELETE CASCADE,
  employee_id    UUID          NOT NULL REFERENCES public.employees(id),
  hours_worked   NUMERIC(4,1)  NOT NULL DEFAULT 0,
  tip_amount_crc NUMERIC(12,0) NOT NULL DEFAULT 0,
  tip_amount_usd NUMERIC(8,2)  NOT NULL DEFAULT 0,
  points         NUMERIC(8,2),
  payout_crc     NUMERIC(12,0),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(session_id, employee_id)
);

CREATE INDEX idx_tip_entries_session  ON public.tip_entries(session_id);
CREATE INDEX idx_tip_entries_employee ON public.tip_entries(employee_id);

CREATE TRIGGER tip_entries_updated_at
  BEFORE UPDATE ON public.tip_entries
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.tip_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gerencia_ve_entradas_propinas" ON public.tip_entries
  FOR SELECT USING (get_my_role() IN ('owner', 'manager', 'contador'));

CREATE POLICY "empleado_ve_sus_entradas" ON public.tip_entries
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM public.employees WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "owner_manager_gestionan_entradas" ON public.tip_entries
  FOR ALL USING (get_my_role() IN ('owner', 'manager'));

-- ── SUPPLIERS ────────────────────────────────────────────────

CREATE TABLE public.suppliers (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT    NOT NULL,
  category     TEXT,
  contact      TEXT,
  payment_iban TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_suppliers_active ON public.suppliers(is_active);

CREATE TRIGGER suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gerencia_ve_proveedores" ON public.suppliers
  FOR SELECT USING (get_my_role() IN ('owner', 'manager', 'contador'));

CREATE POLICY "owner_manager_gestionan_proveedores" ON public.suppliers
  FOR ALL USING (get_my_role() IN ('owner', 'manager'));

-- ── CASH SESSIONS ────────────────────────────────────────────

CREATE TABLE public.cash_sessions (
  id                   UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date         DATE           NOT NULL,
  opened_by            UUID           NOT NULL REFERENCES public.profiles(id),
  closed_by            UUID           REFERENCES public.profiles(id),
  status               session_status NOT NULL DEFAULT 'open',
  initial_service_crc  NUMERIC(12,0)  NOT NULL DEFAULT 0,
  initial_suppliers_crc NUMERIC(12,0) NOT NULL DEFAULT 0,
  final_service_crc    NUMERIC(12,0),
  final_suppliers_crc  NUMERIC(12,0),
  final_safe_crc       NUMERIC(12,0),
  final_bank_crc       NUMERIC(12,0),
  notes                TEXT,
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_cash_sessions_date   ON public.cash_sessions(session_date DESC);
CREATE INDEX idx_cash_sessions_status ON public.cash_sessions(status);

CREATE TRIGGER cash_sessions_updated_at
  BEFORE UPDATE ON public.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caja_select" ON public.cash_sessions
  FOR SELECT USING (get_my_role() IN ('owner', 'manager', 'contador', 'cajero'));

CREATE POLICY "caja_insert_update" ON public.cash_sessions
  FOR ALL USING (get_my_role() IN ('owner', 'manager', 'cajero'));

-- ── CASH MOVEMENTS ───────────────────────────────────────────

CREATE TABLE public.cash_movements (
  id            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID            NOT NULL REFERENCES public.cash_sessions(id) ON DELETE CASCADE,
  created_by    UUID            NOT NULL REFERENCES public.profiles(id),
  movement_type movement_type   NOT NULL,
  amount_crc    NUMERIC(12,0)   NOT NULL,
  currency      currency_type   NOT NULL DEFAULT 'CRC',
  exchange_rate NUMERIC(10,2),
  description   TEXT            NOT NULL,
  supplier_id   UUID            REFERENCES public.suppliers(id),
  status        movement_status NOT NULL DEFAULT 'pendiente',
  approved_by   UUID            REFERENCES public.profiles(id),
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_cash_movements_session ON public.cash_movements(session_id);
CREATE INDEX idx_cash_movements_status  ON public.cash_movements(status);

CREATE TRIGGER cash_movements_updated_at
  BEFORE UPDATE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caja_movimientos_select" ON public.cash_movements
  FOR SELECT USING (
    get_my_role() IN ('owner', 'manager', 'contador')
    OR created_by = auth.uid()
  );

CREATE POLICY "caja_movimientos_insert_update" ON public.cash_movements
  FOR ALL USING (get_my_role() IN ('owner', 'manager', 'cajero'));

-- ── EXCHANGE RATES ───────────────────────────────────────────

CREATE TABLE public.exchange_rates (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date  DATE    NOT NULL,
  usd_to_crc NUMERIC(10,2) NOT NULL,
  source     TEXT    NOT NULL DEFAULT 'manual',
  created_by UUID    REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exchange_rates_date ON public.exchange_rates(rate_date DESC);

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "todos_ven_tipos_cambio" ON public.exchange_rates
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "gerencia_registra_tipos_cambio" ON public.exchange_rates
  FOR INSERT WITH CHECK (get_my_role() IN ('owner', 'manager'));
