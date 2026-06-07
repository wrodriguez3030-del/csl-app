"use client"

/**
 * Activación de dispositivo de kiosko desde un link administrativo:
 *   /hr/ponche/kiosko/activar?device_token=CSLDEV:xxxx
 * Verifica el token contra el endpoint público, lo guarda en localStorage del
 * navegador de la tablet y redirige al kiosko. Ese navegador queda autorizado.
 */
import { useEffect, useState } from "react"

const DEVICE_TOKEN_KEY = "csl_punch_device_token"

export default function ActivarKioskoPage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading")
  const [info, setInfo] = useState<{ device_name?: string; sucursal?: string; error?: string }>({})

  useEffect(() => {
    (async () => {
      const token = new URLSearchParams(window.location.search).get("device_token") || ""
      if (!token) { setStatus("error"); setInfo({ error: "Link sin token de activación." }); return }
      try {
        const r = await fetch(`/api/public/device-activate?token=${encodeURIComponent(token)}`, { cache: "no-store" })
        const j = await r.json()
        if (!j?.ok) { setStatus("error"); setInfo({ error: j?.error || "No se pudo activar el dispositivo." }); return }
        localStorage.setItem(DEVICE_TOKEN_KEY, token)
        setStatus("ok"); setInfo({ device_name: j.device_name, sucursal: j.sucursal })
        setTimeout(() => { window.location.href = "/hr/ponche/kiosko" }, 1800)
      } catch {
        setStatus("error"); setInfo({ error: "Error de red. Verifica el internet e intenta de nuevo." })
      }
    })()
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 text-center shadow-xl">
        {status === "loading" && <p className="py-10 text-white/70">Activando dispositivo…</p>}
        {status === "ok" && (
          <div className="py-6">
            <div className="text-emerald-400 text-5xl mb-3">✓</div>
            <h1 className="text-xl font-black">Dispositivo autorizado</h1>
            <p className="mt-2 text-white/70">{info.device_name}{info.sucursal ? ` · ${info.sucursal}` : ""}</p>
            <p className="mt-4 text-xs text-white/50">Abriendo el kiosko de ponche…</p>
          </div>
        )}
        {status === "error" && (
          <div className="py-6">
            <div className="text-red-400 text-5xl mb-3">✕</div>
            <h1 className="text-lg font-bold">No se pudo activar</h1>
            <p className="mt-2 text-sm text-white/70">{info.error}</p>
            <p className="mt-4 text-xs text-white/50">Solicita al administrador un nuevo link de activación.</p>
          </div>
        )}
      </div>
    </div>
  )
}
