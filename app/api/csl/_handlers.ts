/**
 * Dispatcher central de las acciones soportadas por /api/csl.
 *
 * Mantiene el contrato `action: "..."` que el frontend ya envía — agregar
 * acciones nuevas implica añadir un `case` aquí, no cambiar la firma.
 *
 * Server-only.
 */

import { ALL_MENU_IDS } from "@/lib/menus"
import { sendFichaDermoEmail } from "@/lib/dermo-server"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import {
  dateValue,
  numberFrom,
  parsePayload,
  stringArrayFrom,
  textFrom,
  textValue,
  numberValue,
} from "@/lib/server/csl-helpers"
import {
  deleteRow,
  getAllData,
  getAllPulsosData,
  getProfile,
  getRows,
  getRowsPaged,
  loadBusinessContext,
  requireAdmin,
  resolveClienteId,
  syncFichasCliente,
  tableConfig,
  updateRowFields,
  upsertClienteCosmiatriaPreserving,
  upsertRow,
} from "@/lib/server/csl-crud"
import { runWithBusinessContext } from "@/lib/server/business-context"
import {
  clienteCosmiatriaToDb,
  consentToDb,
  fichaDermoToDb,
  fromDb,
  profileToUser,
  solicitudToDb,
} from "@/lib/server/csl-transforms"
import {
  sendApprovedSolicitudEmail,
  sendConsentMasajeEmail,
  sendConsentTatuajeCejaEmail,
  sendReporteEmail,
} from "@/lib/server/csl-email"
import type { ActionParams, ActionUser, Row } from "@/lib/server/csl-types"

const MENU_IDS: string[] = [...ALL_MENU_IDS]

export async function handleAction(params: ActionParams, user: ActionUser) {
  const action = textValue(params, "action")

  // Cargar BusinessContext UNA vez por request. Todos los CRUD ops dentro
  // de runWithBusinessContext lo leen automático y filtran por business_id.
  // Si el profile no tiene business_id (no debería pasar post-migración 002),
  // ctx queda null y los CRUD ops no filtran — riesgo aceptable porque la
  // migración garantizó backfill.
  const businessContext = await loadBusinessContext(user.id)

  return runWithBusinessContext(businessContext, async () => {
    return dispatchAction(action, params, user)
  })
}

