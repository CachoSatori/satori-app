-- ============================================================================
-- 004_customers.sql — Fase 2.1: Base de clientes / CRM
-- ----------------------------------------------------------------------------
-- Dos tablas nuevas. El teléfono es el ID natural (viene de WhatsApp/caja).
-- RLS consistente con el resto del schema (helper get_my_role()).
-- Idempotente: re-ejecutable.
-- ============================================================================

-- ── customers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           text UNIQUE NOT NULL,            -- ID natural
  name            text,
  email           text,
  birth_date      date,
  channel_origin  text DEFAULT 'manual',           -- 'whatsapp' | 'presencial' | 'manual'
  first_seen      timestamptz DEFAULT now(),
  last_seen       timestamptz,
  total_visits    int DEFAULT 0,
  total_spent_crc numeric DEFAULT 0,
  points          int DEFAULT 0,
  tier            text DEFAULT 'nuevo',            -- 'nuevo' | 'regular' | 'vip' | 'embajador'
  wallet_pass_id  text,
  notes           text,
  active          boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_tier  ON public.customers(tier);
CREATE INDEX IF NOT EXISTS idx_customers_name  ON public.customers(lower(name));

-- ── customer_interactions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_interactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  type          text,     -- 'visita' | 'delivery' | 'reserva' | 'puntos_canje' | 'nota'
  channel       text,     -- 'whatsapp' | 'presencial' | 'qr_scan' | 'manual'
  amount_crc    numeric DEFAULT 0,
  points_earned int DEFAULT 0,
  points_spent  int DEFAULT 0,
  reference_id  text,
  notes         text,
  created_by    uuid,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cust_inter_customer ON public.customer_interactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_inter_created  ON public.customer_interactions(created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_interactions ENABLE ROW LEVEL SECURITY;

-- customers: gerencia + caja ven y gestionan; contador lee
DROP POLICY IF EXISTS "crm_ver_clientes" ON public.customers;
CREATE POLICY "crm_ver_clientes" ON public.customers
  FOR SELECT USING (get_my_role() IN ('owner','manager','contador','cajero'));

DROP POLICY IF EXISTS "crm_gestionan_clientes" ON public.customers;
CREATE POLICY "crm_gestionan_clientes" ON public.customers
  FOR ALL USING (get_my_role() IN ('owner','manager','cajero'));

-- interactions: misma lógica
DROP POLICY IF EXISTS "crm_ver_interacciones" ON public.customer_interactions;
CREATE POLICY "crm_ver_interacciones" ON public.customer_interactions
  FOR SELECT USING (get_my_role() IN ('owner','manager','contador','cajero'));

DROP POLICY IF EXISTS "crm_gestionan_interacciones" ON public.customer_interactions;
CREATE POLICY "crm_gestionan_interacciones" ON public.customer_interactions
  FOR ALL USING (get_my_role() IN ('owner','manager','cajero'));

-- ── Trigger: mantener updated_at ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_customers_updated ON public.customers;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
