"use client"

import { useCallback, useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Loader2, KeyRound, PlugZap, RefreshCw, CheckCircle2, XCircle, ShieldCheck } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { businessIdForSlug } from "@/lib/business"
import { useAppStore } from "@/lib/store"
import { runFullAgendaProSync, runIncrementalAgendaProSync } from "@/lib/agendapro-full-sync"

interface CredStatus {
  configured: boolean
  source: "db" | "env" | "none"
  apiUserMasked: string
  keyLast4: string
  baseUrlSet: boolean
  active: boolean
  updatedAt: string | null
}
interface SyncLog {
  sync_id: string
  source: string
  status: string
  started_at: string
  finished_at: string | null
  total: number
  created: number
  updated: number
  skipped: number
  duplicates: number
  errors: number
}
interface StatusResp {
  ok?: boolean
  canConfigure?: boolean
  credentials?: CredStatus
  lastSync?: SyncLog | null
  logs?: SyncLog[]
  error?: string
}

async function authHeaders(): Promise<Record<string, string>> {
  const { supabaseBrowser } = await import("@/lib/supabase-client")
  const { data: { session } } = await supabaseBrowser.auth.getSession()
  if (!session?.access_token) throw new Error("Sesión no válida — vuelve a iniciar sesión")
  return { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }
}

const fmtDate = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" })
  : "—"

