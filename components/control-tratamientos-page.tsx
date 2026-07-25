"use client"

/**
 * Control Digital de Tratamientos — ficha operativa por cliente.
 *
 * Lee TODO de un cliente en una sola llamada (`getControlTratamientos`):
 * KPIs reales (sesiones disponibles/adquiridas, tratamientos realizados,
 * cesiones, firmas pendientes), paquetes, cesiones, consentimientos pendientes
 * y actividad reciente. Multi-tenant: el business activo se auto-inyecta en cada
 * request del store; el backend filtra por business_id.
 *
 * Los paquetes con `origen = agendapro_webhook` llevan badge "AgendaPro".
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity, CalendarCheck2, Download, FileText, Gift, Loader2, PenLine,
  Search, ShoppingBag, UserRound, Users, X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataPagination } from "@/components/ui/data-pagination"
import { usePagination } from "@/lib/use-pagination"
import { apiJsonp, normalizeApiUrl, useAppStore } from "@/lib/store"
import { displayPhone } from "@/lib/formatters"

// ── helpers ──────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>
const s = (v: unknown) => (v == null ? "" : String(v))
const n = (v: unknown) => Number(v) || 0

/** 'YYYY-MM-DD' | ISO → 'DD/MM/YYYY' (hora RD). Sin librerías. */
function fmtDate(v: unknown): string {
  const raw = s(v).trim()
  if (!raw) return "—"
  const iso = raw.length > 10 ? raw : `${raw}T12:00:00`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return raw
  return new Intl.DateTimeFormat("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "2-digit", year: "numeric" }).format(d)
}
function fmtMoney(v: unknown): string {
  const num = n(v)
  return num ? num.toLocaleString("es-DO", { style: "currency", currency: "DOP", minimumFractionDigits: 2 }) : "$0.00"
}

const ESTADO_STYLES: Record<string, string> = {
  disponible: "border-emerald-200 bg-emerald-50 text-emerald-700",
  parcial: "border-amber-200 bg-amber-50 text-amber-700",
  agotado: "border-slate-200 bg-slate-100 text-slate-600",
  cedido_parcial: "border-sky-200 bg-sky-50 text-sky-700",
  cedido_total: "border-sky-200 bg-sky-50 text-sky-700",
  anulado: "border-rose-200 bg-rose-50 text-rose-700",
}
function EstadoBadge({ estado }: { estado: string }) {
  const key = estado.toLowerCase().replace(/\s+/g, "_")
  const label = estado ? estado.charAt(0).toUpperCase() + estado.slice(1).replace(/_/g, " ") : "—"
  return <Badge variant="outline" className={ESTADO_STYLES[key] || "border-slate-200 bg-slate-50 text-slate-600"}>{label}</Badge>
}
function OrigenBadge({ origen }: { origen: string }) {
  if (origen === "agendapro_webhook") {
    return <Badge variant="outline" className="border-teal-300 bg-teal-50 text-teal-700">AgendaPro</Badge>
  }
  const map: Record<string, string> = { manual: "Registro manual", migracion: "Migración" }
  return <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">{map[origen] || origen || "—"}</Badge>
}

interface ControlData {
  cliente: Row | null
  kpis: {
    sesiones_disponibles: number; sesiones_adquiridas: number
    tratamientos_realizados: number; sesiones_cedidas: number; firmas_pendientes: number
  }
  paquetes: Row[]
  cesiones: Row[]
  firmasPendientes: Row[]
  actividadReciente: Row[]
}

const STORAGE_KEY = "ct:cliente_id"

// ── KPI card ──────────────────────────────────────────────────────────────────
function Kpi({ icon: Icon, value, label, tone }: { icon: typeof Activity; value: number; label: string; tone: "primary" | "dark" }) {
  const bg = tone === "dark" ? "var(--brand-primary-dark)" : "var(--brand-primary)"
  return (
    <Card className="rounded-2xl border-[color:var(--brand-border,#E1ECF2)] shadow-sm">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: bg }}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="text-3xl font-bold leading-none text-[color:var(--brand-primary-dark,#063B4A)]">{value}</div>
          <div className="mt-1 text-sm text-slate-500">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── main ─────────────────────────────────────────────────────────────────────
export function ControlTratamientosPage() {
  const { apiUrl, setActiveTab, showToast } = useAppStore()
  const [clienteId, setClienteId] = useState<string>("")
  const [data, setData] = useState<ControlData | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState("resumen")
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : ""
    if (saved) setClienteId(saved)
  }, [])

  const load = useCallback(async (id: string) => {
    if (!id) { setData(null); return }
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getControlTratamientos", clienteId: id }) as Row
      if ((res as { ok?: boolean }).ok === false) { showToast(s((res as { error?: string }).error) || "No se pudo cargar", "error"); setData(null); return }
      setData(res as unknown as ControlData)
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error cargando el control de tratamientos", "error")
      setData(null)
    } finally { setLoading(false) }
  }, [apiUrl, showToast])

  useEffect(() => { if (clienteId) load(clienteId) }, [clienteId, load])

  const selectCliente = (id: string) => {
    setClienteId(id); setPickerOpen(false); setTab("resumen")
    try { window.localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
  }

  const cliente = data?.cliente
  const nombreCompleto = cliente ? `${s(cliente.Nombre)} ${s(cliente.Apellido)}`.trim() : ""

  const exportCsv = () => {
    if (!data) return
    const head = ["Fecha", "Categoría", "Servicio", "Sucursal", "Sesiones", "Disponibles", "Monto pagado", "Estado", "Origen"]
    const lines = data.paquetes.map((p) => [
      fmtDate(p.fecha_compra), s(p.categoria), s(p.servicio), s(p.sucursal),
      n(p.sesiones_adquiridas), n(p.sesiones_disponibles), n(p.monto_pagado), s(p.estado), s(p.origen),
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    const csv = [head.join(","), ...lines].join("\r\n")
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `control-tratamientos-${nombreCompleto || clienteId}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── empty state (sin cliente) ──
  if (!clienteId || (!cliente && !loading)) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--brand-primary-soft,#E6FAF9)]">
          <Users className="h-8 w-8 text-[color:var(--brand-primary,#14B7B0)]" />
        </div>
        <h2 className="text-lg font-semibold text-slate-700">Selecciona un cliente</h2>
        <p className="mt-1 text-sm text-slate-500">Busca un cliente para ver su control digital de tratamientos.</p>
        <Button className="mt-5" onClick={() => setPickerOpen(true)}><Search className="mr-2 h-4 w-4" />Buscar cliente</Button>
        <ClientePicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={selectCliente} apiUrl={apiUrl} />
      </div>
    )
  }

  const k = data?.kpis ?? { sesiones_disponibles: 0, sesiones_adquiridas: 0, tratamientos_realizados: 0, sesiones_cedidas: 0, firmas_pendientes: 0 }

  return (
    <div className="space-y-5">
      {/* ── Encabezado del cliente ── */}
      <Card className="overflow-hidden rounded-2xl border-[color:var(--brand-border,#E1ECF2)] shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-primary-soft,#E6FAF9)]">
              <UserRound className="h-8 w-8 text-[color:var(--brand-primary,#14B7B0)]" />
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-slate-400">Cliente actual</div>
              <div className="truncate text-xl font-bold text-[color:var(--brand-primary-dark,#063B4A)]">{loading && !cliente ? "Cargando…" : (nombreCompleto || "—")}</div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                {cliente?.Telefono ? <span>📞 {displayPhone(s(cliente.Telefono))}</span> : null}
                {cliente?.Email ? <span>✉️ {s(cliente.Email)}</span> : null}
                {cliente?.Sucursal ? <span>📍 {s(cliente.Sucursal)}</span> : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPickerOpen(true)}><Users className="mr-2 h-4 w-4" />Cambiar cliente</Button>
            <Button onClick={() => setActiveTab("cosmiatria-clientes")}><PenLine className="mr-2 h-4 w-4" />Registrar sesión</Button>
            <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Exportar</Button>
          </div>
        </CardContent>
      </Card>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi icon={CalendarCheck2} value={k.sesiones_disponibles} label="Sesiones disponibles" tone="primary" />
        <Kpi icon={ShoppingBag} value={k.sesiones_adquiridas} label="Sesiones adquiridas" tone="primary" />
        <Kpi icon={Activity} value={k.tratamientos_realizados} label="Tratamientos realizados" tone="dark" />
        <Kpi icon={Gift} value={k.sesiones_cedidas} label="Sesiones cedidas" tone="primary" />
        <Kpi icon={PenLine} value={k.firmas_pendientes} label="Firmas pendientes" tone="dark" />
      </div>

      {/* ── Pestañas ── */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="sesiones">Sesiones y Tratamientos</TabsTrigger>
          <TabsTrigger value="actividad">Actividad Reciente</TabsTrigger>
          <TabsTrigger value="historial">Historial del Cliente</TabsTrigger>
        </TabsList>

        {/* RESUMEN */}
        <TabsContent value="resumen" className="mt-4 space-y-5">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <PaquetesCard paquetes={data?.paquetes ?? []} compact />
            <ActividadCard actividad={data?.actividadReciente ?? []} compact />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <FirmasPendientesCard firmas={data?.firmasPendientes ?? []} />
            <CesionesCard cesiones={data?.cesiones ?? []} clienteId={clienteId} />
          </div>
        </TabsContent>

        <TabsContent value="sesiones" className="mt-4">
          <PaquetesCard paquetes={data?.paquetes ?? []} />
        </TabsContent>

        <TabsContent value="actividad" className="mt-4">
          <ActividadCard actividad={data?.actividadReciente ?? []} />
        </TabsContent>

        <TabsContent value="historial" className="mt-4 space-y-5">
          <FirmasPendientesCard firmas={data?.firmasPendientes ?? []} />
          <CesionesCard cesiones={data?.cesiones ?? []} clienteId={clienteId} />
          <ActividadCard actividad={data?.actividadReciente ?? []} />
        </TabsContent>
      </Tabs>

      <ClientePicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={selectCliente} apiUrl={apiUrl} />
    </div>
  )
}

// ── Paquetes adquiridos ──────────────────────────────────────────────────────
function PaquetesCard({ paquetes, compact }: { paquetes: Row[]; compact?: boolean }) {
  const pg = usePagination(paquetes, { initialPageSize: compact ? 5 : 10 })
  const totalSesiones = useMemo(() => paquetes.reduce((a, p) => a + n(p.sesiones_adquiridas), 0), [paquetes])
  return (
    <Card className="rounded-2xl border-[color:var(--brand-border,#E1ECF2)] shadow-sm">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <FileText className="h-5 w-5 text-[color:var(--brand-primary,#14B7B0)]" />
          <h3 className="font-semibold text-[color:var(--brand-primary-dark,#063B4A)]">Paquetes de sesiones adquiridos</h3>
          <span className="ml-auto text-xs text-slate-400">Total de sesiones: {totalSesiones}</span>
        </div>
        {paquetes.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Sin paquetes registrados.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Servicio</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead className="text-right">Ses.</TableHead>
                    <TableHead className="text-right">Disp.</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Origen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pg.pageItems.map((p, i) => (
                    <TableRow key={s(p.paquete_id) || i}>
                      <TableCell className="whitespace-nowrap">{fmtDate(p.fecha_compra)}</TableCell>
                      <TableCell>{s(p.categoria) || "—"}</TableCell>
                      <TableCell className="max-w-[180px] truncate" title={s(p.servicio)}>{s(p.servicio) || "—"}</TableCell>
                      <TableCell className="max-w-[140px] truncate" title={s(p.sucursal)}>{s(p.sucursal) || "—"}</TableCell>
                      <TableCell className="text-right">{n(p.sesiones_adquiridas)}</TableCell>
                      <TableCell className="text-right font-medium">{n(p.sesiones_disponibles)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(p.monto_pagado)}</TableCell>
                      <TableCell><EstadoBadge estado={s(p.estado)} /></TableCell>
                      <TableCell><OrigenBadge origen={s(p.origen)} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <DataPagination page={pg.page} totalPages={pg.totalPages} total={pg.total} from={pg.from} to={pg.to} pageSize={pg.pageSize} onPage={pg.setPage} onPageSize={pg.setPageSize} pageSizeOptions={[5, 10, 25, 50]} label="paquetes" className="mt-3" />
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Actividad reciente (tratamientos realizados) ─────────────────────────────
function ActividadCard({ actividad, compact }: { actividad: Row[]; compact?: boolean }) {
  const items = compact ? actividad.slice(0, 6) : actividad
  return (
    <Card className="rounded-2xl border-[color:var(--brand-border,#E1ECF2)] shadow-sm">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-5 w-5 text-[color:var(--brand-primary,#14B7B0)]" />
          <h3 className="font-semibold text-[color:var(--brand-primary-dark,#063B4A)]">Actividad reciente — Tratamientos realizados ({actividad.length})</h3>
        </div>
        {actividad.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Sin tratamientos registrados.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((a, i) => (
              <li key={s(a.SesionID) || i} className="flex items-start gap-3 border-b border-slate-100 pb-3 last:border-0">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[color:var(--brand-primary,#14B7B0)]" />
                <div className="w-16 shrink-0 text-xs font-medium text-slate-500">{fmtDate(a.Fecha)}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-700">{s(a.Tratamiento) || s(a.AreaTrabajada) || "Tratamiento"}</div>
                  <div className="truncate text-xs text-slate-400">{[s(a.AreaTrabajada), s(a.Sucursal)].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="shrink-0 text-right text-xs text-slate-400">
                  <div>Operador/a</div>
                  <div className="font-medium text-slate-600">{s(a.OperadoraID) || "—"}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ── Firmas pendientes (empty-state cuando no hay) ────────────────────────────
function FirmasPendientesCard({ firmas }: { firmas: Row[] }) {
  return (
    <Card className="rounded-2xl border-[color:var(--brand-border,#E1ECF2)] shadow-sm">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <PenLine className="h-5 w-5 text-[color:var(--brand-primary,#14B7B0)]" />
          <h3 className="font-semibold text-[color:var(--brand-primary-dark,#063B4A)]">Firmas pendientes</h3>
        </div>
        {firmas.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--brand-primary,#14B7B0)] text-white">✓</div>
            <p className="text-sm text-slate-500">Este cliente no tiene firmas pendientes</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {firmas.map((f, i) => (
              <li key={s(f.consent_id) || i} className="flex items-center justify-between gap-2 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-700">{s(f.tipo)} {f.servicio ? <span className="text-slate-400">· {s(f.servicio)}</span> : null}</div>
                  <div className="text-xs text-slate-400">{fmtDate(f.fecha)} · {s(f.sucursal) || "—"}</div>
                </div>
                <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">{s(f.estado)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ── Cesiones ─────────────────────────────────────────────────────────────────
function CesionesCard({ cesiones, clienteId }: { cesiones: Row[]; clienteId: string }) {
  const total = useMemo(() => cesiones.reduce((a, c) => a + n(c.sesiones_cedidas), 0), [cesiones])
  return (
    <Card className="rounded-2xl border-[color:var(--brand-border,#E1ECF2)] shadow-sm">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Gift className="h-5 w-5 text-[color:var(--brand-primary,#14B7B0)]" />
          <h3 className="font-semibold text-[color:var(--brand-primary-dark,#063B4A)]">Paquetes / sesiones cedidas</h3>
          <span className="ml-auto text-xs text-slate-400">Total de cesiones: {total}</span>
        </div>
        {cesiones.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Sin cesiones registradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente cede</TableHead>
                  <TableHead>Cliente recibe</TableHead>
                  <TableHead className="text-right">Sesiones</TableHead>
                  <TableHead>Servicio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cesiones.map((c, i) => {
                  const cede = c.cliente_cede_id === clienteId
                  return (
                    <TableRow key={s(c.cesion_id) || i}>
                      <TableCell className="whitespace-nowrap">{fmtDate(c.fecha)}</TableCell>
                      <TableCell className={cede ? "font-medium" : ""}>{s(c.cliente_cede_nombre) || s(c.cliente_cede_id) || "—"}</TableCell>
                      <TableCell className={!cede ? "font-medium" : ""}>{s(c.cliente_recibe_nombre) || s(c.cliente_recibe_id) || "—"}</TableCell>
                      <TableCell className="text-right">{n(c.sesiones_cedidas)}</TableCell>
                      <TableCell>{s(c.servicio) || s(c.categoria) || "—"}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Buscador de clientes (dialog) ────────────────────────────────────────────
function ClientePicker({ open, onOpenChange, onSelect, apiUrl }: {
  open: boolean; onOpenChange: (v: boolean) => void; onSelect: (id: string) => void; apiUrl: string
}) {
  const [q, setQ] = useState("")
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const handle = setTimeout(async () => {
      setBusy(true)
      try {
        const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getClientesCosmiatriaPaged", page: 1, pageSize: 20, search: q, sort: "nombre", dir: "asc" }) as Row
        setRows(Array.isArray((res as { records?: Row[] }).records) ? (res as { records?: Row[] }).records! : [])
      } catch { setRows([]) } finally { setBusy(false) }
    }, 250)
    return () => clearTimeout(handle)
  }, [q, open, apiUrl])

  const idOf = (r: Row) => s(r.cliente_id || r.ClienteID)
  const nameOf = (r: Row) => `${s(r.nombre || r.Nombre)} ${s(r.apellido || r.Apellido)}`.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Buscar cliente</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, teléfono o cédula…" className="pl-9" />
          {busy ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" /> : null}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">{busy ? "Buscando…" : "Escribe para buscar clientes."}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <li key={idOf(r) || i}>
                  <button type="button" onClick={() => onSelect(idOf(r))} className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-slate-50">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--brand-primary-soft,#E6FAF9)] text-[color:var(--brand-primary,#14B7B0)]"><UserRound className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-700">{nameOf(r) || idOf(r)}</span>
                      <span className="block truncate text-xs text-slate-400">{[s(r.telefono || r.Telefono), s(r.sucursal || r.Sucursal)].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
