"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, CheckCircle2, Download, FileSpreadsheet, FileSignature, FileText, History, Loader2, Plus, RefreshCw, Search, Upload, UserRound, Users, Zap } from "lucide-react"
import { parseAgendaProClientsExcel } from "@/lib/agendapro-clients-excel"
import { apiJsonp, normalizeApiUrl, useAppStore } from "@/lib/store"
import type { ClienteCosmiatria } from "@/lib/types"
import type { FichaDermoCosmiatrica } from "@/lib/dermo-cosmiatria"
import { RecordActions } from "@/components/record-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SeqBadge } from "@/components/seq-badge"
import { useAutoRefresh } from "@/hooks/use-auto-refresh"
import { normalizeAddress } from "@/lib/address"
import { clientMatchesSearch } from "@/lib/cliente-search"
import { digitsOnly as onlyDigits, formatPhone, formatCedula, displayPhone, displayDocumento } from "@/lib/formatters"
import { findExistingClienteMatch } from "@/lib/cliente-dedupe"
import { useSessionUser } from "@/hooks/use-session-user"
import { MergeClientesDialog } from "@/components/merge-clientes-dialog"
import { AgendaProConfigDialog } from "@/components/integrations/agendapro-config-dialog"
import { businessIdForSlug } from "@/lib/business"
import { runIncrementalAgendaProSync } from "@/lib/agendapro-full-sync"
import { PlugZap } from "lucide-react"

interface HistorialPayload {
  fichas: Array<{ id: string; fecha: string; sucursal: string; operadora: string; estado: string; motivoConsulta?: string }>
  consentMasajes: Array<{ id: string; fecha: string; sucursal: string; estado: string; tipoMasaje?: string; zonaTratar?: string; nombreEspecialista?: string }>
  consentTatuajesCejas: Array<{ id: string; fecha: string; sucursal: string; estado: string; tipoProcedimiento?: string; zonaTratar?: string; nombreEspecialista?: string }>
  sesionesPulse: Array<{ SesionID: string; Fecha: string; Sucursal: string; Cabina?: string; OperadoraID?: string; AreaTrabajada?: string; DisparosReportados?: number; EquipoID?: string }>
}

const today = new Date().toISOString().slice(0, 10)

const emptyCliente: ClienteCosmiatria = {
  ClienteID: "",
  NumeroCliente: "",
  DocumentoIdentidad: "",
  Email: "",
  Nombre: "",
  Apellido: "",
  Telefono: "",
  Telefono2: "",
  Direccion: "",
  Localidad: "",
  Ciudad: "",
  Region: "",
  FechaNacimiento: "",
  Edad: 0,
  Genero: "",
  Sucursal: "",
  PuedeAgendar: true,
  ClienteDesde: today,
  Estado: "Activo",
  Notas: "",
}

function calculateAge(fechaNacimiento: string) {
  if (!fechaNacimiento) return 0
  const birth = new Date(`${fechaNacimiento}T00:00:00`)
  if (Number.isNaN(birth.getTime())) return 0
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const monthDiff = now.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1
  return Math.max(age, 0)
}

function nextClientNumber(clientes: ClienteCosmiatria[]) {
  const max = clientes.reduce((current, cliente) => {
    const number = Number(onlyDigits(cliente.NumeroCliente))
    return Number.isFinite(number) ? Math.max(current, number) : current
  }, 0)
  return String(max + 1).padStart(6, "0")
}

function normalizeCliente(raw: Record<string, unknown>): ClienteCosmiatria {
  return {
    ...emptyCliente,
    ClienteID: String(raw.ClienteID ?? raw.cliente_id ?? raw.id ?? ""),
    NumeroCliente: String(raw.NumeroCliente ?? raw.numero_cliente ?? ""),
    DocumentoIdentidad: String(raw.DocumentoIdentidad ?? raw.documento_identidad ?? ""),
    Email: String(raw.Email ?? raw.email ?? ""),
    Nombre: String(raw.Nombre ?? raw.nombre ?? ""),
    Apellido: String(raw.Apellido ?? raw.apellido ?? ""),
    Telefono: String(raw.Telefono ?? raw.telefono ?? ""),
    Telefono2: String(raw.Telefono2 ?? raw.telefono2 ?? ""),
    Direccion: String(raw.Direccion ?? raw.direccion ?? ""),
    Localidad: String(raw.Localidad ?? raw.localidad ?? ""),
    Ciudad: String(raw.Ciudad ?? raw.ciudad ?? ""),
    Region: String(raw.Region ?? raw.region ?? ""),
    FechaNacimiento: String(raw.FechaNacimiento ?? raw.fecha_nacimiento ?? ""),
    Edad: Number(raw.Edad ?? raw.edad ?? 0),
    Genero: String(raw.Genero ?? raw.genero ?? ""),
    Sucursal: String(raw.Sucursal ?? raw.sucursal ?? ""),
    PuedeAgendar: Boolean(raw.PuedeAgendar ?? raw.puede_agendar ?? true),
    ClienteDesde: String(raw.ClienteDesde ?? raw.cliente_desde ?? today),
    Estado: (String(raw.Estado ?? raw.estado ?? "Activo") === "Inactivo" ? "Inactivo" : "Activo") as ClienteCosmiatria["Estado"],
    Notas: String(raw.Notas ?? raw.notas ?? ""),
    Origen: String(raw.Origen ?? raw.origen ?? (raw.AgendaProClientId || raw.agendapro_client_id ? "AgendaPro" : "Manual")),
    AgendaProClientId: (raw.AgendaProClientId || raw.agendapro_client_id) ? String(raw.AgendaProClientId ?? raw.agendapro_client_id) : undefined,
  }
}

