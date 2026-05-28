/**
 * OCR de pantalla del equipo láser Candela GentleYAG vía OpenAI GPT-4o
 * vision — proxy server-side. El frontend NO debe llamar a api.openai.com
 * directamente porque la API exige Authorization Bearer (no puede salir
 * al navegador) y su CORS bloquea orígenes externos.
 *
 * Acepta `multipart/form-data` con un campo `image`. Devuelve JSON
 * estructurado:
 *
 *   { ok: true, totalPulses, serial, equipo, cabina, confidence,
 *     observation, rawText, warnings: [] }
 *
 *   { ok: false, error: "<code>", reason: "<texto humano>", ... }
 *
 * Códigos de error frontend-friendly:
 *   no_api_key     — falta OPENAI_API_KEY en el server
 *   no_image       — request sin archivo
 *   too_large      — > 8 MB
 *   format_unsupported — no es jpg/png/webp
 *   vision_network — fetch a OpenAI falló
 *   vision_http    — OpenAI devolvió status ≥ 400
 *   vision_parse   — OpenAI no devolvió JSON
 *   json_parse     — el modelo no devolvió JSON parseable
 *   no_reading     — la IA respondió pero sin lectura legible
 */

import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 60

const MODEL = "gpt-4o"
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const SUPPORTED_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"])

const SCAN_PROMPT = `Esta imagen es la pantalla de un equipo láser Candela GentleYAG / GentleMax Pro / similar.
Analiza la imagen y devuelve EXCLUSIVAMENTE un JSON con esta estructura exacta:

{
  "totalPulses": <número entero o null>,
  "serial": <string o null>,
  "equipo": <string o null>,
  "cabina": <string o null>,
  "confidence": <número 0.0-1.0>,
  "observation": <string corto>
}

Reglas para extraer cada campo:
- "totalPulses": el número grande que aparece tras "Total Treatment Pulses=" o el contador principal. Si la pantalla muestra el número con comas (ej. "8,525,419"), devuélvelo SIN comas como integer. Si no es legible, null.
- "serial": el serial del equipo si aparece en la pantalla o en una etiqueta visible. Null si no.
- "equipo": número o etiqueta del equipo visible (puede ser "10", "06", "01", o pegatina física). Null si no es visible.
- "cabina": número de cabina si está rotulado en la pantalla o foto.
- "confidence": qué tan seguro estás de la lectura de totalPulses (0.0 = adivinanza, 1.0 = perfectamente legible).
- "observation": una frase corta. Si confidence < 0.7, explica por qué (borrosa, reflejo, parcial, etc.). Si no es la pantalla de un equipo láser, dilo aquí.

Si la imagen no es legible o no es de un equipo láser, devuelve totalPulses: null y observation describiendo el problema.`

interface ScanResponse {
  ok: boolean
  totalPulses?: number | null
  serial?: string | null
  equipo?: string | null
  cabina?: string | null
  confidence?: number | null
  observation?: string | null
  rawText?: string
  warnings?: string[]
  error?: string
  reason?: string
}

