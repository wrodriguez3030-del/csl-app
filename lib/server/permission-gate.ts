/**
 * LA PUERTA. Cierre por defecto para todo lo que escribe o lee la app.
 *
 * Una sola comprobación, en un solo sitio: el despachador de `/api/csl` y, con
 * `enforceRoutePermission`, las rutas que viven fuera de él. La acción que no
 * declare permiso en `lib/permissions/action-map.ts` no pasa — y como
 * `pnpm test:permisos` compara el mapa contra los `case` del despachador,
 * olvidarse de declarar una acción rompe la construcción, no el trabajo de
 * alguien.
 *
 * DOS TIEMPOS (`PERMISOS_ESTRICTOS`):
 *   · sin definir / "off"  → MODO SOMBRA: no bloquea nada, anota lo que
 *     habría bloqueado en `csl_permission_denials`. Sirve para ver, con la
 *     gente trabajando de verdad, qué falta en el mapa antes de cerrar.
 *   · "on"                 → ESTRICTO: rechaza con 403 y lo anota igual.
 *
 * El interruptor permite volver atrás en segundos sin desplegar código.
 */
import { getBusinessContext, hasPermission } from "./business-context"
import { CAJA_FUERTE } from "@/lib/permissions/catalog"
import { getSupabaseAdmin } from "./supabase"
import {
  ACTION_PERMISSIONS,
  ENTITY_PERMISSIONS,
  ROUTE_PERMISSIONS,
  PUBLICO,
  POR_ENTIDAD,
  type PermisoRequerido,
} from "@/lib/permissions/action-map"
import { PERMISSION_OPTIONS } from "@/lib/permissions/catalog"
import type { ActionUser, BusinessContext } from "./csl-types"

/** Error de permiso. `route.ts` lo distingue para responder 403 y no 500. */
export class PermisoDenegado extends Error {
  readonly permiso: string
  readonly accion: string
  constructor(accion: string, permiso: string, etiqueta: string) {
    super(`No tienes permiso para ${etiqueta} (${permiso}). Pídeselo al administrador.`)
    this.name = "PermisoDenegado"
    this.accion = accion
    this.permiso = permiso
  }
}

export function esPermisoDenegado(error: unknown): error is PermisoDenegado {
  return error instanceof Error && error.name === "PermisoDenegado"
}

/** ¿Estamos cerrando de verdad, o solo mirando? */
export function modoEstricto(): boolean {
  return String(process.env.PERMISOS_ESTRICTOS || "").trim().toLowerCase() === "on"
}

const ETIQUETAS = new Map(PERMISSION_OPTIONS.map((p) => [p.id, p.label.replace(/^🔒\s*/, "").toLowerCase()]))
const etiquetaDe = (perm: PermisoRequerido): string => {
  const ids = comoLista(perm)
  return ids.map((p) => ETIQUETAS.get(p)).find(Boolean) ?? "realizar esta acción"
}

/** Un permiso o varios, siempre como lista. */
const comoLista = (perm: PermisoRequerido): readonly string[] => (Array.isArray(perm) ? perm : [perm as string])

/** El nombre que se muestra y se registra: «a» o «a o b». */
const nombreDe = (perm: PermisoRequerido): string => comoLista(perm).join(" o ")

/**
 * Deja constancia del rechazo. Nunca lanza: un fallo escribiendo el registro
 * no puede tumbar la petición ni, en modo sombra, cambiar lo que pasa.
 */
async function anotarRechazo(datos: {
  accion: string
  permiso: string
  ruta?: string
  user?: ActionUser
  businessId?: string | null
}): Promise<void> {
  try {
    const ctx = getBusinessContext()
    await getSupabaseAdmin().from("csl_permission_denials").insert({
      business_id: datos.businessId ?? ctx?.businessId ?? null,
      user_id: datos.user?.id ?? null,
      user_email: datos.user?.email ?? null,
      accion: datos.accion,
      permiso: datos.permiso,
      ruta: datos.ruta ?? null,
      modo: modoEstricto() ? "estricto" : "sombra",
      ip_address: datos.user?.ip ?? null,
      user_agent: datos.user?.userAgent ?? null,
    })
  } catch {
    // El registro es para diagnosticar, no para autorizar. Si falla, seguimos.
  }
}