function fichaMatchesCliente(ficha: FichaDermoCosmiatrica, cliente: ClienteCosmiatria) {
  const clienteId = cliente.ClienteID
  const telefono = onlyDigits(cliente.Telefono)
  const documento = onlyDigits(cliente.DocumentoIdentidad)
  const fichaTelefono = onlyDigits(ficha.telefono)
  const fichaDocumento = onlyDigits(ficha.cedula)
  const nombre = `${cliente.Nombre} ${cliente.Apellido}`.trim().toLowerCase()
  return Boolean(
    (clienteId && ficha.clienteId === clienteId) ||
    (telefono && fichaTelefono && telefono === fichaTelefono) ||
    (documento && fichaDocumento && documento === fichaDocumento) ||
    (nombre && ficha.nombre?.toLowerCase() === nombre)
  )
}

function clienteRecord(cliente: ClienteCosmiatria) {
  const record = { ...cliente } as Record<string, unknown>
  delete record.PuedeAgendar
  return record as Record<string, unknown>
}

// Throttle del auto-sync incremental al entrar al menú (por negocio). Persiste
// entre montajes dentro de la sesión para no golpear AgendaPro en cada navegación.
const lastAutoAgendaProSyncAt = new Map<string, number>()
const AUTO_AGENDAPRO_SYNC_THROTTLE_MS = 3 * 60 * 1000