function errorResponse(error: string, reason: string, status = 400, extra: Partial<ScanResponse> = {}): NextResponse {
  return NextResponse.json<ScanResponse>(
    { ok: false, error, reason, totalPulses: null, ...extra },
    { status },
  )
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return errorResponse(
      "no_api_key",
      "OPENAI_API_KEY no configurada en el servidor. El administrador debe agregarla en Vercel (Settings → Environment Variables).",
      500,
    )
  }

  let buffer: Buffer
  let mediaType: string
  try {
    const form = await req.formData()
    const file = form.get("image")
    if (!(file instanceof File)) {
      return errorResponse("no_image", "Falta el archivo 'image' en el form-data.")
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return errorResponse("too_large", `Imagen excede ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`)
    }
    // Detectar mediaType. WhatsApp/Android a veces envía type vacío en el File.
    const declared = (file.type || "").toLowerCase()
    if (declared && !SUPPORTED_MIMES.has(declared)) {
      return errorResponse(
        "format_unsupported",
        `Formato no soportado: ${declared || "(sin tipo)"}. Usa jpg, png o webp.`,
      )
    }
    // Fallback por extensión cuando el MIME viene vacío.
    if (!declared) {
      const name = file.name.toLowerCase()
      if (name.endsWith(".png")) mediaType = "image/png"
      else if (name.endsWith(".webp")) mediaType = "image/webp"
      else mediaType = "image/jpeg"
    } else {
      mediaType = declared === "image/jpg" ? "image/jpeg" : declared
    }
    buffer = Buffer.from(await file.arrayBuffer())
  } catch (err) {
    return errorResponse(
      "bad_request",
      err instanceof Error ? err.message : String(err),
      400,
    )
  }

  // OpenAI vision recibe la imagen como data URL en el `image_url.url`.
  const dataUrl = `data:${mediaType};base64,${buffer.toString("base64")}`

  let visionResp: Response
  try {
    visionResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        // response_format json_object fuerza al modelo a devolver JSON
        // sintácticamente válido — mucho más robusto que pedirle "devuelve solo JSON".
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: SCAN_PROMPT },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
      }),
    })
  } catch (err) {
    return errorResponse(
      "vision_network",
      err instanceof Error ? err.message : "Falla de red al contactar OpenAI.",
      502,
    )
  }

  if (!visionResp.ok) {
    const errText = await visionResp.text().catch(() => "")
    // OpenAI devuelve detalle del error en el body — extraemos message si es JSON.
    let humanReason = `OpenAI respondió ${visionResp.status}.`
    try {
      const parsedErr = JSON.parse(errText) as { error?: { message?: string; type?: string; code?: string } }
      if (parsedErr.error?.message) humanReason += ` ${parsedErr.error.message}`
    } catch {
      if (errText) humanReason += ` ${errText.slice(0, 200)}`
    }
    return errorResponse("vision_http", humanReason, 502)
  }

  let data: { choices?: Array<{ message?: { content?: string } }> }
  try {
    data = await visionResp.json()
  } catch {
    return errorResponse("vision_parse", "La respuesta de OpenAI no es JSON.", 502)
  }
  const rawText = data.choices?.[0]?.message?.content || ""
  // response_format:json_object devuelve JSON puro, pero por si acaso
  // limpiamos backticks si el modelo los agregó.
  const clean = rawText.replace(/```json\s*|```/gi, "").trim()

  let parsed: {
    totalPulses?: number | string | null
    serial?: string | null
    equipo?: string | null
    cabina?: string | null
    confidence?: number
    observation?: string
  }
  try {
    parsed = JSON.parse(clean)
  } catch {
    return NextResponse.json<ScanResponse>({
      ok: false,
      error: "json_parse",
      reason: "La IA no devolvió JSON parseable. Reintenta o ingresa la lectura manualmente.",
      totalPulses: null, serial: null, equipo: null, cabina: null,
      confidence: 0, rawText, warnings: ["no_json"],
    })
  }

  // Normalizamos totalPulses: la IA puede devolver "8,525,419" o "8525419".
  let totalPulses: number | null = null
  if (parsed.totalPulses !== null && parsed.totalPulses !== undefined) {
    const num = Number(String(parsed.totalPulses).replace(/[,\s]/g, ""))
    if (Number.isFinite(num) && num > 0) totalPulses = Math.round(num)
  }

  const confidence = typeof parsed.confidence === "number"
    ? Math.max(0, Math.min(1, parsed.confidence))
    : null

  const warnings: string[] = []
  if (totalPulses === null) warnings.push("no_reading")
  if (confidence !== null && confidence < 0.6) warnings.push("low_confidence")

  // Si no hay lectura → ok:false pero con datos parciales (la IA puede haber
  // detectado serial/equipo). El frontend decide cómo presentarlo.
  if (totalPulses === null) {
    return NextResponse.json<ScanResponse>({
      ok: false,
      error: "no_reading",
      reason: parsed.observation || "La IA no pudo detectar la lectura final en la imagen.",
      totalPulses: null,
      serial: parsed.serial || null,
      equipo: parsed.equipo || null,
      cabina: parsed.cabina || null,
      confidence,
      observation: parsed.observation || null,
      rawText,
      warnings,
    })
  }

  return NextResponse.json<ScanResponse>({
    ok: true,
    totalPulses,
    serial: parsed.serial || null,
    equipo: parsed.equipo || null,
    cabina: parsed.cabina || null,
    confidence,
    observation: parsed.observation || null,
    rawText,
    warnings,
  })
}