/** El permiso que exige esta acción, resolviendo `getRowsPaged` por su entidad. */
function permisoRequerido(accion: string, entidad?: string): PermisoRequerido | undefined {
  const declarado = ACTION_PERMISSIONS[accion]
  if (declarado !== POR_ENTIDAD) return declarado
  // Entidad desconocida → sin permiso declarado → se rechaza. Es la vía por la
  // que `credenciales` se colaba saltándose el TOTP.
  return entidad ? ENTITY_PERMISSIONS[entidad] : undefined
}

/**
 * Puerta del despachador. `entidad` solo la usa `getRowsPaged`.
 * Lanza `PermisoDenegado` en modo estricto; en sombra solo anota.
 */
export async function enforceActionPermission(
  accion: string,
  user: ActionUser,
  entidad?: string,
): Promise<void> {
  const permiso = permisoRequerido(accion, entidad)
  if (permiso === PUBLICO) return

  // Sin declarar = se rechaza. Es el cierre por defecto: una acción nueva sin
  // permiso no nace abierta, nace cerrada.
  if (!permiso) {
    const detalle = accion === "getRowsPaged" ? `${accion}:${entidad || "?"}` : accion
    await anotarRechazo({ accion: detalle, permiso: "SIN DECLARAR", user })
    if (modoEstricto()) throw new PermisoDenegado(detalle, "sin declarar", "realizar esta acción")
    return
  }

  if (comoLista(permiso).some((p) => hasPermission(p))) return

  await anotarRechazo({ accion, permiso: nombreDe(permiso), user })
  if (modoEstricto()) throw new PermisoDenegado(accion, nombreDe(permiso), etiquetaDe(permiso))
}

/**
 * Igual que `hasPermission` pero contra un contexto EXPLÍCITO. Las rutas de
 * fuera del despachador resuelven su contexto a mano y no siempre corren
 * dentro de `runWithBusinessContext`, así que no pueden leerlo del
 * AsyncLocalStorage. Misma regla: el superadministrador se salta todo; un
 * `is_admin` corriente se salta lo normal pero no la caja fuerte.
 */
export function contextoTienePermiso(ctx: BusinessContext | null, perm: string): boolean {
  if (!ctx) return false
  if (ctx.isSuperadmin) return true
  if (ctx.permissions?.includes(perm)) return true
  return Boolean(ctx.isAdmin) && !CAJA_FUERTE.has(perm)
}

/**
 * Puerta de las rutas que no pasan por el despachador (subidas de archivos,
 * importadores, ajustes del sistema). Devuelve la respuesta 403 ya construida,
 * o `null` si puede seguir.
 */
export async function enforceRoutePermission(
  metodo: string,
  ruta: string,
  user: ActionUser,
  ctx: BusinessContext | null,
): Promise<{ status: number; body: { ok: false; error: string; permiso: string } } | null> {
  const clave = `${metodo} ${ruta}`
  const permiso = ROUTE_PERMISSIONS[clave]

  if (!permiso) {
    await anotarRechazo({ accion: clave, permiso: "SIN DECLARAR", ruta, user })
    if (!modoEstricto()) return null
    return { status: 403, body: { ok: false, error: "Esta ruta no declara permiso.", permiso: "sin declarar" } }
  }

  // Basta con UNO: hay pantallas que cruzan módulos (el link público lo
  // generan Clientes y RR.HH., y ningún menú concede los dos permisos).
  if (comoLista(permiso).some((p) => contextoTienePermiso(ctx, p))) return null

  await anotarRechazo({ accion: clave, permiso: nombreDe(permiso), ruta, user, businessId: ctx?.businessId ?? null })
  if (!modoEstricto()) return null
  return {
    status: 403,
    body: {
      ok: false,
      error: `No tienes permiso para ${etiquetaDe(permiso)} (${nombreDe(permiso)}). Pídeselo al administrador.`,
      permiso: nombreDe(permiso),
    },
  }
}
