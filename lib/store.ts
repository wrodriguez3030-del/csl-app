"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { supabaseBrowser } from "./supabase-client"
import type {
  Database,
  DatabasePulsos,
  Sucursal,
  Equipo,
  Tecnico,
  Reporte,
  PiezaCatalogo,
  TabId,
  PiezaIntervenida,
  Operadora,
  LecturaSemanal,
  SesionCliente,
} from "./types"

interface AppState {
  apiUrl: string
  setApiUrl: (url: string) => void
  isConnected: boolean
  setIsConnected: (connected: boolean) => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  loadingMessage: string
  setLoadingMessage: (message: string) => void
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  pulsosSectionOpen: boolean
  setPulsosSectionOpen: (open: boolean) => void
  db: Database
  setDb: (db: Database) => void
  dbPulsos: DatabasePulsos
  setDbPulsos: (db: DatabasePulsos) => void
  piezasReporte: PiezaIntervenida[]
  setPiezasReporte: (piezas: PiezaIntervenida[]) => void
  addPiezaReporte: (pieza: PiezaIntervenida) => void
  removePiezaReporte: (index: number) => void
  clearPiezasReporte: () => void
  editingSucursal: Sucursal | null
  setEditingSucursal: (sucursal: Sucursal | null) => void
  editingEquipo: Equipo | null
  setEditingEquipo: (equipo: Equipo | null) => void
  editingTecnico: Tecnico | null
  setEditingTecnico: (tecnico: Tecnico | null) => void
  editingReporte: Reporte | null
  setEditingReporte: (reporte: Reporte | null) => void
  editingOperadora: Operadora | null
  setEditingOperadora: (op: Operadora | null) => void
  editingLectura: LecturaSemanal | null
  setEditingLectura: (l: LecturaSemanal | null) => void
  editingSesion: SesionCliente | null
  setEditingSesion: (s: SesionCliente | null) => void
  toast: { message: string; type: "success" | "error" | "info" } | null
  showToast: (message: string, type?: "success" | "error" | "info") => void
  hideToast: () => void
  // ---- estado de sincronización (auto-refresh) ----
  /** Timestamp en ms de la última sincronización exitosa con el backend. */
  lastSyncAt: number | null
  setLastSyncAt: (when: number | null) => void
  /** Bandera para indicar que hay una sincronización en curso. */
  isSyncing: boolean
  setIsSyncing: (syncing: boolean) => void
  /**
   * Conteo de formularios abiertos en cualquier módulo. La auto-refresh
   * lee este número y se salta si > 0 para no interferir con captura.
   */
  formOpenCount: number
  incrementFormOpen: () => void
  decrementFormOpen: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      apiUrl: "/api/csl",
      setApiUrl: (url) => set({ apiUrl: url }),
      isConnected: false,
      setIsConnected: (connected) => set({ isConnected: connected }),
      isLoading: false,
      setIsLoading: (loading) => set({ isLoading: loading }),
      loadingMessage: "Cargando datos...",
      setLoadingMessage: (message) => set({ loadingMessage: message }),
      activeTab: "config",
      setActiveTab: (tab) => set({ activeTab: tab }),
      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      pulsosSectionOpen: false,
      setPulsosSectionOpen: (open) => set({ pulsosSectionOpen: open }),
      db: { sucursales: [], equipos: [], reportes: [], piezas: [], tecnicos: [] },
      setDb: (db) => set({ db }),
      dbPulsos: { operadoras: [], lecturasSemanales: [], sesionesCliente: [], auditoriasSemanales: [] },
      setDbPulsos: (dbPulsos) => set({ dbPulsos }),
      piezasReporte: [],
      setPiezasReporte: (piezas) => set({ piezasReporte: piezas }),
      addPiezaReporte: (pieza) => set((state) => ({ piezasReporte: [...state.piezasReporte, pieza] })),
      removePiezaReporte: (index) => set((state) => ({ piezasReporte: state.piezasReporte.filter((_, i) => i !== index) })),
      clearPiezasReporte: () => set({ piezasReporte: [] }),
      editingSucursal: null,
      setEditingSucursal: (sucursal) => set({ editingSucursal: sucursal }),
      editingEquipo: null,
      setEditingEquipo: (equipo) => set({ editingEquipo: equipo }),
      editingTecnico: null,
      setEditingTecnico: (tecnico) => set({ editingTecnico: tecnico }),
      editingReporte: null,
      setEditingReporte: (reporte) => set({ editingReporte: reporte }),
      editingOperadora: null,
      setEditingOperadora: (op) => set({ editingOperadora: op }),
      editingLectura: null,
      setEditingLectura: (l) => set({ editingLectura: l }),
      editingSesion: null,
      setEditingSesion: (s) => set({ editingSesion: s }),
      toast: null,
      showToast: (message, type = "info") => {
        set({ toast: { message, type } })
        setTimeout(() => set({ toast: null }), 3000)
      },
      hideToast: () => set({ toast: null }),
      lastSyncAt: null,
      setLastSyncAt: (when) => set({ lastSyncAt: when }),
      isSyncing: false,
      setIsSyncing: (syncing) => set({ isSyncing: syncing }),
      formOpenCount: 0,
      incrementFormOpen: () => set((state) => ({ formOpenCount: state.formOpenCount + 1 })),
      decrementFormOpen: () => set((state) => ({ formOpenCount: Math.max(0, state.formOpenCount - 1) })),
    }),
    {
      // v2: invalida cualquier cache pre-multitenant que tenía db.sucursales
      // del CSL user en el localStorage del browser. Si un Depicenter user
      // entra con la storage vieja, sigue viendo CSL hasta el refresh —
      // bug observado el 2026-05-22. El bump de nombre garantiza que el
      // browser empiece limpio post-deploy.
      name: "csl-maintenance-storage-v2",
      // NO persistimos db ni dbPulsos: en multi-tenant cada user puede tener
      // datos distintos, y persistir lleva a fugas cross-tenant entre logins.
      // El handleRefresh en app/page.tsx carga db fresca tras login.
      partialize: (state) => ({
        apiUrl: "/api/csl",
        activeTab: state.activeTab,
        pulsosSectionOpen: state.pulsosSectionOpen,
      }),
    }
  )
)

