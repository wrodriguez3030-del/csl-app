/**
 * Rate-limiter en memoria por instancia serverless.
 *
 * Limitaciones (intencionales — son aceptables para los endpoints públicos
 * actuales del CSL):
 *   - El estado vive en memoria del worker; un cold start lo resetea.
 *   - No se sincroniza entre instancias paralelas.
 *
 * Es suficiente para frenar flooding obvio sin agregar dependencias de
 * Redis/Upstash. Cuando el tráfico lo justifique, sustituir por Upstash o
 * por Vercel KV, manteniendo la misma firma `rateLimit({ key, ... })`.
 */

type Bucket = { count: number; resetAt: number }

const BUCKETS = new Map<string, Bucket>()
const MAX_BUCKETS = 5000 // techo defensivo contra crecimiento descontrolado

export type RateLimitResult = {
  ok: boolean
  remaining: number
  retryAfterSeconds: number
  resetAt: number
}

export interface RateLimitOptions {
  /** Identificador estable (ej. `${endpoint}:${ip}`). */
  key: string
  /** Máximo de operaciones permitidas dentro de la ventana. */
  max: number
  /** Ventana en milisegundos. */
  windowMs: number
}

export function rateLimit({ key, max, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  cleanup(now)

  const bucket = BUCKETS.get(key)
  if (!bucket || bucket.resetAt <= now) {
    const fresh: Bucket = { count: 1, resetAt: now + windowMs }
    BUCKETS.set(key, fresh)
    return { ok: true, remaining: max - 1, retryAfterSeconds: 0, resetAt: fresh.resetAt }
  }

  if (bucket.count >= max) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      resetAt: bucket.resetAt,
    }
  }

  bucket.count += 1
  return {
    ok: true,
    remaining: max - bucket.count,
    retryAfterSeconds: 0,
    resetAt: bucket.resetAt,
  }
}

function cleanup(now: number) {
  if (BUCKETS.size < MAX_BUCKETS) return
  for (const [key, bucket] of BUCKETS) {
    if (bucket.resetAt <= now) BUCKETS.delete(key)
  }
  // Si tras limpiar buckets expirados aún supera el techo, vaciar todo
  // (preferimos perder estado a colgar memoria).
  if (BUCKETS.size >= MAX_BUCKETS) BUCKETS.clear()
}

/** Extrae la IP del cliente respetando los headers que pone Vercel. */
export function clientIp(request: Request): string {
  const headers = request.headers
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-forwarded-for"),
    headers.get("x-real-ip"),
  ]
  for (const value of candidates) {
    if (!value) continue
    const first = value.split(",")[0]?.trim()
    if (first) return first
  }
  return "unknown"
}
