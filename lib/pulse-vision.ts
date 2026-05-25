/**
 * OCR de la pantalla del equipo láser Candela GentleYAG vía Claude Vision.
 *
 * Reusado por la pantalla "Lecturas semanales" (captura individual) y por el
 * paso 3 del wizard "Cuadre semanal" (captura batch). Centraliza el prompt
 * y el parseo del JSON para que ambos lugares queden alineados.
 *
 * Devuelve `null` cuando la imagen no es legible o la respuesta no parsea.
 * El caller decide cómo mostrar el error (toast / mensaje inline).
 */

export interface PulseScreenReading {
  totalPulses: number | null
  serial: string | null
  lastFaults: string | null
  /** Texto crudo devuelto por Claude — útil para debug. */
  raw: string
}

const SCAN_PROMPT = "Esta es la pantalla de un equipo laser Candela GentleYAG. Extrae SOLO estos datos en formato JSON: {serial, totalPulses, lastFaults}. El campo totalPulses es el numero despues de Total Treatment Pulses=. Responde SOLO con el JSON, sin texto adicional."

const MODEL = "claude-sonnet-4-20250514"

/**
 * Convierte un File a base64 (sin el prefijo `data:`). Helper interno.
 */
function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = String(ev.target?.result || "")
      const [, base64] = dataUrl.split(",")
      if (!base64) {
        reject(new Error("No se pudo codificar la imagen"))
        return
      }
      resolve({ base64, mediaType: file.type || "image/jpeg" })
    }
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"))
    reader.readAsDataURL(file)
  })
}

/**
 * Llama a la API de Anthropic con la imagen + prompt y devuelve la lectura
 * estructurada. Lanza si la red falla; devuelve `totalPulses: null` si la
 * respuesta no se puede parsear.
 */
export async function scanPulseScreen(file: File): Promise<PulseScreenReading> {
  const { base64, mediaType } = await fileToBase64(file)
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: SCAN_PROMPT },
        ],
      }],
    }),
  })
  if (!resp.ok) throw new Error(`Vision API ${resp.status}`)
  const data = await resp.json() as { content?: Array<{ text?: string }> }
  const raw = data.content?.[0]?.text || ""
  const clean = raw.replace(/```json|```/g, "").trim()
  try {
    const parsed = JSON.parse(clean) as { totalPulses?: number | string; serial?: string; lastFaults?: string }
    const totalPulses = parsed.totalPulses !== undefined && parsed.totalPulses !== null
      ? Number(String(parsed.totalPulses).replace(/,/g, ""))
      : null
    return {
      totalPulses: Number.isFinite(totalPulses) && totalPulses !== null ? totalPulses : null,
      serial: parsed.serial ? String(parsed.serial) : null,
      lastFaults: parsed.lastFaults ? String(parsed.lastFaults) : null,
      raw,
    }
  } catch {
    return { totalPulses: null, serial: null, lastFaults: null, raw }
  }
}
