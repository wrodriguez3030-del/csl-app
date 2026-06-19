"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { startRegistration, startAuthentication } from "@simplewebauthn/browser"

interface Cfg {
  allow_gps: boolean
  allow_mobile_biometric: boolean
  allow_remote_punch: boolean
  require_location: boolean
  require_biometric: boolean
}
type Result = { ok: boolean; type?: string; reason?: string; error?: string; verified_biometric?: boolean; distance_meters?: number | null } | null

const api = async (path: string, body: Record<string, unknown>) => {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" })
  return r.json()
}

export default function PoncheMovilPage() {
  const params = useParams<{ token: string }>()
  const token = decodeURIComponent(String(params?.token || ""))

  const [info, setInfo] = useState<{ ok?: boolean; employee_nombre?: string; sucursal?: string; config?: Cfg; error?: string } | null>(null)
  const [busy, setBusy] = useState<"" | "entrada" | "salida" | "enroll">("")
  const [msg, setMsg] = useState<string>("")
  const [result, setResult] = useState<Result>(null)

  const resolve = useCallback(async () => {
    try { setInfo(await api("/api/public/mobile-punch", { mode: "resolve", qr_token: token })) }
    catch { setInfo({ ok: false, error: "No se pudo cargar" }) }
  }, [token])
  useEffect(() => { resolve() }, [resolve])

  const getCoords = (): Promise<{ lat: number | null; lng: number | null; acc: number | null }> =>
    new Promise((res) => {
      if (!("geolocation" in navigator)) return res({ lat: null, lng: null, acc: null })
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
        () => res({ lat: null, lng: null, acc: null }),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      )
    })

  // Verificación biométrica → ticket.
  const runBiometric = async (): Promise<string | null> => {
    const opt = await api("/api/public/webauthn/auth-options", { qr_token: token })
    if (!opt?.ok) { setMsg(opt?.error || "No hay biometría registrada en este teléfono"); return null }
    let asr
    try { asr = await startAuthentication({ optionsJSON: opt.options }) }
    catch { setMsg("Autenticación biométrica cancelada"); return null }
    const ver = await api("/api/public/webauthn/auth-verify", { qr_token: token, response: asr })
    if (!ver?.ok) { setMsg(ver?.error || "Biometría no verificada"); return null }
    return ver.ticket as string
  }

  const enroll = async () => {
    setBusy("enroll"); setMsg("")
    try {
      const opt = await api("/api/public/webauthn/register-options", { qr_token: token })
      if (!opt?.ok) { setMsg(opt?.error || "No se pudo iniciar el registro"); return }
      let att
      try { att = await startRegistration({ optionsJSON: opt.options }) }
      catch { setMsg("Registro de biometría cancelado"); return }
      const ver = await api("/api/public/webauthn/register-verify", { qr_token: token, response: att, device_label: navigator.userAgent.slice(0, 80) })
      if (ver?.ok) setMsg("✅ Biometría registrada en este teléfono")
      else setMsg(ver?.error || "No se pudo registrar la biometría")
    } finally { setBusy("") }
  }

  const punch = async (punch_type: "entrada" | "salida") => {
    setBusy(punch_type); setMsg(""); setResult(null)
    try {
      const cfg = info?.config
      let ticket: string | null = null
      let modality = "gps"
      if (cfg?.require_biometric || cfg?.allow_mobile_biometric) {
        // Si la biometría es obligatoria o está habilitada, intenta verificar.
        ticket = await runBiometric()
        if (cfg?.require_biometric && !ticket) return // obligatoria y falló
        if (ticket) modality = "mobile_biometric"
      }
      const coords = await getCoords()
      if (cfg?.require_location && coords.lat == null) { setMsg("Activa la ubicación (GPS) y otorga permiso para ponchar"); return }
      const res = await api("/api/public/mobile-punch", {
        mode: "punch", qr_token: token, punch_type, modality,
        latitude: coords.lat, longitude: coords.lng, accuracy: coords.acc,
        biometric_ticket: ticket, device_info: navigator.userAgent.slice(0, 80),
      })
      setResult(res)
    } catch { setResult({ ok: false, error: "Error de red" }) }
    finally { setBusy("") }
  }

  if (info === null) return <Shell><p className="py-16 text-center text-sm text-slate-500">Cargando…</p></Shell>
  if (!info.ok) return <Shell><div className="py-12 text-center"><p className="text-lg font-bold text-red-600">QR no válido</p><p className="mt-2 text-sm text-slate-500">{info.error || "Este enlace fue regenerado o no existe."}</p></div></Shell>

  const cfg = info.config

  return (
    <Shell>
      <p className="text-center text-[11px] font-semibold uppercase tracking-widest text-slate-400">Ponche de asistencia</p>
      <h1 className="mt-1 text-center text-2xl font-black text-slate-800">{info.employee_nombre}</h1>
      {info.sucursal ? <p className="text-center text-sm text-slate-500">{info.sucursal}</p> : null}

      {result ? (
        <div className={`my-6 rounded-2xl border p-5 text-center ${result.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
          <p className={`text-3xl ${result.ok ? "text-emerald-600" : "text-red-600"}`}>{result.ok ? "✓" : "✕"}</p>
          <p className={`mt-1 text-lg font-bold ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
            {result.ok ? `${result.type === "salida" ? "Salida" : "Entrada"} registrada` : "No se registró"}
          </p>
          {result.ok && result.verified_biometric ? <p className="mt-1 text-xs text-emerald-700">Verificado con biometría del dispositivo</p> : null}
          {!result.ok ? <p className="mt-1 text-sm text-red-600">{result.reason || result.error}</p> : null}
          <button onClick={() => setResult(null)} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white">Volver</button>
        </div>
      ) : (
        <>
          <div className="my-6 grid grid-cols-2 gap-3">
            <button onClick={() => punch("entrada")} disabled={busy !== ""}
              className="flex flex-col items-center justify-center rounded-2xl bg-emerald-600 py-8 text-white shadow-sm active:scale-95 disabled:opacity-50">
              <span className="text-3xl">→</span>
              <span className="mt-1 text-lg font-bold">{busy === "entrada" ? "..." : "Entrada"}</span>
            </button>
            <button onClick={() => punch("salida")} disabled={busy !== ""}
              className="flex flex-col items-center justify-center rounded-2xl bg-slate-700 py-8 text-white shadow-sm active:scale-95 disabled:opacity-50">
              <span className="text-3xl">←</span>
              <span className="mt-1 text-lg font-bold">{busy === "salida" ? "..." : "Salida"}</span>
            </button>
          </div>

          <div className="space-y-2 text-center">
            {cfg?.require_biometric ? (
              <p className="text-xs text-amber-700">Esta sucursal exige verificación biométrica para ponchar.</p>
            ) : null}
            {cfg?.allow_mobile_biometric ? (
              <button onClick={enroll} disabled={busy !== ""}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50">
                {busy === "enroll" ? "Registrando…" : "Activar biometría en este teléfono"}
              </button>
            ) : null}
            <p className="text-[11px] text-slate-400">
              {cfg?.require_location !== false ? "Se requiere ubicación (GPS). " : ""}
              {cfg?.allow_remote_punch ? "Ponche remoto permitido." : "Debes estar en tu sucursal."}
            </p>
          </div>
        </>
      )}

      {msg ? <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-center text-xs text-slate-600">{msg}</p> : null}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 p-4 flex items-center justify-center">
      <div className="w-full max-w-sm rounded-3xl border bg-white p-6 shadow-sm">{children}</div>
    </div>
  )
}
