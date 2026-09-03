/**
 * Endpoint principal autenticado de la app CSL.
 *
 * Este archivo es un dispatcher delgado: delega la lógica de cada acción al
 * `handleAction` que vive en `_handlers.ts`, y los helpers server-side a
 * `lib/server/`.  Para añadir una acción nueva: editar `_handlers.ts`.
 */

import { NextResponse } from "next/server"
import { handleAction } from "./_handlers"
import { requireAuthenticatedUser } from "@/lib/server/supabase"
import { errorMessage } from "@/lib/server/csl-helpers"
import { esPermisoDenegado } from "@/lib/server/permission-gate"
import type { ActionParams } from "@/lib/server/csl-types"

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

/** IP y navegador, solo para el registro de rechazos de permiso. */
function clientInfo(request: Request) {
  const fwd = request.headers.get("x-forwarded-for") || ""
  return {
    ip: fwd.split(",")[0]?.trim() || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  }
}

async function readParams(request: Request): Promise<ActionParams> {
  if (request.method === "GET") {
    return Object.fromEntries(new URL(request.url).searchParams.entries())
  }
  const body = await request.json().catch(() => ({}))
  return body && typeof body === "object" ? (body as ActionParams) : {}
}

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request)
    const params = await readParams(request)
    return json(await handleAction(params, { id: user.id, email: user.email, ...clientInfo(request) }))
  } catch (error) {
    // Falta de permiso → 403. Antes salía como 500 y era indistinguible de que
    // la app se hubiera caído: ni el usuario sabía qué pedir ni nosotros qué
    // mirar. El mensaje nombra el permiso que falta.
    if (esPermisoDenegado(error)) return json({ ok: false, error: error.message, permiso: error.permiso }, 403)
    const msg = errorMessage(error)
    // Errores de AUTH → 401 (el cliente refresca el token y reintenta), no 500.
    const status = msg === "Sesion invalida" || msg === "No autenticado" ? 401 : 500
    return json({ ok: false, error: msg }, status)
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request)
    const params = await readParams(request)
    return json(await handleAction(params, { id: user.id, email: user.email, ...clientInfo(request) }))
  } catch (error) {
    // Falta de permiso → 403. Antes salía como 500 y era indistinguible de que
    // la app se hubiera caído: ni el usuario sabía qué pedir ni nosotros qué
    // mirar. El mensaje nombra el permiso que falta.
    if (esPermisoDenegado(error)) return json({ ok: false, error: error.message, permiso: error.permiso }, 403)
    const msg = errorMessage(error)
    // Errores de AUTH → 401 (el cliente refresca el token y reintenta), no 500.
    const status = msg === "Sesion invalida" || msg === "No autenticado" ? 401 : 500
    return json({ ok: false, error: msg }, status)
  }
}
