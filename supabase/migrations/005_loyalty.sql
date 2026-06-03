-- ============================================================================
-- 005_loyalty.sql — Fase 2.2: Programa de puntos (reglas + catálogo de canje)
-- ----------------------------------------------------------------------------
-- - loyalty_config: fila única con las reglas (jsonb) — editable en el módulo
-- - loyalty_rewards: catálogo de recompensas canjeables por puntos
-- Los canjes se registran como customer_interactions type='puntos_canje'.
-- Idempotente.
-- ============================================================================

-- ── loyalty_config (single row) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loyalty_config (
  id         int PRIMARY KEY DEFAULT 1,
  rules      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT loyalty_config_single CHECK (id = 1)
);

INSERT INTO public.loyalty_config (id, rules)
VALUES (1, '{
  "points_per_1000": 10,
  "bonus_first_visit_month": 50,
  "bonus_birthday": 100,
  "bonus_referral": 100,
  "tier_regular_visits": 3,
  "tier_regular_spent": 25000,
  "tier_vip_visits": 10,
  "tier_vip_spent": 80000
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── loyalty_rewards (catálogo) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loyalty_rewards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  points_cost int NOT NULL DEFAULT 0,
  category    text DEFAULT 'cortesia',   -- 'descuento' | 'cortesia' | 'experiencia'
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rewards_active ON public.loyalty_rewards(active);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.loyalty_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loyalty_cfg_ver" ON public.loyalty_config;
CREATE POLICY "loyalty_cfg_ver" ON public.loyalty_config
  FOR SELECT USING (get_my_role() IN ('owner','manager','contador','cajero'));

DROP POLICY IF EXISTS "loyalty_cfg_editar" ON public.loyalty_config;
CREATE POLICY "loyalty_cfg_editar" ON public.loyalty_config
  FOR ALL USING (get_my_role() IN ('owner','manager'));

DROP POLICY IF EXISTS "loyalty_rew_ver" ON public.loyalty_rewards;
CREATE POLICY "loyalty_rew_ver" ON public.loyalty_rewards
  FOR SELECT USING (get_my_role() IN ('owner','manager','contador','cajero'));

DROP POLICY IF EXISTS "loyalty_rew_gestionar" ON public.loyalty_rewards;
CREATE POLICY "loyalty_rew_gestionar" ON public.loyalty_rewards
  FOR ALL USING (get_my_role() IN ('owner','manager'));

-- semillas opcionales de recompensas
INSERT INTO public.loyalty_rewards (name, description, points_cost, category)
SELECT * FROM (VALUES
  ('Bebida de cortesía', 'Una bebida sin alcohol a elección', 100, 'cortesia'),
  ('Roll gratis',        'Un roll del menú regular',          250, 'cortesia'),
  ('10% de descuento',   'Descuento en la cuenta',            200, 'descuento'),
  ('Postre de la casa',  'Postre a elección',                 150, 'cortesia')
) AS v(name, description, points_cost, category)
WHERE NOT EXISTS (SELECT 1 FROM public.loyalty_rewards);