export function AgendaProConfigDialog({
  open, onOpenChange, onSynced,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSynced?: () => void
}) {
  const business = useCurrentBusiness()
  const activeBusinessSlug = useAppStore((s) => s.activeBusinessSlug)
  const showToast = useAppStore((s) => s.showToast)
  // El business_id de destino sigue SIEMPRE al negocio activo del switcher.
  const activeBusinessId = businessIdForSlug(activeBusinessSlug) || businessIdForSlug(business.slug) || undefined

  const [status, setStatus] = useState<StatusResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [apiUser, setApiUser] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ page: number; read: number; created: number; updated: number } | null>(null)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const headers = await authHeaders()
      const qs = activeBusinessId ? `?activeBusinessId=${encodeURIComponent(activeBusinessId)}` : ""
      const r = await fetch(`/api/integrations/agendapro/status${qs}`, { headers })
      const j = (await r.json()) as StatusResp
      setStatus(j)
      if (j?.credentials?.apiUserMasked && !apiUser) setApiUser("")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar estado", "error")
    } finally {
      setLoading(false)
    }
  }, [activeBusinessId, apiUser, showToast])

  useEffect(() => {
    if (open) { setApiKey(""); void loadStatus() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeBusinessId])

  const cred = status?.credentials
  const canConfigure = status?.canConfigure ?? false

  const save = async () => {
    if (!apiUser.trim() || !apiKey.trim()) { showToast("Ingresa usuario y clave de la API Pública.", "error"); return }
    setSaving(true)
    try {
      const headers = await authHeaders()
      const r = await fetch("/api/integrations/agendapro/credentials", {
        method: "POST", headers,
        body: JSON.stringify({ activeBusinessId, api_user: apiUser.trim(), api_key: apiKey.trim(), base_url: baseUrl.trim() || undefined }),
      })
      const j = await r.json()
      if (!j?.ok) { showToast(j?.error || "No se pudieron guardar las credenciales.", "error"); return }
      showToast("Credenciales de AgendaPro guardadas.", "success")
      setApiKey("")
      await loadStatus()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al guardar", "error")
    } finally { setSaving(false) }
  }

  const test = async () => {
    setTesting(true)
    try {
      const headers = await authHeaders()
      const r = await fetch("/api/integrations/agendapro/test", {
        method: "POST", headers, body: JSON.stringify({ activeBusinessId }),
      })
      const j = await r.json()
      showToast(j?.ok ? (j.message || "Conexión con AgendaPro validada.") : (j?.error || "No se pudo validar la conexión."), j?.ok ? "success" : "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al probar conexión", "error")
    } finally { setTesting(false) }
  }

  // Sincroniza en tandas cortas (helper compartido) con progreso en vivo.
  //   mode "nuevos" → incremental (solo lo nuevo desde la última sync)
  //   mode "todos"  → completo (migración inicial)
  const doSync = async (mode: "nuevos" | "todos") => {
    setSyncing(true)
    setSyncProgress({ page: 0, read: 0, created: 0, updated: 0 })
    try {
      const headers = await authHeaders()
      const run = mode === "todos" ? runFullAgendaProSync : runIncrementalAgendaProSync
      const acc = await run({ activeBusinessId, authHeaders: headers, onProgress: setSyncProgress })
      if (acc.error) {
        showToast(acc.error, "error")
      } else if (mode === "nuevos") {
        showToast(
          acc.created > 0 ? `${acc.created} cliente(s) nuevo(s) · ${acc.updated} actualizado(s).` : "AgendaPro al día — no hay clientes nuevos.",
          acc.errors > 0 ? "info" : "success",
        )
      } else {
        showToast(
          `Sincronización completa: ${acc.read} leídos · ${acc.created} nuevos · ${acc.updated} actualizados · ${acc.duplicates} duplicados · ${acc.errors} errores.`,
          acc.errors > 0 ? "info" : "success",
        )
      }
      onSynced?.()
      await loadStatus()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al sincronizar", "error")
    } finally {
      setSyncing(false)
      setSyncProgress(null)
    }
  }

  const busy = saving || testing || syncing

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PlugZap className="h-5 w-5 text-primary" />Configurar AgendaPro</DialogTitle>
          <DialogDescription>
            Credenciales de la API Pública de AgendaPro para <b>{business.shortName}</b>. Cada negocio usa su propia cuenta — no se mezclan clientes.
          </DialogDescription>
        </DialogHeader>

        {/* Estado de conexión */}
        <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
          {loading ? (
            <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando estado…</span>
          ) : cred?.configured ? (
            <div className="space-y-1">
              <span className="flex items-center gap-2 font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />AgendaPro configurado</span>
              <div className="text-xs text-muted-foreground">
                Usuario: <b>{cred.apiUserMasked || "—"}</b> · Clave: <b>****{cred.keyLast4}</b>
                {cred.source === "env" && <Badge variant="outline" className="ml-2">env</Badge>}
                {cred.source === "db" && <Badge variant="outline" className="ml-2">guardada</Badge>}
              </div>
              {status?.lastSync && (
                <div className="text-xs text-muted-foreground">Última sync: {fmtDate(status.lastSync.finished_at || status.lastSync.started_at)} · {status.lastSync.created} nuevos / {status.lastSync.updated} act.</div>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-2 text-amber-700"><XCircle className="h-4 w-4" />AgendaPro no está configurado para este negocio.</span>
          )}
        </div>

        {/* Formulario de credenciales */}
        {canConfigure ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Usuario API Pública</Label>
              <Input value={apiUser} onChange={(e) => setApiUser(e.target.value)} placeholder={cred?.apiUserMasked || "usuario@empresa.com"} autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><KeyRound className="h-3 w-3" />Clave API Pública</Label>
              <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={cred?.configured ? `****${cred.keyLast4} (deja en blanco para no cambiar)` : "pega la clave aquí"} autoComplete="new-password" />
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Avanzado · Base URL (opcional)</summary>
              <Input className="mt-1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.agendapro.com (por defecto)" />
            </details>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={save} disabled={busy || !apiUser.trim() || !apiKey.trim()}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}Guardar credenciales
              </Button>
              <Button variant="outline" onClick={test} disabled={busy || !cred?.configured}>
                {testing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1.5 h-4 w-4" />}Probar conexión
              </Button>
              <Button variant="secondary" onClick={() => doSync("nuevos")} disabled={busy || !cred?.configured}>
                {syncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}Sincronizar nuevos
              </Button>
              <Button variant="outline" onClick={() => doSync("todos")} disabled={busy || !cred?.configured} title="Recorre todas las páginas — úsalo una vez para la migración inicial">
                {syncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}Sincronizar todos
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              <b>Sincronizar nuevos</b>: trae solo lo nuevo desde la última sincronización (rápido, el día a día).{" "}
              <b>Sincronizar todos</b>: recorre toda la base de AgendaPro — úsalo una vez para la migración inicial.
            </p>
            {syncProgress && (
              <div className="rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2 text-xs text-teal-800">
                <span className="flex items-center gap-2 font-medium">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Sincronizando… trayendo todas las páginas de AgendaPro
                </span>
                <div className="mt-1 text-teal-700">
                  Página {syncProgress.page} · {syncProgress.read} leídos · {syncProgress.created} nuevos · {syncProgress.updated} actualizados
                </div>
                <div className="mt-0.5 text-[10px] text-teal-600">No cierres esta ventana hasta terminar.</div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No tienes permiso para configurar las credenciales. Contacta a un administrador.</p>
        )}

        {/* Historial de sincronización */}
        {status?.logs && status.logs.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs">Historial de sincronización</Label>
            <div className="max-h-48 overflow-y-auto rounded border">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left">Fecha</th>
                    <th className="px-2 py-1 text-right">Nuevos</th>
                    <th className="px-2 py-1 text-right">Act.</th>
                    <th className="px-2 py-1 text-right">Dup.</th>
                    <th className="px-2 py-1 text-right">Err.</th>
                    <th className="px-2 py-1 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {status.logs.map((l) => (
                    <tr key={l.sync_id} className="border-t">
                      <td className="px-2 py-1">{fmtDate(l.finished_at || l.started_at)}</td>
                      <td className="px-2 py-1 text-right font-medium text-emerald-700">{l.created}</td>
                      <td className="px-2 py-1 text-right">{l.updated}</td>
                      <td className="px-2 py-1 text-right">{l.duplicates}</td>
                      <td className="px-2 py-1 text-right">{l.errors > 0 ? <span className="text-red-600">{l.errors}</span> : 0}</td>
                      <td className="px-2 py-1">
                        <Badge variant="outline" className={l.status === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : l.status === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{l.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
