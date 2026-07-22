"use client"

import { useCallback, useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Mail, Send, ShieldCheck, CheckCircle2, XCircle, KeyRound } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { businessIdForSlug } from "@/lib/business"
import { useAppStore } from "@/lib/store"

interface EmailStatus {
  configured: boolean
  gmailUser: string
  gmailUserMasked: string
  keyLast4: string
  fromName: string | null
  active: boolean
  updatedAt: string | null
}
interface StatusResp {
  ok?: boolean
  businessId?: string
  businessSlug?: string
  canConfigure?: boolean
  settings?: EmailStatus
  error?: string
}

async function authHeaders(): Promise<Record<string, string>> {
  const { supabaseBrowser } = await import("@/lib/supabase-client")
  const { data: { session } } = await supabaseBrowser.auth.getSession()
  if (!session?.access_token) throw new Error("Sesión no válida — vuelve a iniciar sesión")
  return { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }
}

export function EmailConfigDialog({
  open, onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const business = useCurrentBusiness()
  const activeBusinessSlug = useAppStore((s) => s.activeBusinessSlug)
  const showToast = useAppStore((s) => s.showToast)

  // El correo se configura para UN negocio concreto. Si el superadmin está en
  // "Todos", NO configuramos nada a ciegas: pedimos seleccionar Cibao o Depicenter.
  const isAllSelected = activeBusinessSlug === "all"
  const targetSlug =
    activeBusinessSlug === "csl" || activeBusinessSlug === "depicenter"
      ? activeBusinessSlug
      : activeBusinessSlug === null
        ? business.slug
        : null
  const activeBusinessId = targetSlug ? businessIdForSlug(targetSlug) || undefined : undefined

  const [status, setStatus] = useState<StatusResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [gmailUser, setGmailUser] = useState("")
  const [appPassword, setAppPassword] = useState("")
  const [testTo, setTestTo] = useState("")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const loadStatus = useCallback(async () => {
    if (!activeBusinessId) return
    setLoading(true)
    try {
      const headers = await authHeaders()
      const r = await fetch(`/api/settings/email?activeBusinessId=${encodeURIComponent(activeBusinessId)}`, { headers })
      const j = (await r.json()) as StatusResp
      setStatus(j)
      setGmailUser(j?.settings?.gmailUser || "")
      setTestTo(j?.settings?.gmailUser || "")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar la configuración de correo", "error")
    } finally {
      setLoading(false)
    }
  }, [activeBusinessId, showToast])

  useEffect(() => {
    if (open) { setAppPassword(""); void loadStatus() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeBusinessId])

  const st = status?.settings
  const canConfigure = status?.canConfigure ?? false

  const save = async () => {
    if (!gmailUser.trim()) { showToast("Ingresa la cuenta de Gmail (remitente).", "error"); return }
    if (!appPassword.trim() && !st?.configured) { showToast("Ingresa la contraseña de aplicación de Gmail.", "error"); return }
    setSaving(true)
    try {
      const headers = await authHeaders()
      const r = await fetch("/api/settings/email", {
        method: "PUT", headers,
        body: JSON.stringify({ activeBusinessId, gmail_user: gmailUser.trim(), app_password: appPassword.trim() }),
      })
      const j = await r.json()
      if (!j?.ok) { showToast(j?.error || "No se pudo guardar la configuración.", "error"); return }
      showToast("Configuración de correo guardada.", "success")
      setAppPassword("")
      await loadStatus()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al guardar", "error")
    } finally { setSaving(false) }
  }

  const test = async () => {
    if (!testTo.trim()) { showToast("Ingresa un correo para la prueba.", "error"); return }
    setTesting(true)
    try {
      const headers = await authHeaders()
      const r = await fetch("/api/settings/email/test", {
        method: "POST", headers, body: JSON.stringify({ activeBusinessId, to: testTo.trim() }),
      })
      const j = await r.json()
      showToast(j?.ok ? (j.message || "Correo de prueba enviado.") : (j?.error || "No se pudo enviar la prueba."), j?.ok ? "success" : "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al enviar la prueba", "error")
    } finally { setTesting(false) }
  }

  const busy = saving || testing

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" />Correo (envío a clientes)</DialogTitle>
          <DialogDescription>
            Configura la cuenta de <b>Gmail</b> desde la que <b>{business.shortName}</b> envía las fichas y consentimientos. Cada negocio usa su propia cuenta — no se mezclan.
          </DialogDescription>
        </DialogHeader>

        {isAllSelected || !activeBusinessId ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
            Selecciona <b>Cibao Spa Laser</b> o <b>Depicenter</b> en el filtro de negocio (arriba) para configurar su correo. Cada negocio se configura por separado.
          </div>
        ) : (
          <>
            {/* Estado */}
            <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
              {loading ? (
                <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando…</span>
              ) : st?.configured ? (
                <div className="space-y-0.5">
                  <span className="flex items-center gap-2 font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />Configurado</span>
                  <div className="text-xs text-muted-foreground">Cuenta: <b>{st.gmailUserMasked || st.gmailUser || "—"}</b> · Clave: <b>••••{st.keyLast4}</b></div>
                </div>
              ) : (
                <span className="flex items-center gap-2 text-amber-700"><XCircle className="h-4 w-4" />Aún no configurado para este negocio (por ahora usa el respaldo actual).</span>
              )}
            </div>

            {canConfigure ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Cuenta de Gmail (remitente)</Label>
                  <Input value={gmailUser} onChange={(e) => setGmailUser(e.target.value)} placeholder="tunegocio@gmail.com" autoComplete="off" />
                  <p className="text-[11px] text-muted-foreground">Las fichas y consentimientos se envían desde esta cuenta; las respuestas del cliente llegan aquí.</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1"><KeyRound className="h-3 w-3" />Contraseña de aplicación de Gmail</Label>
                  <Input type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} placeholder={st?.configured ? "•••••••••••• (deja vacío para no cambiarla)" : "pega la contraseña de aplicación"} autoComplete="new-password" />
                  <p className="text-[11px] text-muted-foreground">
                    No es tu contraseña normal. Créala en{" "}
                    <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-primary underline">myaccount.google.com/apppasswords</a>{" "}
                    (requiere Verificación en 2 pasos activa). Se guarda cifrada; nadie puede verla luego.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button onClick={save} disabled={busy || !gmailUser.trim()}>
                    {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}Guardar
                  </Button>
                </div>

                <div className="border-t pt-3 space-y-1">
                  <Label className="text-xs">Enviar correo de prueba</Label>
                  <div className="flex gap-2">
                    <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="correo@ejemplo.com" autoComplete="off" />
                    <Button variant="outline" onClick={test} disabled={busy || !testTo.trim()}>
                      {testing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}Enviar prueba
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Confirma que la configuración funciona antes de enviar correos reales.</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No tienes permiso para configurar el correo. Contacta a un administrador.</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
