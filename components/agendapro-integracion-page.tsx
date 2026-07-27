"use client"

/**
 * Administración → Integración AgendaPro (§20).
 *
 * Estado del webhook de pagos + gestión de mapeos (sucursal/servicio) + monitor
 * de eventos con reproceso. Todas las acciones están gateadas a admin/superadmin
 * en el backend (`getBusinessContext().isAdmin/isSuperadmin`).
 */

import { useCallback, useEffect, useState, type ReactNode } from "react"
import {
  AlertTriangle, CheckCircle2, Loader2, Pencil, Plus, RefreshCw, Trash2, XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { apiJsonp, normalizeApiUrl, useAppStore } from "@/lib/store"

type Row = Record<string, unknown>
const s = (v: unknown) => (v == null ? "" : String(v))
const n = (v: unknown) => Number(v) || 0
function fmtDateTime(v: unknown): string {
  const raw = s(v).trim(); if (!raw) return "—"
  const d = new Date(raw); if (Number.isNaN(d.getTime())) return raw
  return new Intl.DateTimeFormat("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d)
}

const EV_STYLES: Record<string, string> = {
  processed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  already_processed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  requires_mapping: "border-amber-200 bg-amber-50 text-amber-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  duplicate: "border-slate-200 bg-slate-100 text-slate-600",
  received: "border-sky-200 bg-sky-50 text-sky-700",
  processing: "border-sky-200 bg-sky-50 text-sky-700",
  queued: "border-sky-200 bg-sky-50 text-sky-700",
}
function EvBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={EV_STYLES[status] || "border-slate-200 bg-slate-50 text-slate-600"}>{status || "—"}</Badge>
}

const CONSENT_TYPES = [
  { value: "depilacion-laser", label: "Depilación Láser (crea consentimiento pendiente)" },
  { value: "masajes", label: "Masajes" },
  { value: "peeling", label: "Peeling" },
  { value: "tatuajes", label: "Tatuajes / Cejas" },
  { value: "", label: "(Ninguno)" },
]

interface IntegracionData {
  config: { webhookConfigured: boolean; enabled: boolean; logPayloads: boolean; endpoint: string }
  counts: { total: number; processed: number; requires_mapping: number; failed: number; duplicate: number }
  locationMaps: Row[]; serviceMaps: Row[]; events: Row[]
  lastReceived: string | null; lastProcessed: string | null
}

export function AgendaProIntegracionPage() {
  const { apiUrl, showToast } = useAppStore()
  const [data, setData] = useState<IntegracionData | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState("estado")
  const [locForm, setLocForm] = useState<Row | null>(null)
  const [svcForm, setSvcForm] = useState<Row | null>(null)
  const [detail, setDetail] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [syncFrom, setSyncFrom] = useState("")
  const [syncTo, setSyncTo] = useState("")
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<Row | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getAgendaProIntegracion" }) as Row
      if ((res as { ok?: boolean }).ok === false) { showToast(s((res as { error?: string }).error) || "No se pudo cargar", "error"); return }
      setData(res as unknown as IntegracionData)
    } catch (e) { showToast(e instanceof Error ? e.message : "Error cargando la integración", "error") }
    finally { setLoading(false) }
  }, [apiUrl, showToast])

  useEffect(() => { load() }, [load])

  // Rango por defecto: últimos 3 días (hora local del navegador).
  useEffect(() => {
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const now = new Date(); const past = new Date(); past.setDate(past.getDate() - 3)
    setSyncTo(fmt(now)); setSyncFrom(fmt(past))
  }, [])

  const runSync = async () => {
    if (!syncFrom || !syncTo) return
    setSyncing(true); setSyncResult(null)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "syncAgendaProPayments", startDate: syncFrom, endDate: syncTo }) as Row
      const r = ((res as { result?: Row }).result || res) as Row
      setSyncResult(r)
      if ((res as { ok?: boolean }).ok === false || r.error) showToast(s(r.error) || "Error en la sincronización", "error")
      else showToast(`Sincronización: ${n(r.processed)} nuevos, ${n(r.already)} ya estaban`, "success")
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") }
    finally { setSyncing(false) }
  }

  const call = async (action: string, extra: Row, okMsg: string) => {
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action, ...extra }) as Row
      if ((res as { ok?: boolean }).ok === false) { showToast(s((res as { error?: string }).error) || "Error", "error"); return false }
      showToast(okMsg, "success"); await load(); return true
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error"); return false }
    finally { setBusy(false) }
  }

  const saveLoc = async () => {
    if (!locForm) return
    if (await call("saveAgendaProLocationMap", { data: JSON.stringify(locForm) }, "Sucursal mapeada")) setLocForm(null)
  }
  const saveSvc = async () => {
    if (!svcForm) return
    if (await call("saveAgendaProServiceMap", { data: JSON.stringify(svcForm) }, "Servicio mapeado")) setSvcForm(null)
  }

  const cfg = data?.config
  const c = data?.counts ?? { total: 0, processed: 0, requires_mapping: 0, failed: 0, duplicate: 0 }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Webhook de pagos, mapeos y monitor de eventos de AgendaPro.</p>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Actualizar
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          <TabsTrigger value="estado">Estado</TabsTrigger>
          <TabsTrigger value="sucursales">Sucursales ({data?.locationMaps.length ?? 0})</TabsTrigger>
          <TabsTrigger value="servicios">Servicios ({data?.serviceMaps.length ?? 0})</TabsTrigger>
          <TabsTrigger value="eventos">Eventos {c.requires_mapping + c.failed > 0 ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-xs text-amber-700">{c.requires_mapping + c.failed}</span> : null}</TabsTrigger>
        </TabsList>

        {/* ESTADO */}
        <TabsContent value="estado" className="mt-4 space-y-4">
          {/* Sincronizar pagos desde la API (no depende del webhook) */}
          <Card className="rounded-2xl border-[color:var(--brand-primary,#14B7B0)]/30 shadow-sm">
            <CardContent className="p-5">
              <h3 className="font-semibold text-[color:var(--brand-primary-dark,#063B4A)]">Sincronizar pagos desde AgendaPro</h3>
              <p className="mb-3 mt-0.5 text-xs text-slate-500">
                Trae los pagos directamente de la API de AgendaPro (no depende del webhook). Idempotente: no duplica lo ya procesado.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Desde</Label>
                  <Input type="date" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} className="w-40" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Hasta</Label>
                  <Input type="date" value={syncTo} onChange={(e) => setSyncTo(e.target.value)} className="w-40" />
                </div>
                <Button onClick={runSync} disabled={syncing}>
                  {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Sincronizar pagos ahora
                </Button>
              </div>
              {syncResult ? (
                <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                  {syncResult.error ? (
                    <p className="text-rose-600">{s(syncResult.error)}</p>
                  ) : (
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      <span>Encontrados: <b>{n(syncResult.fetched)}</b></span>
                      <span className="text-emerald-700">Nuevos procesados: <b>{n(syncResult.processed)}</b></span>
                      <span className="text-slate-500">Ya estaban: <b>{n(syncResult.already)}</b></span>
                      <span className="text-amber-700">Requieren mapeo: <b>{n(syncResult.requiresMapping)}</b></span>
                      <span className="text-rose-600">Errores: <b>{n(syncResult.errors)}</b></span>
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="rounded-2xl shadow-sm"><CardContent className="space-y-2 p-5">
              <h3 className="font-semibold text-[color:var(--brand-primary-dark,#063B4A)]">Configuración</h3>
              <StatusRow label="Webhook configurado (secreto)" ok={!!cfg?.webhookConfigured} />
              <StatusRow label="Webhook habilitado" ok={!!cfg?.enabled} />
              <StatusRow label="Guardar payload (PII)" ok={!!cfg?.logPayloads} neutralOff />
              <div className="pt-2 text-xs text-slate-500">
                Endpoint: <code className="rounded bg-slate-100 px-1">{cfg?.endpoint}?token=•••</code>
              </div>
              <div className="text-xs text-slate-400">Última recepción: {fmtDateTime(data?.lastReceived)} · Último OK: {fmtDateTime(data?.lastProcessed)}</div>
            </CardContent></Card>
            <Card className="rounded-2xl shadow-sm"><CardContent className="p-5">
              <h3 className="mb-3 font-semibold text-[color:var(--brand-primary-dark,#063B4A)]">Eventos</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat n={c.total} label="Total" />
                <Stat n={c.processed} label="Procesados" tone="emerald" />
                <Stat n={c.requires_mapping} label="Requieren mapeo" tone="amber" />
                <Stat n={c.failed} label="Fallidos" tone="rose" />
                <Stat n={c.duplicate} label="Duplicados" tone="slate" />
              </div>
            </CardContent></Card>
          </div>
          {!cfg?.webhookConfigured ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Falta <code>AGENDAPRO_WEBHOOK_SECRET</code> (≥16 caracteres) en el entorno para activar el webhook en producción.</span>
            </div>
          ) : null}
        </TabsContent>

        {/* SUCURSALES */}
        <TabsContent value="sucursales" className="mt-4">
          <MapCard
            title="Mapeo de sucursales (location_id → sucursal interna)"
            onAdd={() => setLocForm({ active: true })}
            rows={data?.locationMaps ?? []}
            columns={["location_id", "Nombre AgendaPro", "Sucursal interna", "Activo", ""]}
            render={(r) => [
              n(r.agendapro_location_id), s(r.agendapro_location_name) || "—", s(r.internal_sucursal),
              r.active ? "Sí" : "No",
              <RowBtns key="b" onEdit={() => setLocForm(r)} onDelete={() => call("deleteAgendaProLocationMap", { id: s(r.id) }, "Mapeo eliminado")} busy={busy} />,
            ]}
          />
        </TabsContent>

        {/* SERVICIOS */}
        <TabsContent value="servicios" className="mt-4">
          <MapCard
            title="Mapeo de servicios (nombre AgendaPro → servicio/consentimiento)"
            onAdd={() => setSvcForm({ active: true, sessions_quantity: 1 })}
            rows={data?.serviceMaps ?? []}
            columns={["Servicio AgendaPro", "Servicio interno", "Categoría", "Consentimiento", "Ses.", "Activo", ""]}
            render={(r) => [
              s(r.agendapro_service_name), s(r.internal_service_name) || "—", s(r.categoria) || "—",
              s(r.consent_type) || "—", n(r.sessions_quantity), r.active ? "Sí" : "No",
              <RowBtns key="b" onEdit={() => setSvcForm(r)} onDelete={() => call("deleteAgendaProServiceMap", { id: s(r.id) }, "Mapeo eliminado")} busy={busy} />,
            ]}
          />
        </TabsContent>

        {/* EVENTOS */}
        <TabsContent value="eventos" className="mt-4">
          <Card className="rounded-2xl shadow-sm"><CardContent className="p-5">
            <h3 className="mb-3 font-semibold text-[color:var(--brand-primary-dark,#063B4A)]">Últimos eventos (100)</h3>
            {(data?.events.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Sin eventos registrados.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Payment ID</TableHead><TableHead>Estado</TableHead><TableHead>Location</TableHead>
                    <TableHead>Recibido</TableHead><TableHead>Procesado</TableHead><TableHead>Error</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(data?.events ?? []).map((e, i) => (
                      <TableRow key={s(e.id) || i}>
                        <TableCell className="font-mono text-xs">{s(e.agendapro_payment_id) || "—"}</TableCell>
                        <TableCell><EvBadge status={s(e.status)} /></TableCell>
                        <TableCell>{s(e.agendapro_location_id) || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(e.received_at)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(e.processed_at)}</TableCell>
                        <TableCell className="max-w-[180px] truncate text-xs text-rose-600" title={s(e.error_message)}>{s(e.error_message)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => setDetail(e)}>Ver</Button>
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => call("reprocessAgendaProEvent", { id: s(e.id) }, "Evento reprocesado")}>
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* ── Dialog sucursal ── */}
      <Dialog open={!!locForm} onOpenChange={(o) => !o && setLocForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locForm?.id ? "Editar" : "Nueva"} sucursal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="AgendaPro location_id *"><Input type="number" value={s(locForm?.agendapro_location_id)} onChange={(e) => setLocForm((f) => ({ ...f, agendapro_location_id: e.target.value }))} /></Field>
            <Field label="Nombre en AgendaPro"><Input value={s(locForm?.agendapro_location_name)} onChange={(e) => setLocForm((f) => ({ ...f, agendapro_location_name: e.target.value }))} /></Field>
            <Field label="Sucursal interna *"><Input value={s(locForm?.internal_sucursal)} onChange={(e) => setLocForm((f) => ({ ...f, internal_sucursal: e.target.value }))} /></Field>
            <ActiveField checked={locForm?.active !== false} onChange={(v) => setLocForm((f) => ({ ...f, active: v }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLocForm(null)}>Cancelar</Button>
            <Button onClick={saveLoc} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog servicio ── */}
      <Dialog open={!!svcForm} onOpenChange={(o) => !o && setSvcForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{svcForm?.id ? "Editar" : "Nuevo"} servicio</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Nombre del servicio en AgendaPro *"><Input value={s(svcForm?.agendapro_service_name)} onChange={(e) => setSvcForm((f) => ({ ...f, agendapro_service_name: e.target.value }))} /></Field>
            <Field label="Servicio interno"><Input value={s(svcForm?.internal_service_name)} onChange={(e) => setSvcForm((f) => ({ ...f, internal_service_name: e.target.value }))} /></Field>
            <Field label="Categoría"><Input value={s(svcForm?.categoria)} onChange={(e) => setSvcForm((f) => ({ ...f, categoria: e.target.value }))} /></Field>
            <Field label="Consentimiento">
              <Select value={s(svcForm?.consent_type) || "none"} onValueChange={(v) => setSvcForm((f) => ({ ...f, consent_type: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="(Ninguno)" /></SelectTrigger>
                <SelectContent>{CONSENT_TYPES.map((t) => <SelectItem key={t.value || "none"} value={t.value || "none"}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Sesiones que otorga"><Input type="number" min={1} value={s(svcForm?.sessions_quantity)} onChange={(e) => setSvcForm((f) => ({ ...f, sessions_quantity: e.target.value }))} /></Field>
            <ActiveField checked={svcForm?.active !== false} onChange={(v) => setSvcForm((f) => ({ ...f, active: v }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSvcForm(null)}>Cancelar</Button>
            <Button onClick={saveSvc} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog detalle evento ── */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Evento {s(detail?.agendapro_payment_id)}</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
              <span>Estado: <EvBadge status={s(detail?.status)} /></span>
              <span>Intentos: {n(detail?.attempts)}</span>
              <span>Location: {s(detail?.agendapro_location_id) || "—"}</span>
              <span>Cliente AP: {s(detail?.agendapro_client_id) || "—"}</span>
            </div>
            {detail?.error_message ? <p className="rounded bg-rose-50 p-2 text-xs text-rose-700">{s(detail.error_message)}</p> : null}
            {detail?.result_summary ? (
              <div><div className="mb-1 text-xs font-semibold text-slate-500">Resultado</div>
                <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(detail.result_summary, null, 2)}</pre></div>
            ) : null}
            {detail?.payload_json ? (
              <div><div className="mb-1 text-xs font-semibold text-slate-500">Payload (protegido)</div>
                <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(detail.payload_json, null, 2)}</pre></div>
            ) : <p className="text-xs text-slate-400">Payload no almacenado (AGENDAPRO_LOG_PAYLOADS off) o sin permiso.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── subcomponentes ─────────────────────────────────────────────────────────
function StatusRow({ label, ok, neutralOff }: { label: string; ok: boolean; neutralOff?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className={`h-4 w-4 ${neutralOff ? "text-slate-300" : "text-rose-500"}`} />}
    </div>
  )
}
function Stat({ n: num, label, tone }: { n: number; label: string; tone?: string }) {
  const color = { emerald: "text-emerald-600", amber: "text-amber-600", rose: "text-rose-600", slate: "text-slate-500" }[tone || ""] || "text-[color:var(--brand-primary-dark,#063B4A)]"
  return <div className="rounded-lg border border-slate-100 p-3 text-center"><div className={`text-2xl font-bold ${color}`}>{num}</div><div className="text-xs text-slate-500">{label}</div></div>
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs text-slate-500">{label}</Label>{children}</div>
}
function ActiveField({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />Activo</label>
}
function RowBtns({ onEdit, onDelete, busy }: { onEdit: () => void; onDelete: () => void; busy: boolean }) {
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} title="Editar"><Pencil className="h-4 w-4" /></Button>
      <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600" disabled={busy} onClick={onDelete} title="Eliminar"><Trash2 className="h-4 w-4" /></Button>
    </div>
  )
}
function MapCard({ title, onAdd, rows, columns, render }: {
  title: string; onAdd: () => void; rows: Row[]; columns: string[]; render: (r: Row) => ReactNode[]
}) {
  return (
    <Card className="rounded-2xl shadow-sm"><CardContent className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-[color:var(--brand-primary-dark,#063B4A)]">{title}</h3>
        <Button size="sm" onClick={onAdd}><Plus className="mr-1 h-4 w-4" />Agregar</Button>
      </div>
      {rows.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">Sin mapeos. Agrega el primero.</p> : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>{columns.map((c, i) => <TableHead key={i} className={i === columns.length - 1 ? "text-right" : ""}>{c}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {rows.map((r, ri) => {
                const cells = render(r)
                return <TableRow key={s(r.id) || ri}>{cells.map((cell, ci) => <TableCell key={ci} className={ci === cells.length - 1 ? "text-right" : ""}>{cell as ReactNode}</TableCell>)}</TableRow>
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </CardContent></Card>
  )
}