export function CosmiatriaClientesPage() {
  const { apiUrl, db, showToast, setIsLoading, setLoadingMessage, incrementFormOpen, decrementFormOpen } = useAppStore()
  const activeBusinessSlug = useAppStore((s) => s.activeBusinessSlug)
  // business_id del negocio activo (superadmin switcher). Viaja en cada request
  // de integración para que el sync SIEMPRE use el tenant seleccionado.
  const activeBusinessId = businessIdForSlug(activeBusinessSlug) || undefined
  const [agendaProConfigOpen, setAgendaProConfigOpen] = useState(false)
  const sessionUser = useSessionUser()
  const canMerge = !!sessionUser && (sessionUser.isAdmin || sessionUser.isSuperadmin)
  // Sincronizar AgendaPro: cualquier usuario autenticado puede dispararlo —
  // sirve para que recepción jale clientes recién registrados en AgendaPro
  // sin depender de un admin. El backend hardcodea business=CSL.
  const canSyncAgendaPro = !!sessionUser
  // Permiso "Sincronizar API": habilita el botón "Sincronizar directamente con
  // la API" en la barra superior. Admin/Superadmin lo ven por defecto; un
  // usuario normal solo si tiene el permiso `sincronizar-api` asignado.
  const canSyncApi = !!sessionUser && (
    sessionUser.isAdmin ||
    sessionUser.isSuperadmin ||
    (Array.isArray(sessionUser.menus) && sessionUser.menus.includes("sincronizar-api"))
  )
  // Rol Usuario tiene acceso solo-lectura a Clientes (no crear, no editar,
  // no eliminar). Admin y Superadmin sí pueden mutar.
  const canEditClientes = canMerge
  const [mergeOpen, setMergeOpen] = useState(false)
  const [agendaProSyncing, setAgendaProSyncing] = useState(false)
  const [agendaProProgress, setAgendaProProgress] = useState<{ read: number; created: number } | null>(null)
  const [agendaProStatus, setAgendaProStatus] = useState<{ ready?: boolean; pending?: string | null; lastSync?: { finished_at?: string; started_at?: string; status?: string; created?: number; updated?: number; errors?: number } | null } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importParsed, setImportParsed] = useState<{ clients: Record<string, unknown>[]; skipped: number; columnsDetected: string[]; warnings: string[] } | null>(null)
  const [importUploading, setImportUploading] = useState(false)
  const [importResult, setImportResult] = useState<{ ok: boolean; created?: number; updated?: number; duplicates?: number; errors?: number; error?: string } | null>(null)
  const [clientes, setClientes] = useState<ClienteCosmiatria[]>([])
  const [fichas, setFichas] = useState<FichaDermoCosmiatrica[]>([])
  const [query, setQuery] = useState("")
  const [filterSucursal, setFilterSucursal] = useState("todas")
  const [open, setOpen] = useState(false)
  const [viewing, setViewing] = useState<ClienteCosmiatria | null>(null)
  const [historialCliente, setHistorialCliente] = useState<ClienteCosmiatria | null>(null)
  const [historial, setHistorial] = useState<HistorialPayload | null>(null)
  const [historialLoading, setHistorialLoading] = useState(false)
  const [editing, setEditing] = useState<ClienteCosmiatria | null>(null)
  const [form, setForm] = useState<ClienteCosmiatria>(emptyCliente)
  const [sortKey, setSortKey] = useState<keyof ClienteCosmiatria>("Nombre")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<25 | 50 | 100 | 200>(50)
  const [total, setTotal] = useState(0)
  const [kpiClientes, setKpiClientes] = useState<number | null>(null)
  const [kpiActivos, setKpiActivos] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>("")
  const [debouncedQuery, setDebouncedQuery] = useState("")

  // Debounce de la búsqueda (la búsqueda es server-side ahora).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const sucursales = useMemo(() => {
    const fromDb = db.sucursales.map((item) => item.Nombre).filter(Boolean)
    return Array.from(new Set([...fromDb, "Rafael Vidal", "Los Jardines", "Villa Olga", "La Vega"]))
  }, [db.sucursales])

  // Carga de la PÁGINA actual (server-side). La tabla creció a ~16k filas por el
  // sync de AgendaPro; traer todo con `select *` excedía el timeout de 25s y la
  // pantalla mostraba 0. Ahora se pagina, busca y ordena en el servidor.
  const loadPage = useCallback(async (silent = false) => {
    const normalized = normalizeApiUrl(apiUrl)
    if (!silent) { setIsLoading(true); setLoadingMessage("Cargando clientes de cosmiatría...") }
    try {
      const sortCol = ({ Nombre: "nombre", Apellido: "apellido", Telefono: "telefono", Sucursal: "sucursal", Estado: "estado", Email: "email", DocumentoIdentidad: "documento_identidad", NumeroCliente: "numero_cliente" } as Record<string, string>)[String(sortKey)] || "nombre"
      const res = await apiJsonp(normalized, { action: "getClientesCosmiatriaPaged", page, pageSize, search: debouncedQuery, sucursal: filterSucursal, sort: sortCol, dir: sortDir })
      const rows = Array.isArray((res as { records?: unknown[] }).records)
        ? ((res as { records?: Record<string, unknown>[] }).records || [])
        : []
      setClientes(rows.map(normalizeCliente))
      setTotal(Number((res as { total?: number }).total) || 0)
      setErrorMsg("")
    } catch (error) {
      // NO ocultar el error como lista vacía: se muestra el detalle real.
      const msg = error instanceof Error ? error.message : "No se pudo consultar la tabla de clientes"
      setErrorMsg(msg)
      if (!silent) showToast(msg, "error")
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [apiUrl, page, pageSize, debouncedQuery, filterSucursal, sortKey, sortDir, showToast])

  // Fichas (pocas, para el conteo por fila) + KPIs globales por conteo.
  const loadAux = useCallback(async () => {
    const normalized = normalizeApiUrl(apiUrl)
    try {
      const [fichasResult, kpisResult] = await Promise.all([
        apiJsonp(normalized, { action: "getFichasDermatologia" }),
        apiJsonp(normalized, { action: "getClientesCosmiatriaKpis" }),
      ])
      const fichasRows = Array.isArray((fichasResult as { records?: unknown[] }).records)
        ? ((fichasResult as { records?: FichaDermoCosmiatrica[] }).records || [])
        : []
      setFichas(fichasRows)
      if ((kpisResult as { ok?: boolean }).ok) {
        setKpiClientes(Number((kpisResult as { clientes?: number }).clientes) || 0)
        setKpiActivos(Number((kpisResult as { activos?: number }).activos) || 0)
      }
    } catch { /* KPIs/fichas no bloquean la tabla */ }
  }, [apiUrl])

  // Recarga completa (tras crear/editar/eliminar/sincronizar).
  const loadData = useCallback(async () => { await Promise.all([loadPage(), loadAux()]) }, [loadPage, loadAux])

  useEffect(() => { void loadPage() }, [loadPage])
  useEffect(() => { void loadAux() }, [loadAux])

  // Auto-refresh silencioso cada 60s (se salta con diálogos abiertos).
  const refreshSilent = useCallback(async () => { await Promise.all([loadPage(true), loadAux()]) }, [loadPage, loadAux])
  useAutoRefresh(refreshSilent, {
    intervalMs: 60_000,
    skipWhen: () => open || !!viewing || !!historialCliente,
  })

  // Marca form abierto en el contador global (para pausar el auto-refresh
  // global del sistema cuando el usuario está capturando aquí).
  useEffect(() => {
    if (open) {
      incrementFormOpen()
      return () => decrementFormOpen()
    }
  }, [open, incrementFormOpen, decrementFormOpen])

  const enriched = useMemo(() => {
    return clientes.map((cliente) => {
      const related = fichas.filter((ficha) => fichaMatchesCliente(ficha, cliente))
      return {
        ...cliente,
        FichasCount: related.length,
        UltimaFicha: related.map((ficha) => ficha.fecha).sort().at(-1) || "",
      }
    })
  }, [clientes, fichas])

  // El servidor ya filtró (búsqueda/sucursal) y ordenó; `filtered` es la página
  // actual enriquecida con el conteo de fichas. `total` viene del servidor.
  const filtered = enriched
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered
  // "Con fichas" = clientes distintos con al menos una ficha (las fichas son
  // pocas y se cargan completas; enlazan por cliente_id).
  const conFichas = useMemo(
    () => new Set(fichas.map((f) => { const r = f as unknown as Record<string, unknown>; return String(r.cliente_id ?? r.clienteId ?? r.ClienteID ?? "") }).filter(Boolean)).size,
    [fichas],
  )

  // Reset a página 1 cuando cambian búsqueda/filtros/orden.
  useEffect(() => { setPage(1) }, [debouncedQuery, filterSucursal, sortKey, sortDir, pageSize])

  const setSort = (key: keyof ClienteCosmiatria) => {
    if (sortKey === key) setSortDir((current) => current === "asc" ? "desc" : "asc")
    else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const sortLabel = (key: keyof ClienteCosmiatria) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"

  const update = (patch: Partial<ClienteCosmiatria>) => setForm((current) => ({ ...current, ...patch }))

  const openNew = () => {
    setEditing(null)
    const numero = nextClientNumber(clientes)
    setForm({ ...emptyCliente, ClienteID: `cli_${Date.now()}`, NumeroCliente: numero, ClienteDesde: today })
    setOpen(true)
  }

  const openEdit = (cliente: ClienteCosmiatria) => {
    setEditing(cliente)
    setForm(cliente)
    setOpen(true)
  }

  const saveCliente = async () => {
    if (!form.Nombre || !form.Telefono || !form.Sucursal) {
      showToast("Nombre, teléfono y sucursal son obligatorios", "error")
      return
    }
    // Dedupe check: si ya existe un cliente con el mismo teléfono,
    // documento o nombre, bloqueamos en vez de duplicar. En edición
    // excluimos el propio cliente por ClienteID (un cliente no es
    // duplicado de sí mismo). Multi-tenant: `clientes` viene filtrado
    // por business_id desde el backend (AsyncLocalStorage).
    const match = findExistingClienteMatch(
      { Nombre: form.Nombre, Apellido: form.Apellido, Telefono: form.Telefono, DocumentoIdentidad: form.DocumentoIdentidad },
      clientes,
      editing ? form.ClienteID : undefined,
    )
    if (match) {
      const existente = `${match.cliente.Nombre} ${match.cliente.Apellido || ""}`.trim()
      const detalle = [displayPhone(match.cliente.Telefono), displayDocumento(match.cliente.DocumentoIdentidad), match.cliente.Sucursal]
        .filter(Boolean)
        .join(" · ")
      showToast(`${match.message} Cliente existente: ${existente}${detalle ? " (" + detalle + ")" : ""}`, "error")
      return
    }
    // Limpiar dirección antes de persistir — evita guardar
    // "santiago, santiago, santaigo" en el catálogo.
    const direccionLimpia = normalizeAddress(form.Direccion)
    const payload = {
      ...form,
      Direccion: direccionLimpia,
      ClienteID: form.ClienteID || `cli_${Date.now()}`,
      NumeroCliente: form.NumeroCliente || nextClientNumber(clientes),
    }
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "saveClienteCosmiatria",
        data: JSON.stringify(payload),
      })
      const typed = result as { ok?: boolean; code?: string; error?: string }
      if (typed?.ok === false && typed.code === "duplicate") {
        showToast(typed.error || "Este cliente ya existe en el sistema.", "error")
        await loadData()
        return
      }
      if (!typed?.ok) throw new Error(String(typed?.error || "No se pudo guardar"))
      await loadData()
      setOpen(false)
      showToast(editing ? "Cliente actualizado" : "Cliente creado correctamente", "success")
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error guardando cliente", "error")
    }
  }

  const loadAgendaProStatus = useCallback(async () => {
    try {
      const { supabaseBrowser } = await import("@/lib/supabase-client")
      const { data: { session } } = await supabaseBrowser.auth.getSession()
      const headers: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
      const qs = activeBusinessId ? `?activeBusinessId=${encodeURIComponent(activeBusinessId)}` : ""
      const r = await fetch(`/api/integrations/agendapro/status${qs}`, { headers })
      const j = await r.json()
      if (j?.ok) {
        setAgendaProStatus({
          ready: Boolean(j.credentials?.configured),
          pending: j.credentials?.configured ? null : "AgendaPro no está configurado para este negocio.",
          lastSync: j.lastSync,
        })
      }
    } catch { /* ignore */ }
  }, [activeBusinessId])
  useEffect(() => { void loadAgendaProStatus() }, [loadAgendaProStatus])

  // Auto-sync INCREMENTAL al entrar al menú: trae en segundo plano los clientes
  // nuevos de AgendaPro (se detiene al llegar a los ya sincronizados). Con
  // throttle por negocio para no golpear AgendaPro en cada navegación. Silencioso.
  const autoSyncOnEnter = useCallback(async () => {
    if (!activeBusinessId || agendaProSyncing) return
    const last = lastAutoAgendaProSyncAt.get(activeBusinessId) || 0
    if (Date.now() - last < AUTO_AGENDAPRO_SYNC_THROTTLE_MS) return
    lastAutoAgendaProSyncAt.set(activeBusinessId, Date.now())
    setAgendaProSyncing(true)
    setAgendaProProgress(null)
    try {
      const { data: { session } } = await import("@/lib/supabase-client").then((m) => m.supabaseBrowser.auth.getSession())
      if (!session?.access_token) return
      const acc = await runIncrementalAgendaProSync({
        activeBusinessId,
        authHeaders: { Authorization: `Bearer ${session.access_token}` },
        onProgress: (p) => setAgendaProProgress({ read: p.read, created: p.created }),
      })
      if ((acc.created || 0) > 0) {
        await loadData()
        showToast(`AgendaPro: ${acc.created} cliente(s) nuevo(s) importado(s).`, "success")
      }
    } catch { /* silencioso: es una actualización en segundo plano */ } finally {
      setAgendaProSyncing(false)
      setAgendaProProgress(null)
      void loadAgendaProStatus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBusinessId])

  // Dispara el auto-sync cuando ya sabemos que AgendaPro está configurado.
  useEffect(() => {
    if (agendaProStatus?.ready) void autoSyncOnEnter()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agendaProStatus?.ready, activeBusinessId])

  const handleAgendaProSync = () => {
    setImportFile(null)
    setImportParsed(null)
    setImportResult(null)
    setImportOpen(true)
  }

  // Sincronización INCREMENTAL contra la API de AgendaPro desde la barra superior.
  // Trae solo los clientes NUEVOS desde la última sincronización (se detiene al
  // llegar a los ya sincronizados) — no relee todos los clientes cada vez. Para
  // la migración inicial completa está "Sincronizar todos" en Configurar AgendaPro.
  const runApiSyncDirect = async () => {
    if (agendaProSyncing) return
    if (agendaProStatus && agendaProStatus.ready === false) {
      showToast("No hay credenciales AgendaPro configuradas para este negocio.", "error")
      return
    }
    setAgendaProSyncing(true)
    setAgendaProProgress(null)
    try {
      const { data: { session } } = await import("@/lib/supabase-client").then((m) => m.supabaseBrowser.auth.getSession())
      if (!session?.access_token) throw new Error("Sesión no válida — vuelve a iniciar sesión")
      const acc = await runIncrementalAgendaProSync({
        activeBusinessId,
        authHeaders: { Authorization: `Bearer ${session.access_token}` },
        onProgress: (p) => setAgendaProProgress({ read: p.read, created: p.created }),
      })
      if (acc.error) { showToast(acc.error, "error"); return }
      showToast(
        acc.created > 0
          ? `Sincronización: ${acc.created} clientes nuevos · ${acc.updated} actualizados.`
          : "AgendaPro al día — no hay clientes nuevos.",
        acc.errors > 0 ? "info" : "success",
      )
      if (acc.created > 0 || acc.updated > 0) await loadData()
    } catch (syncErr) {
      showToast(syncErr instanceof Error ? syncErr.message : "Error al sincronizar AgendaPro", "error")
    } finally {
      setAgendaProSyncing(false)
      setAgendaProProgress(null)
      void loadAgendaProStatus()
    }
  }

  const handleImportFile = async (file: File) => {
    setImportFile(file)
    setImportUploading(true)
    setImportParsed(null)
    try {
      const result = await parseAgendaProClientsExcel(file)
      setImportParsed(result as { clients: Record<string, unknown>[]; skipped: number; columnsDetected: string[]; warnings: string[] })
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al procesar el archivo", "error")
    } finally {
      setImportUploading(false)
    }
  }

  const handleImportSubmit = async () => {
    if (!importParsed?.clients.length) return
    setImportUploading(true)
    try {
      const { data: { session } } = await import("@/lib/supabase-client").then((m) => m.supabaseBrowser.auth.getSession())
      if (!session?.access_token) throw new Error("Sesión no válida — vuelve a iniciar sesión")
      const res = await fetch("/api/integrations/agendapro/import-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ clients: importParsed.clients, activeBusinessId }),
      })
      const data = await res.json() as { ok?: boolean; created?: number; updated?: number; duplicates?: number; errors?: number; error?: string }
      setImportResult({ ok: data.ok === true, created: data.created, updated: data.updated, duplicates: data.duplicates, errors: data.errors, error: data.error })
      if (data.ok) await loadData()
    } catch (err) {
      setImportResult({ ok: false, error: err instanceof Error ? err.message : "Error al importar" })
    } finally {
      setImportUploading(false)
    }
  }

  const deleteCliente = async (cliente: ClienteCosmiatria) => {
    if (!confirm(`¿Eliminar cliente ${cliente.Nombre} ${cliente.Apellido}?`)) return
    try {
      await apiJsonp(normalizeApiUrl(apiUrl), { action: "deleteClienteCosmiatria", id: cliente.ClienteID })
      setClientes((current) => current.filter((item) => item.ClienteID !== cliente.ClienteID))
      showToast("Cliente eliminado", "success")
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo eliminar", "error")
    }
  }

  const exportCsv = () => {
    const headers = ["ClienteID", "Nombre", "Apellido", "Telefono", "Telefono2", "DocumentoIdentidad", "Email", "Sucursal", "Ciudad", "Genero", "FichasCount"]
    const csv = [
      headers.join(","),
      ...filtered.map((cliente) => headers.map((key) => `"${String(cliente[key as keyof ClienteCosmiatria] ?? "").replaceAll('"', '""')}"`).join(",")),
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `clientes-cosmiatria-${today}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const relatedFichas = viewing ? fichas.filter((ficha) => fichaMatchesCliente(ficha, viewing)) : []

  const openHistorial = useCallback(async (cliente: ClienteCosmiatria) => {
    setHistorialCliente(cliente)
    setHistorial(null)
    setHistorialLoading(true)
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "getClienteHistorial",
        clienteId: cliente.ClienteID,
      }) as {
        ok?: boolean
        fichas?: HistorialPayload["fichas"]
        consentMasajes?: HistorialPayload["consentMasajes"]
        consentTatuajesCejas?: HistorialPayload["consentTatuajesCejas"]
        sesionesPulse?: HistorialPayload["sesionesPulse"]
      }
      if (!result?.ok) throw new Error("No se pudo cargar el historial")
      setHistorial({
        fichas: Array.isArray(result.fichas) ? result.fichas : [],
        consentMasajes: Array.isArray(result.consentMasajes) ? result.consentMasajes : [],
        consentTatuajesCejas: Array.isArray(result.consentTatuajesCejas) ? result.consentTatuajesCejas : [],
        sesionesPulse: Array.isArray(result.sesionesPulse) ? result.sesionesPulse : [],
      })
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al cargar historial", "error")
    } finally {
      setHistorialLoading(false)
    }
  }, [apiUrl, showToast])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Clientes de Cosmiatría</h2>
          <p className="text-sm text-muted-foreground">Base de datos relacionada con fichas dermatológicas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditClientes ? (
            <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Descargar datos</Button>
          ) : null}
          {sessionUser ? (
            <Button variant="outline" onClick={() => setAgendaProConfigOpen(true)}>
              <PlugZap className="mr-2 h-4 w-4" />Configurar AgendaPro
            </Button>
          ) : null}
          {canSyncAgendaPro ? (
            <Button variant="outline" onClick={handleAgendaProSync} disabled={agendaProSyncing}>
              {agendaProSyncing
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RefreshCw className="mr-2 h-4 w-4" />}
              {agendaProSyncing ? "Sincronizando…" : "Sincronizar AgendaPro"}
            </Button>
          ) : null}
          {canMerge ? (
            <Button variant="outline" onClick={() => setMergeOpen(true)}>
              <Users className="mr-2 h-4 w-4" />Unificar clientes
            </Button>
          ) : null}
          {canSyncApi ? (
            <Button variant="secondary" onClick={runApiSyncDirect} disabled={agendaProSyncing}>
              {agendaProSyncing
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RefreshCw className="mr-2 h-4 w-4" />}
              {agendaProSyncing ? "Sincronizando…" : "Sincronizar directamente con la API"}
            </Button>
          ) : null}
          {canEditClientes ? (
            <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Nuevo cliente</Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <span className="font-semibold">AgendaPro:</span>
        {agendaProStatus?.ready
          ? <Badge variant="outline" className="bg-green-500/15 text-green-600 border-green-300">Conectado</Badge>
          : <Badge variant="outline" className="bg-amber-500/15 text-amber-700 border-amber-300">{agendaProStatus?.pending || "No configurado para este negocio"}</Badge>}
        {agendaProStatus?.lastSync ? (
          <span className="text-muted-foreground">
            Última sync: {new Date(agendaProStatus.lastSync.finished_at || agendaProStatus.lastSync.started_at || "").toLocaleString("es-DO")} · {agendaProStatus.lastSync.created ?? 0} nuevos · {agendaProStatus.lastSync.updated ?? 0} actualizados{agendaProStatus.lastSync.errors ? ` · ${agendaProStatus.lastSync.errors} errores` : ""}
          </span>
        ) : <span className="text-muted-foreground">Sin sincronizaciones todavía</span>}
        {agendaProProgress && (
          <span className="flex items-center gap-1 text-teal-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Sincronizando… {agendaProProgress.read} leídos · {agendaProProgress.created} nuevos
          </span>
        )}
        <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-xs" onClick={() => setAgendaProConfigOpen(true)}>
          <PlugZap className="mr-1 h-3.5 w-3.5" />Configurar
        </Button>
      </div>

      <MergeClientesDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        clientes={clientes}
        onMerged={() => { void loadData() }}
      />

      <AgendaProConfigDialog
        open={agendaProConfigOpen}
        onOpenChange={setAgendaProConfigOpen}
        onSynced={() => { void loadData(); void loadAgendaProStatus() }}
      />

      {errorMsg ? (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="flex items-start gap-3 pt-5 text-sm">
            <span className="mt-0.5 text-red-600">⚠</span>
            <div>
              <div className="font-semibold text-red-700">Error al cargar clientes</div>
              <div className="mt-1 text-red-600">{errorMsg}</div>
              <div className="mt-1 text-[11px] text-red-500">Recurso: clientes cosmiatría · {new Date().toLocaleString("es-DO")}</div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="pt-5"><div className="text-sm text-muted-foreground">Clientes</div><div className="text-3xl font-bold">{kpiClientes ?? "—"}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-sm text-muted-foreground">Activos</div><div className="text-3xl font-bold text-green-500">{kpiActivos ?? "—"}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-sm text-muted-foreground">Con fichas</div><div className="text-3xl font-bold text-primary">{conFichas}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-sm text-muted-foreground">Fichas</div><div className="text-3xl font-bold">{fichas.length}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-[1fr_220px]">
          <div>
            <Label>Buscar por nombre, teléfono o documento</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ej: María, 809, Rafael Vidal..." />
            </div>
          </div>
          <div>
            <Label>Sucursal</Label>
            <Select value={filterSucursal} onValueChange={setFilterSucursal}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {sucursales.map((sucursal) => <SelectItem key={sucursal} value={sucursal}>{sucursal}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="border-b">
                <th className="w-12 px-3 py-3 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground">#</th>
                <th className="cursor-pointer px-3 py-3 text-left text-xs" onClick={() => setSort("Nombre")}>Cliente{sortLabel("Nombre")}</th>
                <th className="cursor-pointer px-3 py-3 text-left text-xs" onClick={() => setSort("Telefono")}>Teléfono{sortLabel("Telefono")}</th>
                <th className="cursor-pointer px-3 py-3 text-left text-xs" onClick={() => setSort("DocumentoIdentidad")}>Documento{sortLabel("DocumentoIdentidad")}</th>
                <th className="cursor-pointer px-3 py-3 text-left text-xs" onClick={() => setSort("Sucursal")}>Sucursal{sortLabel("Sucursal")}</th>
                <th className="px-3 py-3 text-center text-xs">Origen</th>
                <th className="cursor-pointer px-3 py-3 text-left text-xs" onClick={() => setSort("ClienteDesde")}>Desde{sortLabel("ClienteDesde")}</th>
                <th className="px-3 py-3 text-center text-xs">Fichas</th>
                <th className="px-3 py-3 text-center text-xs">Estado</th>
                <th className="px-3 py-3 text-right text-xs">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} className="py-12 text-center text-muted-foreground">No hay clientes registrados</td></tr>
              ) : paginated.map((cliente, seqIndex) => (
                <tr
                  key={cliente.ClienteID}
                  className="cursor-pointer border-b hover:bg-muted/20"
                  onClick={() => setViewing(cliente)}
                >
                  <td className="px-3 py-3 text-center"><SeqBadge n={(safePage - 1) * pageSize + seqIndex + 1} /></td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary"><UserRound className="h-4 w-4" /></div>
                      <div>
                        <div className="font-semibold">{cliente.Nombre} {cliente.Apellido}</div>
                        <div className="text-xs text-muted-foreground">{cliente.Email || "Sin email"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">{displayPhone(cliente.Telefono)}</td>
                  <td className="px-3 py-3">{displayDocumento(cliente.DocumentoIdentidad) || "—"}</td>
                  <td className="px-3 py-3">{cliente.Sucursal || "—"}</td>
                  <td className="px-3 py-3 text-center"><Badge variant="outline" className={cliente.Origen === "AgendaPro" ? "bg-violet-500/15 text-violet-600 border-violet-300" : "text-muted-foreground"}>{cliente.Origen || "Manual"}</Badge></td>
                  <td className="px-3 py-3 text-xs">{cliente.ClienteDesde || "—"}</td>
                  <td className="px-3 py-3 text-center"><Badge variant="outline">{cliente.FichasCount || 0}</Badge></td>
                  <td className="px-3 py-3 text-center"><Badge className={cliente.Estado === "Activo" ? "bg-green-500/15 text-green-500" : ""}>{cliente.Estado}</Badge></td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <RecordActions
                      title={`Cliente: ${cliente.Nombre} ${cliente.Apellido}`}
                      record={clienteRecord(cliente)}
                      onEdit={canEditClientes ? () => openEdit(cliente) : undefined}
                      onDelete={canEditClientes ? () => deleteCliente(cliente) : undefined}
                      printTitle={`Cliente Cosmiatría - ${cliente.Nombre} ${cliente.Apellido}`}
                    />
                    <div className="mt-1 flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setViewing(cliente)}>
                        <CalendarDays className="mr-1 h-3.5 w-3.5" />Fichas
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void openHistorial(cliente)}>
                        <History className="mr-1 h-3.5 w-3.5" />Historial
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
              <div className="text-muted-foreground">
                Mostrando <b>{(safePage - 1) * pageSize + 1}</b>–<b>{Math.min(safePage * pageSize, total)}</b> de <b>{total}</b>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Por página</label>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as 25 | 50 | 100 | 200)}
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
                <Button size="sm" variant="outline" onClick={() => setPage(1)} disabled={safePage === 1}>«</Button>
                <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>‹</Button>
                <span className="text-xs">Página <b>{safePage}</b> de <b>{totalPages}</b></span>
                <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>›</Button>
                <Button size="sm" variant="outline" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}>»</Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[94vh] w-[94vw] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
          </DialogHeader>
          {/* Alta rápida — solo 6 campos. Los campos extendidos (apellido,
              fecha nac, edad, telefono2, género, localidad, ciudad, región,
              cliente desde, estado, notas) se mantienen en el state y NO se
              pierden al editar — siguen llegando al backend desde form.
              Si en el futuro se necesita capturarlos, se agregan otra vez
              aquí o se hace un modal "avanzado" separado. */}
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div>
              <Label>Nombre *</Label>
              <Input value={form.Nombre} onChange={(event) => update({ Nombre: event.target.value.toUpperCase() })} className="mt-1" />
            </div>
            <div>
              <Label>Teléfono *</Label>
              <Input value={form.Telefono} onChange={(event) => update({ Telefono: formatPhone(event.target.value) })} className="mt-1" />
            </div>
            <div>
              <Label>Cédula / Documento</Label>
              <Input value={form.DocumentoIdentidad} onChange={(event) => update({ DocumentoIdentidad: formatCedula(event.target.value) })} className="mt-1" />
            </div>
            <div>
              <Label>Correo</Label>
              <Input type="email" value={form.Email} onChange={(event) => update({ Email: event.target.value })} className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <Label>Dirección</Label>
              <Input
                value={form.Direccion}
                onChange={(event) => update({ Direccion: event.target.value })}
                onBlur={(event) => update({ Direccion: normalizeAddress(event.target.value) })}
                placeholder="Calle, sector, ciudad"
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Sucursal *</Label>
              <Select value={form.Sucursal} onValueChange={(value) => update({ Sucursal: value })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>{sucursales.map((sucursal) => <SelectItem key={sucursal} value={sucursal}>{sucursal}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={saveCliente} disabled={!form.Nombre || !form.Telefono || !form.Sucursal}>
              {editing ? "Guardar cliente" : "Crear cliente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(value) => { if (!value) setViewing(null) }}>
        <DialogContent className="max-h-[92vh] w-[92vw] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>Fichas de {viewing?.Nombre} {viewing?.Apellido}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {relatedFichas.length === 0 ? (
              <div className="rounded-lg border p-6 text-center text-muted-foreground">Este cliente aún no tiene fichas dermatológicas relacionadas.</div>
            ) : relatedFichas.map((ficha) => (
              <Card key={ficha.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
                  <div>
                    <div className="font-semibold">{ficha.fecha} · {ficha.estado}</div>
                    <div className="text-sm text-muted-foreground">{ficha.sucursal} · {ficha.operadora}</div>
                    <div className="mt-1 text-sm">{ficha.motivoConsulta}</div>
                  </div>
                  <Badge variant="outline">{ficha.firma ? "Firmada" : "Sin firma"}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* HISTORIAL COMPLETO: ficha + consentimientos masajes + consentimientos tatuajes/cejas. */}
      <Dialog open={!!historialCliente} onOpenChange={(value) => { if (!value) { setHistorialCliente(null); setHistorial(null) } }}>
        <DialogContent className="max-h-[92vh] w-[94vw] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Historial de {historialCliente?.Nombre} {historialCliente?.Apellido}</DialogTitle>
          </DialogHeader>

          {historialLoading ? (
            <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">Cargando historial…</div>
          ) : historial ? (
            <div className="space-y-6">
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
                  <FileText className="h-4 w-4 text-cyan-500" />
                  Fichas dermatológicas <Badge variant="outline">{historial.fichas.length}</Badge>
                </h3>
                {historial.fichas.length === 0 ? (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">Sin fichas registradas.</div>
                ) : (
                  <div className="grid gap-2">
                    {historial.fichas.map((f) => (
                      <Card key={f.id}>
                        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
                          <div>
                            <div className="font-semibold">{f.fecha} · {f.estado}</div>
                            <div className="text-xs text-muted-foreground">{f.sucursal} · {f.operadora}</div>
                            {f.motivoConsulta ? <div className="mt-1 text-sm">{f.motivoConsulta}</div> : null}
                          </div>
                          <Badge variant="outline" className="font-mono text-[10px]">{f.id}</Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
                  <FileSignature className="h-4 w-4 text-emerald-500" />
                  Consentimientos · Masajes <Badge variant="outline">{historial.consentMasajes.length}</Badge>
                </h3>
                {historial.consentMasajes.length === 0 ? (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">Sin consentimientos de masajes.</div>
                ) : (
                  <div className="grid gap-2">
                    {historial.consentMasajes.map((c) => (
                      <Card key={c.id}>
                        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
                          <div>
                            <div className="font-semibold">{c.fecha} · {c.estado}</div>
                            <div className="text-xs text-muted-foreground">
                              {c.sucursal} {c.tipoMasaje ? `· ${c.tipoMasaje}` : ""} {c.zonaTratar ? `· ${c.zonaTratar}` : ""}
                            </div>
                            {c.nombreEspecialista ? <div className="text-xs text-muted-foreground">Especialista: {c.nombreEspecialista}</div> : null}
                          </div>
                          <Badge variant="outline" className="font-mono text-[10px]">{c.id}</Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
                  <FileSignature className="h-4 w-4 text-pink-500" />
                  Consentimientos · Eliminación de tatuajes y cejas <Badge variant="outline">{historial.consentTatuajesCejas.length}</Badge>
                </h3>
                {historial.consentTatuajesCejas.length === 0 ? (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">Sin consentimientos de tatuajes/cejas.</div>
                ) : (
                  <div className="grid gap-2">
                    {historial.consentTatuajesCejas.map((c) => (
                      <Card key={c.id}>
                        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
                          <div>
                            <div className="font-semibold">{c.fecha} · {c.estado}</div>
                            <div className="text-xs text-muted-foreground">
                              {c.sucursal} {c.tipoProcedimiento ? `· ${c.tipoProcedimiento}` : ""} {c.zonaTratar ? `· ${c.zonaTratar}` : ""}
                            </div>
                            {c.nombreEspecialista ? <div className="text-xs text-muted-foreground">Especialista: {c.nombreEspecialista}</div> : null}
                          </div>
                          <Badge variant="outline" className="font-mono text-[10px]">{c.id}</Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
                  <Zap className="h-4 w-4 text-cyan-500" />
                  Sesiones PulseControl <Badge variant="outline">{historial.sesionesPulse.length}</Badge>
                  <span className="text-[10px] font-normal normal-case text-muted-foreground/70">(coincidencia por nombre)</span>
                </h3>
                {historial.sesionesPulse.length === 0 ? (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">Sin sesiones PulseControl asociadas.</div>
                ) : (
                  <div className="grid gap-2">
                    {historial.sesionesPulse.slice(0, 30).map((s) => (
                      <Card key={s.SesionID}>
                        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
                          <div>
                            <div className="font-semibold">{s.Fecha} {s.AreaTrabajada ? `· ${s.AreaTrabajada}` : ""}</div>
                            <div className="text-xs text-muted-foreground">
                              {s.Sucursal} {s.Cabina ? `· ${s.Cabina}` : ""} {s.EquipoID ? `· Eq. ${s.EquipoID}` : ""} {s.OperadoraID ? `· ${s.OperadoraID}` : ""}
                            </div>
                          </div>
                          {typeof s.DisparosReportados === "number" ? (
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {s.DisparosReportados.toLocaleString("es-DO")} disparos
                            </Badge>
                          ) : null}
                        </CardContent>
                      </Card>
                    ))}
                    {historial.sesionesPulse.length > 30 ? (
                      <div className="text-center text-xs text-muted-foreground">
                        Mostrando 30 de {historial.sesionesPulse.length}
                      </div>
                    ) : null}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Import AgendaPro Excel ─────────────────────────────────────────── */}
      <Dialog
        open={importOpen}
        onOpenChange={(o) => {
          if (!importUploading) {
            setImportOpen(o)
            if (!o) { setImportFile(null); setImportParsed(null); setImportResult(null) }
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              Importar clientes desde AgendaPro
            </DialogTitle>
          </DialogHeader>

          {/* Estado 3: resultado final */}
          {importResult ? (
            <div className="space-y-4">
              {importResult.ok ? (
                <>
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    <p className="font-bold">Importación completada</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 rounded-xl border bg-slate-50 p-4 text-sm">
                    <div>Clientes nuevos: <strong className="text-emerald-700">{importResult.created ?? 0}</strong></div>
                    <div>Actualizados: <strong className="text-cyan-700">{importResult.updated ?? 0}</strong></div>
                    <div>Duplicados omitidos: <strong className="text-slate-500">{importResult.duplicates ?? 0}</strong></div>
                    <div>Errores: <strong className="text-rose-600">{importResult.errors ?? 0}</strong></div>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
                  <p className="font-bold">Error al importar</p>
                  <p className="mt-1 text-sm">{importResult.error}</p>
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => { setImportOpen(false); setImportFile(null); setImportParsed(null); setImportResult(null) }}>Cerrar</Button>
              </DialogFooter>
            </div>
          ) : importParsed ? (
            /* Estado 2: preview de clientes detectados */
            <div className="space-y-3">
              <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                <span className="font-bold text-emerald-700">{importParsed.clients.length}</span> clientes listos para importar
                {importParsed.skipped > 0 && (
                  <span className="text-muted-foreground"> · {importParsed.skipped} filas vacías omitidas</span>
                )}
              </div>
              {importParsed.warnings.length > 0 && (
                <div className="space-y-1">
                  {importParsed.warnings.map((w, wi) => (
                    <p key={wi} className="text-xs text-amber-600">⚠ {w}</p>
                  ))}
                </div>
              )}
              {/* Preview table */}
              <div className="max-h-44 overflow-auto rounded-lg border text-xs">
                <table className="w-full">
                  <thead className="sticky top-0 bg-slate-100">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-bold">Nombre</th>
                      <th className="px-2 py-1.5 text-left font-bold">Teléfono</th>
                      <th className="px-2 py-1.5 text-left font-bold">Documento</th>
                      <th className="px-2 py-1.5 text-left font-bold">Sucursal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importParsed.clients.slice(0, 8).map((c, ci) => (
                      <tr key={ci} className="border-t">
                        <td className="px-2 py-1">{[String(c.first_name ?? ""), String(c.last_name ?? "")].filter(Boolean).join(" ") || "—"}</td>
                        <td className="px-2 py-1 font-mono">{String(c.phone ?? "") || "—"}</td>
                        <td className="px-2 py-1 font-mono">{String(c.identification_number ?? "") || "—"}</td>
                        <td className="px-2 py-1">{String(c.location_name ?? "") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importParsed.clients.length > 8 && (
                  <p className="p-2 text-center text-muted-foreground">… y {importParsed.clients.length - 8} más</p>
                )}
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => { setImportFile(null); setImportParsed(null) }}>
                  Cambiar archivo
                </Button>
                <Button onClick={() => void handleImportSubmit()} disabled={importUploading}>
                  {importUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {importUploading ? "Importando…" : `Importar ${importParsed.clients.length} clientes`}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            /* Estado 1: selector de archivo */
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Exporta el listado de clientes desde AgendaPro y sube el archivo aquí.
                El sistema detectará automáticamente las columnas (nombre, teléfono, cédula, email, sucursal…).
              </p>
              <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 text-center transition-colors hover:border-primary/40 hover:bg-primary/5">
                {importUploading
                  ? <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  : <Upload className="h-10 w-10 text-slate-400" />}
                <div>
                  <p className="text-sm font-bold">{importUploading ? "Procesando…" : "Haz clic para seleccionar archivo"}</p>
                  <p className="text-xs text-muted-foreground">Excel (.xlsx, .xls) o CSV — exportado desde AgendaPro</p>
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="sr-only"
                  disabled={importUploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f) }}
                />
              </label>
              {/* Opción API si está configurada */}
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="text-xs font-bold text-muted-foreground">¿Tienes la API de AgendaPro configurada?</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 gap-1.5 text-xs text-muted-foreground"
                  disabled={agendaProSyncing}
                  onClick={async () => {
                    setImportOpen(false)
                    await runApiSyncDirect()
                  }}
                >
                  <RefreshCw className="h-3 w-3" />
                  Sincronizar directamente con la API
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
