/**
 * Wrapper cliente del OCR de pantalla del equipo láser Candela GentleYAG.
 *
 * Antes hacía fetch directo a api.anthropic.com — eso NUNCA funcionó desde
 * el navegador porque Anthropic requiere `x-api-key` (no puede salir al
 * cliente) y su CORS bloquea orígenes externos. Ahora todo pasa por nuestro
 * endpoint server-side `/api/pulse/ocr`, que sí tiene la API key.
 *
 * Usado por:
 *   - Cuadre semanal (paso 3, captura batch)
 *   - Lecturas semanales (captura individual)
 */

export interface PulseScreenReading {
  /** true si se obtuvo lectura legible. false con error/reason cuando falla. */
  ok: boolean
  /** Lectura del contador principal del equipo. null si no se pudo leer. */
  totalPulses: number | null
  /** Serial del equipo si la IA lo detectó en la pantalla. */
  serial: string | null
  /** Número/etiqueta del equipo detectado (ej. "10", "06"). */
  equipo: string | null
  /** Número de cabina si visible. */
  cabina: string | null
  /** Confianza de la IA sobre la lectura (0.0-1.0). null si no la reportó. */
  confidence: number | null
  /** Observación humana de la IA — útil cuando confidence es bajo. */
  observation: string | null
  /** Texto crudo que devolvió Claude — útil para debug en la consola. */
  raw: string
  /** Advertencias semánticas: "no_reading", "low_confidence", etc. */
  warnings: string[]
  /** Código de error machine-readable cuando ok=false. */
  error?: string
  /** Texto humano para mostrar en UI cuando ok=false. */
  reason?: string
}

const SUPPORTED_EXT_RE = /\.(jpe?g|png|webp)$/i
const SUPPORTED_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"])
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function makeFailure(error: string, reason: string): PulseScreenReading {
  return {
    ok: false,
    totalPulses: null,
    serial: null,
    equipo: null,
    cabina: null,
    confidence: null,
    observation: null,
    raw: "",
    warnings: [],
    error,
    reason,
  }
}

/**
 * Sube la imagen al endpoint `/api/pulse/ocr` y devuelve la lectura
 * estructurada. No lanza — todo error se devuelve como `ok:false` con un
 * `reason` legible que el caller puede mostrar directamente al usuario.
 */
export async function scanPulseScreen(file: File): Promise<PulseScreenReading> {
  // Validación temprana en cliente: nos ahorra una vuelta al server y
  // permite mostrar el error inmediato.
  const declaredType = (file.type || "").toLowerCase()
  const hasValidExt = SUPPORTED_EXT_RE.test(file.name)
  if (declaredType && !SUPPORTED_MIMES.has(declaredType) && !hasValidExt) {
    return makeFailure(
      "format_unsupported",
      `Formato no soportado: ${declaredType || file.name}. Usa jpg, png o webp.`,
    )
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return makeFailure(
      "too_large",
      `La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)} MB (máx 8 MB).`,
    )
  }

  const form = new FormData()
  form.append("image", file)

  let resp: Response
  try {
    resp = await fetch("/api/pulse/ocr", { method: "POST", body: form })
  } catch (err) {
    return makeFailure(
      "network",
      err instanceof Error ? err.message : "Sin conexión al servidor.",
    )
  }

  let payload: Record<string, unknown> | null = null
  try {
    payload = await resp.json()
  } catch {
    return makeFailure(
      "vision_parse",
      `El servidor devolvió una respuesta no válida (HTTP ${resp.status}).`,
    )
  }

  // Forma común tanto para éxito como para error — el endpoint siempre
  // devuelve el mismo shape, sólo cambia `ok` y los campos auxiliares.
  const ok = Boolean(payload?.ok)
  const totalPulses = typeof payload?.totalPulses === "number" ? payload.totalPulses : null
  const reading: PulseScreenReading = {
    ok,
    totalPulses,
    serial: typeof payload?.serial === "string" ? payload.serial : null,
    equipo: typeof payload?.equipo === "string" ? payload.equipo : null,
    cabina: typeof payload?.cabina === "string" ? payload.cabina : null,
    confidence: typeof payload?.confidence === "number" ? payload.confidence : null,
    observation: typeof payload?.observation === "string" ? payload.observation : null,
    raw: typeof payload?.rawText === "string" ? payload.rawText : "",
    warnings: Array.isArray(payload?.warnings) ? payload.warnings.filter((w): w is string => typeof w === "string") : [],
    error: typeof payload?.error === "string" ? payload.error : undefined,
    reason: typeof payload?.reason === "string" ? payload.reason : undefined,
  }
  return reading
}
