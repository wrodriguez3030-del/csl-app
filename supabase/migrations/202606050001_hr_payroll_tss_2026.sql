-- ─────────────────────────────────────────────────────────────────────────
-- RR.HH. · Nómina · Tasas TSS/ISR RD 2026 VERIFICADAS.
--
-- 1. Agrega columnas para tasas PATRONALES (empleador) y tope SRL, que no
--    existían en 202606020007_hr_payroll.sql.
-- 2. Fija los valores base verificados RD 2026 para TODOS los tenants y marca
--    verificado = true (quita el banner "Tasas sin verificar").
--
-- Idempotente y NO destructivo (ADD COLUMN IF NOT EXISTS + UPDATE).
-- Multi-tenant: una fila por business; cada tenant queda editable e
-- independiente desde el botón Configuración.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE hr_payroll_config ADD COLUMN IF NOT EXISTS srl_cap               numeric(12,2) NOT NULL DEFAULT 92892.00;  -- tope SRL (riesgos laborales)
ALTER TABLE hr_payroll_config ADD COLUMN IF NOT EXISTS afp_employer_rate     numeric(6,5)  NOT NULL DEFAULT 0.07100;   -- AFP patronal
ALTER TABLE hr_payroll_config ADD COLUMN IF NOT EXISTS sfs_employer_rate     numeric(6,5)  NOT NULL DEFAULT 0.07090;   -- SFS patronal
ALTER TABLE hr_payroll_config ADD COLUMN IF NOT EXISTS srl_employer_rate     numeric(6,5)  NOT NULL DEFAULT 0.01100;   -- SRL patronal
ALTER TABLE hr_payroll_config ADD COLUMN IF NOT EXISTS infotep_employer_rate numeric(6,5)  NOT NULL DEFAULT 0.01000;   -- INFOTEP patronal

-- Garantiza una fila de config por business (no pisa si ya existe).
INSERT INTO hr_payroll_config (business_id)
SELECT id FROM businesses
ON CONFLICT (business_id) DO NOTHING;

-- Valores base VERIFICADOS RD 2026 (empleado + topes TSS + tasas patronales +
-- escala ISR DGII) para todos los tenants. Las tasas nacionales RD son iguales
-- para CSL y Depicenter; cada quien puede editarlas luego en Configuración.
UPDATE hr_payroll_config SET
  daily_base            = 23.83,
  afp_rate              = 0.0287,
  sfs_rate              = 0.0304,
  afp_cap               = 464460.00,
  sfs_cap               = 232230.00,
  srl_cap               = 92892.00,
  afp_employer_rate     = 0.0710,
  sfs_employer_rate     = 0.0709,
  srl_employer_rate     = 0.0110,
  infotep_employer_rate = 0.0100,
  isr_brackets = '[
    {"li":0,"ls":416220.00,"tasa":0,"cuota":0},
    {"li":416220.01,"ls":624329.00,"tasa":0.15,"cuota":0},
    {"li":624329.01,"ls":867123.00,"tasa":0.20,"cuota":31216.00},
    {"li":867123.01,"ls":null,"tasa":0.25,"cuota":79776.00}
  ]'::jsonb,
  verificado = true,
  updated_at = now();