export function normalizeApiUrl(url: string): string {
  const normalized = (url || "").trim()
  if (!normalized || /script\.google\.com|\/macros\/s\//.test(normalized)) return "/api/csl"
  return normalized.replace(/\/+$/, "") || "/api/csl"
}

// =====================================================
// API - llamada autenticada a /api/csl
// =====================================================

/**
 * Llamada autenticada al endpoint principal `/api/csl`.
 *
 * El parámetro `apiUrl` es **legado** del backend Google Apps Script: hoy el
 * endpoint es siempre `/api/csl` (lo aplica `normalizeApiUrl`).  Mantener el
 * parámetro evita refactorizar 30+ call-sites; pasar cualquier string es
 * indistinto.
 */
export async function apiCall(
  apiUrl: string,
  params: Record<string, string | number | boolean>
): Promise<Record<string, unknown>> {
  const endpoint = normalizeApiUrl(apiUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)

  try {
    const {
      data: { session },
    } = await supabaseBrowser.auth.getSession()

    if (!session?.access_token) {
      throw new Error("Inicia sesion con Supabase antes de conectar")
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    })

    const result = (await response.json().catch(() => ({}))) as Record<string, unknown>

    if (!response.ok || result.ok === false) {
      throw new Error(String(result.error || "Error de conexion con Supabase"))
    }

    return result
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Timeout - verifica la conexion con Supabase")
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Alias histórico de `apiCall`. Antes envolvía una técnica JSONP contra
 * Google Apps Script; hoy se conserva el nombre para no tocar los componentes.
 */
export async function apiJsonp(
  apiUrl: string,
  params: Record<string, string | number | boolean>
): Promise<Record<string, unknown>> {
  return apiCall(apiUrl, params)
}

// =====================================================
// Dedup de lecturas pesadas (getAllData / getAllPulsosData)
// =====================================================
//
// Evita que dos componentes monten al mismo tiempo y disparen dos snapshots
// completos de la base. Conserva el último resultado durante 30 segundos:
//   - llamadas idénticas dentro de la ventana → comparten la misma promesa
//   - tras 30 s la próxima llamada vuelve a ir al servidor

const READ_TTL_MS = 30_000
const READ_CACHE = new Map<string, { at: number; promise: Promise<Record<string, unknown>> }>()

const READ_ACTIONS = new Set([
  "getAllData",
  "getAllPulsosData",
  "getCredenciales",
  "getSolicitudesEmpleo",
  "getEmpleados",
  "getClientesCosmiatria",
  "getFichasDermatologia",
  "getConsentMasajes",
  "getConsentTatuajesCejas",
  "getCertificadosRegalo",
])

function cacheKey(params: Record<string, unknown>): string | null {
  const action = String(params.action || "")
  if (!action || !READ_ACTIONS.has(action)) return null
  const keys = Object.keys(params).filter((k) => k !== "action").sort()
  return keys.length === 0 ? action : `${action}|${keys.map((k) => `${k}=${params[k]}`).join("&")}`
}

/**
 * Llamada autenticada con dedupe corto (30 s) para acciones de lectura
 * pesadas.  Si el componente A pide `getAllData` y el componente B pide
 * exactamente lo mismo dentro de los 30 s siguientes, B reutiliza la
 * promesa de A en lugar de pegarle al servidor de nuevo.
 *
 * Acciones de escritura nunca se cachean.
 */
export async function apiCallCached(
  apiUrl: string,
  params: Record<string, string | number | boolean>,
): Promise<Record<string, unknown>> {
  const key = cacheKey(params)
  if (!key) return apiCall(apiUrl, params)

  const now = Date.now()
  const cached = READ_CACHE.get(key)
  if (cached && now - cached.at < READ_TTL_MS) return cached.promise

  const promise = apiCall(apiUrl, params).catch((error) => {
    // En caso de error, no envenenar el cache: limpiar la entrada para que
    // el próximo intento sí vaya al servidor.
    if (READ_CACHE.get(key)?.promise === promise) READ_CACHE.delete(key)
    throw error
  })
  READ_CACHE.set(key, { at: now, promise })
  return promise
}

/** Borra el dedup-cache (útil tras una mutación de datos). */
export function invalidateReadCache(prefix?: string) {
  if (!prefix) {
    READ_CACHE.clear()
    return
  }
  for (const key of READ_CACHE.keys()) {
    if (key.startsWith(prefix)) READ_CACHE.delete(key)
  }
}
