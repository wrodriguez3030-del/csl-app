-- ============================================================================
-- BI FINANCIERO IA — Caché de análisis del asistente (ahorro de tokens).
--
-- Guarda un fingerprint (data_hash) de los datos + pregunta + modelo + pantalla
-- usados para cada análisis. Si se repite la misma consulta y los datos NO
-- cambiaron, se reutiliza el análisis guardado sin llamar a OpenAI (0 tokens).
-- Aditivo y NO destructivo.
-- ============================================================================
alter table public.bi_finance_ai_queries add column if not exists data_hash text;
create index if not exists bi_fin_queries_hash_idx on public.bi_finance_ai_queries (business_id, data_hash) where ok;
notify pgrst, 'reload schema';