async function dispatchAction(action: string, params: ActionParams, user: ActionUser) {
  switch (action) {
    case "health": {
      const { error } = await getSupabaseAdmin().from("csl_sucursales").select("codigo").limit(1)
      if (error) throw error
      return { ok: true, provider: "supabase" }
    }
    case "getAllData":
      return { ok: true, data: await getAllData() }
    case "getAllPulsosData":
      return { ok: true, ...(await getAllPulsosData()) }
    case "getCredenciales":
      return { ok: true, records: await getRows("credenciales") }
    case "getSolicitudesEmpleo":
      return { ok: true, records: await getRows("solicitudes_empleo") }
    case "getClientesCosmiatria":
      return { ok: true, records: await getRows("cosmiatria_clientes") }
    case "getFichasDermatologia":
      return { ok: true, records: await getRows("ficha_dermatologica") }
    case "getConsentMasajes":
      return { ok: true, records: await getRows("csl_consent_masajes") }
    case "getConsentTatuajesCejas":
      return { ok: true, records: await getRows("csl_consent_tatuajes_cejas") }
    case "getCertificadosRegalo":
      return { ok: true, records: await getRows("certificados_regalo") }
    case "getRowsPaged": {
      // Lectura paginada genérica: el cliente pasa entity, limit, offset y
      // filtros opcionales como pares clave/valor (string).
      const entity = textValue(params, "entity")
      const limit = numberValue(params, "limit", 50)
      const offset = numberValue(params, "offset", 0)
      const filtersRaw = parsePayload(params).filters
      const filters: Record<string, string | number | boolean | null | undefined> = {}
      if (filtersRaw && typeof filtersRaw === "object") {
        for (const [key, value] of Object.entries(filtersRaw as Record<string, unknown>)) {
          if (value === undefined || value === null) continue
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            filters[key] = value
          }
        }
      }
      const { rows, total } = await getRowsPaged(entity, { limit, offset, filters })
      return { ok: true, records: rows, total, limit, offset }
    }
    case "getEmpleados": {
      const empleados = await getRows("empleados")
      if (empleados.length) return { ok: true, records: empleados }
      const solicitudes = await getRows("solicitudes_empleo")
      return { ok: true, records: solicitudes.filter((record) => String(record.Estado ?? record.estado) === "Aprobado") }
    }
    case "getCurrentUserProfile": {
      const profile = await getProfile(user.id)
      return { ok: true, user: profile ? profileToUser(profile) : null }
    }
    case "getUsers": {
      await requireAdmin(user.id)
      const { data, error } = await getSupabaseAdmin()
        .from("csl_user_profiles")
        .select("*")
        .order("nombre", { ascending: true })
      if (error) throw error
      return { ok: true, records: (data || []).map((profile) => profileToUser(profile as Row)) }
    }
    case "saveUser": {
      await requireAdmin(user.id)
      const record = parsePayload(params)
      const email = textFrom(record, "username").trim().toLowerCase()
      const password = textFrom(record, "password").trim()
      const editingId = textFrom(record, "id").trim()
      const nombre = textFrom(record, "nombre").trim()
      const isAdmin = Boolean(record.isAdmin)
      const activo = record.activo !== false
      // Filtrar al ID set conocido para que no se cuelen valores arbitrarios.
      const allowed = new Set(MENU_IDS)
      const menus = isAdmin
        ? [...MENU_IDS]
        : stringArrayFrom(record.menus).filter((id) => allowed.has(id))

      // ---- validaciones ----
      if (!nombre) throw new Error("Falta el nombre del usuario")
      if (!email) throw new Error("Falta el correo del usuario")
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Correo con formato inválido")
      if (!editingId && !password) throw new Error("Falta la clave del usuario nuevo")
      if (password && password.length < 6) throw new Error("La clave debe tener al menos 6 caracteres")
      if (!isAdmin && menus.length === 0) {
        throw new Error("Selecciona al menos un módulo o marca el usuario como Administrador")
      }

      const supabase = getSupabaseAdmin()

      // ---- protección "último admin": si me edito a mí mismo y me quito
      // admin/me desactivo, verificar que quede al menos OTRO admin activo.
      if (editingId === user.id && (!isAdmin || !activo)) {
        const { count, error: adminCountError } = await supabase
          .from("csl_user_profiles")
          .select("user_id", { count: "exact", head: true })
          .eq("is_admin", true)
          .eq("activo", true)
          .neq("user_id", user.id)
        if (adminCountError) throw adminCountError
        if ((count ?? 0) === 0) {
          throw new Error(
            !activo
              ? "No puedes desactivarte: eres el único administrador activo"
              : "No puedes quitarte el rol de administrador: eres el único administrador activo",
          )
        }
      }

      // ---- evitar email duplicado al CREAR ----
      if (!editingId) {
        const { data: existing, error: existingError } = await supabase
          .from("csl_user_profiles")
          .select("user_id")
          .ilike("username", email)
          .maybeSingle()
        if (existingError) throw existingError
        if (existing) throw new Error("Ya existe un usuario con ese correo")
      }

      let userId = editingId

      if (editingId) {
        const attributes: Record<string, unknown> = {
          email,
          user_metadata: { nombre, username: email, is_admin: isAdmin, activo, menus },
        }
        if (password) attributes.password = password
        const { data, error } = await supabase.auth.admin.updateUserById(editingId, attributes)
        if (error) throw error
        userId = data.user.id
      } else {
        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { nombre, username: email, is_admin: isAdmin, activo, menus },
        })
        if (error) throw error
        userId = data.user.id
      }

      const profile = {
        user_id: userId,
        nombre,
        username: email,
        is_admin: isAdmin,
        activo,
        menus,
      }
      const { error } = await supabase
        .from("csl_user_profiles")
        .upsert(profile, { onConflict: "user_id" })
      if (error) throw error
      return { ok: true, record: profileToUser(profile) }
    }
    case "deleteUser": {
      await requireAdmin(user.id)
      const userId = textValue(params, "id")
      if (!userId) throw new Error("Falta el id del usuario")
      if (userId === user.id) throw new Error("No puedes eliminar tu propia cuenta")

      const supabase = getSupabaseAdmin()

      // No permitir borrar al último admin activo, aunque sea otro admin.
      const { data: target, error: targetError } = await supabase
        .from("csl_user_profiles")
        .select("user_id, is_admin, activo")
        .eq("user_id", userId)
        .maybeSingle()
      if (targetError) throw targetError
      if (target?.is_admin && target?.activo) {
        const { count, error: adminCountError } = await supabase
          .from("csl_user_profiles")
          .select("user_id", { count: "exact", head: true })
          .eq("is_admin", true)
          .eq("activo", true)
          .neq("user_id", userId)
        if (adminCountError) throw adminCountError
        if ((count ?? 0) === 0) {
          throw new Error("No puedes eliminar al único administrador activo")
        }
      }

      const { error } = await supabase.auth.admin.deleteUser(userId)
      if (error) throw error
      await supabase.from("csl_user_profiles").delete().eq("user_id", userId)
      return { ok: true }
    }
    case "saveSucursal": {
      const row = { codigo: textValue(params, "codigo"), nombre: textValue(params, "nombre"), ciudad: textValue(params, "ciudad"), direccion: textValue(params, "direccion"), estado: textValue(params, "estado", "Activa"), notas: textValue(params, "notas"), correo: textValue(params, "correo") }
      await upsertRow("sucursales", row)
      return { ok: true, record: fromDb("sucursales", row) }
    }
    case "deleteSucursal":
      await deleteRow("sucursales", textValue(params, "codigo"))
      return { ok: true }
    case "setSucursalEstado":
      await updateRowFields("sucursales", textValue(params, "codigo"), { estado: textValue(params, "estado") })
      return { ok: true }
    case "saveEquipo": {
      const row = { equipo_id: textValue(params, "equipoId"), sucursal: textValue(params, "sucursal"), empresa: textValue(params, "empresa"), domicilio: textValue(params, "domicilio"), modelo: textValue(params, "modelo"), serie: textValue(params, "serie"), numero: textValue(params, "numero"), p_cabeza: numberValue(params, "pcabeza"), p_totales: numberValue(params, "ptotales"), max_cabeza: numberValue(params, "maxCabeza", 6000000), estado: textValue(params, "estado", "Activo"), observaciones: textValue(params, "observaciones") }
      await upsertRow("equipos", row)
      return { ok: true, record: fromDb("equipos", row) }
    }
    case "deleteEquipo":
      await deleteRow("equipos", textValue(params, "equipoId"))
      return { ok: true }
    case "setEquipoEstado":
      await updateRowFields("equipos", textValue(params, "equipoId"), { estado: textValue(params, "estado") })
      return { ok: true }
    case "saveTecnico": {
      const row = { codigo: textValue(params, "codigo"), nombre: textValue(params, "nombre"), telefono: textValue(params, "telefono"), correo: textValue(params, "correo"), estado: textValue(params, "estado", "Activo"), notas: textValue(params, "notas") }
      await upsertRow("tecnicos", row)
      return { ok: true, record: fromDb("tecnicos", row) }
    }
    case "deleteTecnico":
      await deleteRow("tecnicos", textValue(params, "codigo"))
      return { ok: true }
    case "setTecnicoEstado":
      await updateRowFields("tecnicos", textValue(params, "codigo"), { estado: textValue(params, "estado") })
      return { ok: true }
    case "savePieza": {
      const row = { pieza: textValue(params, "pieza"), categoria: textValue(params, "categoria"), prioridad: textValue(params, "prioridad", "Media"), tipo: textValue(params, "tipo", "Consumible"), funcion: textValue(params, "funcion"), fallas_comunes: textValue(params, "fallasComunes"), activa: textValue(params, "activa", "Sí") }
      await upsertRow("piezas", row)
      return { ok: true, record: fromDb("piezas", row) }
    }
    case "deletePieza":
      await deleteRow("piezas", textValue(params, "pieza"))
      return { ok: true }
    case "getPiezasPolizaLista":
      return { ok: true, records: await getRows("piezas_poliza_lista") }
    case "savePiezaPolizaLista": {
      // id opcional → generamos UUID server-side si es nuevo. La columna en DB
      // tiene default gen_random_uuid(), pero upsertRow requiere la clave en
      // el payload para el onConflict (no podemos delegarlo).
      const id = textValue(params, "id") || (globalThis.crypto?.randomUUID?.() ?? `pp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`)
      const estadoRaw = textValue(params, "estado", "pendiente")
      const estado: "pendiente" | "recibida" = estadoRaw === "recibida" ? "recibida" : "pendiente"
      const fechaRecibida = dateValue(params.fechaRecibida)
      const row: Row = {
        id,
        pieza_nombre: textValue(params, "piezaNombre"),
        categoria_snapshot: textValue(params, "categoriaSnapshot") || null,
        cantidad: Math.max(1, numberValue(params, "cantidad", 1)),
        suplidor: textValue(params, "suplidor") || null,
        prioridad: textValue(params, "prioridad", "Media"),
        estado,
        sucursal: textValue(params, "sucursal") || null,
        fecha_solicitada: dateValue(params.fechaSolicitada) || new Date().toISOString().slice(0, 10),
        // Coherencia estado ↔ fecha_recibida:
        //   recibida → si el cliente pasó fecha la usamos, sino hoy
        //   pendiente → siempre null (limpieza si se devolvió a pendiente)
        fecha_recibida: estado === "recibida" ? (fechaRecibida || new Date().toISOString().slice(0, 10)) : null,
        nota: textValue(params, "nota") || null,
        creado_por: user.id,
      }
      if (!row.pieza_nombre) throw new Error("Falta el nombre de la pieza")
      await upsertRow("piezas_poliza_lista", row)
      return { ok: true, record: fromDb("piezas_poliza_lista", row) }
    }
    case "markPiezaPolizaRecibida": {
      const id = textValue(params, "id")
      if (!id) throw new Error("Falta id")
      await updateRowFields("piezas_poliza_lista", id, {
        estado: "recibida",
        fecha_recibida: dateValue(params.fechaRecibida) || new Date().toISOString().slice(0, 10),
      })
      return { ok: true }
    }
    case "markPiezaPolizaPendiente": {
      const id = textValue(params, "id")
      if (!id) throw new Error("Falta id")
      await updateRowFields("piezas_poliza_lista", id, {
        estado: "pendiente",
        fecha_recibida: null,
      })
      return { ok: true }
    }
    case "deletePiezaPolizaLista":
      await deleteRow("piezas_poliza_lista", textValue(params, "id"))
      return { ok: true }
    case "saveReporte": {
      const row = { report_id: textValue(params, "reportId"), fecha: dateValue(params.fecha), equipo_id: textValue(params, "equipoId"), sucursal: textValue(params, "sucursal"), empresa: textValue(params, "empresa"), cliente: textValue(params, "cliente"), domicilio: textValue(params, "domicilio"), ciudad: textValue(params, "ciudad", "Santiago"), modelo: textValue(params, "modelo"), serie: textValue(params, "serie"), numero: textValue(params, "numero"), tipo: textValue(params, "tipo", "Preventivo"), estado_equipo: textValue(params, "estadoEquipo", "Operativo"), prioridad: textValue(params, "prioridad", "Baja"), problema: textValue(params, "problema"), correccion: textValue(params, "correccion"), observaciones: textValue(params, "observaciones"), checklist: textValue(params, "checklist"), p_cabeza: numberValue(params, "pcabeza"), p_totales: numberValue(params, "ptotales"), atendio: textValue(params, "atendio"), piezas_json: textValue(params, "piezasJson", "[]"), partes_texto: textValue(params, "partesTexto"), firma_cliente: textValue(params, "firmaCliente"), firma_tecnico: textValue(params, "firmaTecnico"), fotos: textValue(params, "fotos", "[]") }
      const config = tableConfig("reportes")
      const { data } = await getSupabaseAdmin()
        .from(config.table)
        .select(config.key)
        .eq(config.key, row.report_id)
        .maybeSingle()
      await upsertRow("reportes", row)
      const email = data ? undefined : await sendReporteEmail(row).catch((error: unknown) => ({
        sent: false,
        warning: error instanceof Error ? error.message : "No se pudo enviar el correo",
      }))
      return { ok: true, record: fromDb("reportes", row), email }
    }
    case "deleteReporte":
      await deleteRow("reportes", textValue(params, "reportId") || textValue(params, "id"))
      return { ok: true }
    case "addInventario":
    case "updateInventario":
    case "saveInventario": {
      const record = parsePayload(params)
      const row = { item_id: String(record.ItemID ?? params.id ?? `inv_${Date.now()}`), codigo_barras: record.CodigoBarras ?? "", pieza: record.Pieza ?? "", categoria: record.Categoria ?? "", marca: record.Marca ?? "", modelo: record.Modelo ?? "", numero_parte: record.NumeroParte ?? "", precio_compra: Number(record.PrecioCompra ?? 0), precio_compra_mercado: Number(record.PrecioCompraMercado ?? 0), precio_venta: Number(record.PrecioVenta ?? 0), stock_rafael_vidal: Number(record.StockRafaelVidal ?? 0), stock_los_jardines: Number(record.StockLosJardines ?? 0), stock_villa_olga: Number(record.StockVillaOlga ?? 0), stock_la_vega: Number(record.StockLaVega ?? 0), stock_minimo: Number(record.StockMinimo ?? 0), proveedor: record.Proveedor ?? "", estado: record.Estado ?? "Activo", observaciones: record.Observaciones ?? "" }
      await upsertRow("inventario", row)
      return { ok: true, record: fromDb("inventario", row) }
    }
    case "deleteInventario":
      await deleteRow("inventario", textValue(params, "id"))
      return { ok: true }
    case "saveCredencial": {
      const record = parsePayload(params)
      const row = { credencial_id: String(record.CredencialID ?? record.id ?? `CRD-${Date.now()}`), sucursal: record.Sucursal ?? record.sucursal ?? "", area: record.Area ?? record.area ?? "", equipo: record.Equipo ?? record.equipo ?? "", sistema: record.Sistema ?? record.sistema ?? "", usuario: record.Usuario ?? record.usuario ?? "", contrasena: record.Contrasena ?? record.contrasena ?? "", pin: record.PIN ?? record.pin ?? "", url: record.URL ?? record.url ?? "", correo: record.Correo ?? record.correo ?? "" }
      await upsertRow("credenciales", row)
      return { ok: true, record: fromDb("credenciales", row) }
    }
    case "deleteCredencial":
      await deleteRow("credenciales", textValue(params, "id"))
      return { ok: true }
    case "saveSolicitudEmpleo": {
      const row = solicitudToDb(parsePayload(params))
      await upsertRow("solicitudes_empleo", row)
      let email: Awaited<ReturnType<typeof sendApprovedSolicitudEmail>> | undefined
      if (row.estado === "Aprobado") {
        await upsertRow("empleados", { ...row, empleado_id: row.solicitud_id })
        email = await sendApprovedSolicitudEmail(row).catch((error: unknown) => ({
          sent: false,
          warning: error instanceof Error ? error.message : "No se pudo enviar el correo",
        }))
      } else {
        await deleteRow("empleados", String(row.solicitud_id)).catch(() => undefined)
      }
      return { ok: true, record: fromDb("solicitudes_empleo", row), email }
    }
    case "deleteSolicitudEmpleo": {
      const id = textValue(params, "id")
      await deleteRow("solicitudes_empleo", id)
      await deleteRow("empleados", id).catch(() => undefined)
      return { ok: true }
    }
    case "saveClienteCosmiatria": {
      const payload = parsePayload(params)
      const clienteId = await resolveClienteId(payload)
      const row = clienteCosmiatriaToDb({ ...payload, ClienteID: clienteId })
      const cliente = await upsertClienteCosmiatriaPreserving(row)
      await syncFichasCliente(cliente)
      return { ok: true, record: fromDb("cosmiatria_clientes", cliente) }
    }
    case "deleteClienteCosmiatria":
      await deleteRow("cosmiatria_clientes", textValue(params, "id"))
      return { ok: true }
    case "saveFichaDermatologia": {
      const payload = parsePayload(params)
      const clienteId = await resolveClienteId(payload)
      const cliente = await upsertClienteCosmiatriaPreserving(clienteCosmiatriaToDb({ ...payload, ClienteID: clienteId }))
      const row: Row = {
        ...fichaDermoToDb({ ...payload, clienteId: cliente.cliente_id }),
        cliente_id: cliente.cliente_id,
        email: String(payload.email || payload.Email || cliente.email || ""),
      }
      row.payload_json = { ...((row.payload_json as unknown as Row) || {}), email: row.email, Email: row.email }
      await upsertRow("ficha_dermatologica", row)
      await syncFichasCliente(cliente)
      const email = await sendFichaDermoEmail(row).catch((error: unknown) => ({
        sent: false,
        warning: error instanceof Error ? error.message : "No se pudo enviar el correo",
      }))
      return { ok: true, record: fromDb("ficha_dermatologica", row), email }
    }
    case "deleteFichaDermatologia":
      await deleteRow("ficha_dermatologica", textValue(params, "id"))
      return { ok: true }
    case "saveConsentMasaje": {
      const payload = parsePayload(params)
      const clienteId = await resolveClienteId(payload)
      const cliente = await upsertClienteCosmiatriaPreserving(clienteCosmiatriaToDb({ ...payload, ClienteID: clienteId }))
      const row = consentToDb({ ...payload, clienteId: cliente.cliente_id }, "masajes")
      await upsertRow("csl_consent_masajes", row)
      await syncFichasCliente(cliente)
      // Notificación por email (Resend) — el guardado nunca se pierde si
      // el correo falla; reportamos el warning al frontend.
      const email = await sendConsentMasajeEmail(row).catch((error: unknown) => ({
        sent: false,
        warning: error instanceof Error ? error.message : "No se pudo enviar el correo",
      }))
      return { ok: true, record: fromDb("csl_consent_masajes", row), email }
    }
    case "deleteConsentMasaje":
      await deleteRow("csl_consent_masajes", textValue(params, "id") || textValue(params, "consentId"))
      return { ok: true }
    case "saveConsentTatuajeCeja": {
      const payload = parsePayload(params)
      const clienteId = await resolveClienteId(payload)
      const cliente = await upsertClienteCosmiatriaPreserving(clienteCosmiatriaToDb({ ...payload, ClienteID: clienteId }))
      const row = consentToDb({ ...payload, clienteId: cliente.cliente_id }, "tatuajes")
      await upsertRow("csl_consent_tatuajes_cejas", row)
      await syncFichasCliente(cliente)
      // Notificación por email — patrón idéntico al de masajes / ficha derma.
      const email = await sendConsentTatuajeCejaEmail(row).catch((error: unknown) => ({
        sent: false,
        warning: error instanceof Error ? error.message : "No se pudo enviar el correo",
      }))
      return { ok: true, record: fromDb("csl_consent_tatuajes_cejas", row), email }
    }
    case "deleteConsentTatuajeCeja":
      await deleteRow("csl_consent_tatuajes_cejas", textValue(params, "id") || textValue(params, "consentId"))
      return { ok: true }
    case "getClienteHistorial": {
      // Devuelve TODO lo relacionado con un cliente: ficha + consents.
      // Útil para la vista "Historial" del módulo Clientes y para que el
      // formulario de consentimientos pueda detectar si el cliente ya tiene
      // ficha dermatológica.
      //
      // Las queries a csl_consent_masajes/csl_consent_tatuajes_cejas requieren la
      // columna `cliente_id` que se agrega en `csl_relate_consents.sql`. Si
      // la migración aún no se aplicó, devolvemos arrays vacíos y un
      // warning, en vez de romper toda la respuesta.
      const clienteId = textValue(params, "clienteId") || textValue(params, "id")
      if (!clienteId) throw new Error("Falta clienteId")
      const supabase = getSupabaseAdmin()
      const [cliente, fichas] = await Promise.all([
        supabase.from("csl_cosmiatria_clientes").select("*").eq("cliente_id", clienteId).maybeSingle(),
        supabase.from("csl_ficha_dermatologica").select("*").eq("cliente_id", clienteId).order("fecha", { ascending: false }),
      ])
      if (cliente.error) throw cliente.error
      if (fichas.error) throw fichas.error

      const safeQueryConsents = async (table: string) => {
        const res = await supabase.from(table).select("*").eq("cliente_id", clienteId).order("fecha", { ascending: false })
        if (res.error) {
          // 42703 = undefined_column. Pre-migración: sin vínculos posibles.
          if (/cliente_id|column.*does not exist|42703/i.test(res.error.message || "")) return []
          throw res.error
        }
        return (res.data || []) as Row[]
      }

      const [consMas, consTat] = await Promise.all([
        safeQueryConsents("csl_consent_masajes"),
        safeQueryConsents("csl_consent_tatuajes_cejas"),
      ])

      // Sesiones PulseControl: el campo `cliente` es texto libre (nombre).
      // Buscamos por coincidencia de nombre completo del cliente cargado.
      const clienteRow = cliente.data as Row | null
      const sesionesPulse: Row[] = []
      if (clienteRow) {
        const nombre = String(clienteRow.nombre || "").trim()
        const apellido = String(clienteRow.apellido || "").trim()
        const full = [nombre, apellido].filter(Boolean).join(" ")
        if (full.length >= 3) {
          const { data: ses, error: sesError } = await supabase
            .from("csl_sesiones_cliente")
            .select("*")
            .ilike("cliente", `%${full}%`)
            .order("fecha", { ascending: false })
            .limit(200)
          if (!sesError && Array.isArray(ses)) {
            sesionesPulse.push(...(ses as Row[]))
          }
        }
      }

      return {
        ok: true,
        cliente: clienteRow ? fromDb("cosmiatria_clientes", clienteRow) : null,
        fichas: ((fichas.data || []) as Row[]).map((row) => fromDb("ficha_dermatologica", row)),
        consentMasajes: consMas.map((row) => fromDb("csl_consent_masajes", row)),
        consentTatuajesCejas: consTat.map((row) => fromDb("csl_consent_tatuajes_cejas", row)),
        sesionesPulse: sesionesPulse.map((row) => fromDb("sesiones_cliente", row)),
      }
    }
    case "saveCertificadoRegalo": {
      const record = parsePayload(params)
      const row = {
        codigo: String(record.codigo ?? record.Codigo ?? params.codigo ?? `CSL-GC-${Date.now()}`),
        tipo: String(record.tipo ?? record.Tipo ?? "Digital"),
        fecha: dateValue(record.fecha ?? record.Fecha),
        sucursal: String(record.sucursal ?? record.Sucursal ?? ""),
        otorgado_a: String(record.otorgadoA ?? record.OtorgadoA ?? ""),
        cortesia_de: String(record.cortesiaDe ?? record.CortesiaDe ?? ""),
        valido_por: String(record.validoPor ?? record.ValidoPor ?? ""),
        firma: String(record.firma ?? record.Firma ?? ""),
        emitido_en: String(record.emitidoEn ?? record.EmitidoEn ?? new Date().toISOString()),
        estado: String(record.estado ?? record.Estado ?? "Emitido"),
        canjeado_en: record.canjeadoEn || record.CanjeadoEn ? String(record.canjeadoEn ?? record.CanjeadoEn) : null,
        notas_estado: String(record.notasEstado ?? record.NotasEstado ?? ""),
      }
      await upsertRow("certificados_regalo", row)
      return { ok: true, record: fromDb("certificados_regalo", row) }
    }
    case "deleteCertificadoRegalo":
      await deleteRow("certificados_regalo", textValue(params, "codigo") || textValue(params, "id"))
      return { ok: true }
    case "getCertificadosDepicenter":
      return { ok: true, records: await getRows("certificados_depicenter") }
    case "saveCertificadoDepicenter": {
      const record = parsePayload(params)
      const row = {
        codigo: String(record.codigo ?? record.Codigo ?? params.codigo ?? `DEPI-GC-${Date.now()}`),
        tipo: String(record.tipo ?? record.Tipo ?? "Digital"),
        fecha: dateValue(record.fecha ?? record.Fecha),
        fecha_vencimiento: dateValue(record.fechaVencimiento ?? record.FechaVencimiento),
        sucursal: String(record.sucursal ?? record.Sucursal ?? ""),
        otorgado_a: String(record.otorgadoA ?? record.OtorgadoA ?? ""),
        cortesia_de: String(record.cortesiaDe ?? record.CortesiaDe ?? ""),
        valido_por: String(record.validoPor ?? record.ValidoPor ?? ""),
        monto: record.monto != null && record.monto !== "" ? Number(record.monto) : null,
        servicio: String(record.servicio ?? ""),
        firma: String(record.firma ?? record.Firma ?? ""),
        emitido_en: String(record.emitidoEn ?? record.EmitidoEn ?? new Date().toISOString()),
        emitido_por: String(record.emitidoPor ?? record.EmitidoPor ?? ""),
        estado: String(record.estado ?? record.Estado ?? "Activo"),
        usado_en: record.usadoEn ? String(record.usadoEn) : null,
        fecha_uso: record.fechaUso ? String(record.fechaUso) : null,
        cancelado_en: record.canceladoEn ? String(record.canceladoEn) : null,
        notas_estado: String(record.notasEstado ?? record.NotasEstado ?? ""),
        cliente_nombre: String(record.clienteNombre ?? record.ClienteNombre ?? ""),
        cliente_telefono: String(record.clienteTelefono ?? record.ClienteTelefono ?? ""),
        cliente_correo: String(record.clienteCorreo ?? record.ClienteCorreo ?? ""),
        cliente_documento: String(record.clienteDocumento ?? record.ClienteDocumento ?? ""),
        observaciones: String(record.observaciones ?? record.Observaciones ?? ""),
      }
      await upsertRow("certificados_depicenter", row)
      return { ok: true, record: fromDb("certificados_depicenter", row) }
    }
    case "deleteCertificadoDepicenter":
      await deleteRow("certificados_depicenter", textValue(params, "codigo") || textValue(params, "id"))
      return { ok: true }
    case "addOperadora":
    case "updateOperadora":
    case "saveOperadora": {
      const record = parsePayload(params)
      const row = { operadora_id: String(record.OperadoraID ?? params.id ?? `op_${Date.now()}`), nombre: record.Nombre ?? "", sucursal: record.Sucursal ?? "", estado: record.Estado ?? "Activa", notas: record.Notas ?? "" }
      await upsertRow("operadoras", row)
      return { ok: true, record: fromDb("operadoras", row) }
    }
    case "deleteOperadora":
      await deleteRow("operadoras", textValue(params, "id"))
      return { ok: true }
    case "addLectura":
    case "updateLectura":
    case "saveLectura": {
      const record = parsePayload(params)
      const row = { lectura_id: String(record.LecturaID ?? params.id ?? `lec_${Date.now()}`), fecha_semana: dateValue(record.FechaSemana), equipo_id: record.EquipoID ?? "", sucursal: record.Sucursal ?? "", cabina: record.Cabina ?? "", operadora_id: record.OperadoraID ?? "", lectura_inicial: numberFrom(record, "LecturaInicial"), lectura_final: numberFrom(record, "LecturaFinal"), diferencia_real: numberFrom(record, "DiferenciaReal"), observaciones: record.Observaciones ?? "" }
      await upsertRow("lecturas_semanales", row)
      return { ok: true, record: fromDb("lecturas_semanales", row) }
    }
    case "deleteLectura":
      await deleteRow("lecturas_semanales", textValue(params, "id"))
      return { ok: true }
    case "addSesion":
    case "updateSesion":
    case "saveSesion": {
      const record = parsePayload(params)
      // Campos del Excel AgendaPro (opcionales — solo vienen en imports).
      const importHash = typeof record.ImportHash === "string" && record.ImportHash.trim() ? record.ImportHash.trim() : null
      const row = {
        sesion_id: String(record.SesionID ?? params.id ?? `ses_${Date.now()}`),
        fecha: dateValue(record.Fecha),
        sucursal: record.Sucursal ?? "",
        cabina: record.Cabina ?? "",
        operadora_id: record.OperadoraID ?? "",
        cliente: record.Cliente ?? "",
        area_trabajada: record.AreaTrabajada ?? "",
        disparos_reportados: numberFrom(record, "DisparosReportados"),
        duracion: record.Duracion ? Number(record.Duracion) : null,
        equipo_id: record.EquipoID ?? "",
        observaciones: record.Observaciones ?? "",
        // Columnas agregadas por 009_pulse_import_richer.sql. Las vacías
        // se mandan como null para que la DB respete los defaults.
        contacto_cliente: typeof record.ContactoCliente === "string" && record.ContactoCliente ? record.ContactoCliente : null,
        tratamiento: typeof record.Tratamiento === "string" && record.Tratamiento ? record.Tratamiento : null,
        potencia: typeof record.Potencia === "string" && record.Potencia ? record.Potencia : null,
        spot: typeof record.Spot === "string" && record.Spot ? record.Spot : null,
        archivo_origen: typeof record.ArchivoOrigen === "string" && record.ArchivoOrigen ? record.ArchivoOrigen : null,
        fila_origen: typeof record.FilaOrigen === "number" ? record.FilaOrigen : null,
        import_hash: importHash,
      }
      try {
        await upsertRow("sesiones_cliente", row)
      } catch (err) {
        // El UNIQUE parcial csl_sesiones_cliente_import_hash_uidx dispara
        // 23505 cuando el mismo Excel se sube dos veces. Esto NO es error
        // — es la dedupe robusta funcionando. Devolvemos OK con flag
        // `duplicate: true` para que el frontend lo cuente.
        const code = (err as { code?: string }).code
        const message = (err as { message?: string }).message || ""
        const isUniqueDup = code === "23505" || /duplicate key|import_hash/i.test(message)
        if (isUniqueDup && importHash) {
          return { ok: true, duplicate: true }
        }
        throw err
      }
      return { ok: true, record: fromDb("sesiones_cliente", row) }
    }
    case "deleteSesion":
      await deleteRow("sesiones_cliente", textValue(params, "id"))
      return { ok: true }
    case "addAuditoria":
    case "updateAuditoria":
    case "saveAuditoria": {
      const record = parsePayload(params)
      const archivoExcel = (() => {
        const v = record.ArchivoExcel
        if (Array.isArray(v)) return v
        if (typeof v === "string" && v.trim()) {
          try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] }
        }
        return []
      })()
      const row: Record<string, unknown> = {
        auditoria_id: String(record.AuditoriaID ?? params.id ?? `aud_${Date.now()}`),
        fecha_semana: dateValue(record.FechaSemana),
        equipo_id: record.EquipoID ?? "",
        sucursal: record.Sucursal ?? "",
        pulsos_reales: numberFrom(record, "PulsosReales"),
        pulsos_reportados: numberFrom(record, "PulsosReportados"),
        diferencia: numberFrom(record, "Diferencia"),
        porcentaje_desviacion: numberFrom(record, "PorcentajeDesviacion"),
        alerta: record.Alerta ?? "OK",
        observaciones: record.Observaciones ?? "",
        // Columnas agregadas por 010_pulse_cuadre_semanal_auditoria.sql
        cabina: typeof record.Cabina === "string" && record.Cabina ? record.Cabina : null,
        semana_fin: record.SemanaFin ? dateValue(record.SemanaFin) : null,
        lectura_inicial: record.LecturaInicial !== undefined && record.LecturaInicial !== null && record.LecturaInicial !== ""
          ? numberFrom(record, "LecturaInicial") : null,
        lectura_final: record.LecturaFinal !== undefined && record.LecturaFinal !== null && record.LecturaFinal !== ""
          ? numberFrom(record, "LecturaFinal") : null,
        creado_por: typeof record.CreadoPor === "string" && record.CreadoPor ? record.CreadoPor : null,
        archivo_excel: archivoExcel,
        fotos_count: typeof record.FotosCount === "number" ? record.FotosCount : 0,
        fuente: typeof record.Fuente === "string" && record.Fuente ? record.Fuente : null,
      }
      // Upsert via PK (auditoria_id). El UNIQUE parcial sobre
      // (business_id, fecha_semana, equipo_id, sucursal, coalesce(cabina,''))
      // garantiza que re-correr el cuadre de la misma semana+equipo+cabina
      // colisione si el auditoria_id es nuevo — el wizard ya envía un id
      // determinístico para evitarlo.
      try {
        await upsertRow("auditorias_semanales", row)
      } catch (err) {
        const code = (err as { code?: string }).code
        const message = (err as { message?: string }).message || ""
        if (code === "23505" || /semana_equipo|duplicate key/i.test(message)) {
          return { ok: false, error: "Ya existe un cuadre para esta semana/equipo/cabina. Reemplázalo desde el wizard si quieres regenerarlo." }
        }
        throw err
      }
      return { ok: true, record: fromDb("auditorias_semanales", row) }
    }
    case "deleteAuditoria":
      await deleteRow("auditorias_semanales", textValue(params, "id"))
      return { ok: true }
    default:
      return { ok: false, error: `Accion no soportada: ${action}` }
  }
}
