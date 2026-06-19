"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import QRCode from "qrcode"
import { composeQrPng, downloadDataUrl } from "@/lib/qr-compose"

export default function PublicQrPage() {
  const params = useParams<{ token: string }>()
  const token = decodeURIComponent(String(params?.token || ""))
  const [url, setUrl] = useState("")
  const [info, setInfo] = useState<{ ok?: boolean; employee_nombre?: string; sucursal?: string; error?: string } | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/public/qr?token=${encodeURIComponent(token)}`, { cache: "no-store" })
        const j = await r.json()
        setInfo(j)
        if (j?.ok) setUrl(await QRCode.toDataURL(token, { width: 320, margin: 1 }))
      } catch { setInfo({ ok: false, error: "No se pudo cargar el QR" }) }
    })()
  }, [token])

  const download = async () => {
    if (!url) return
    const nombre = info?.employee_nombre || "empleado"
    try { downloadDataUrl(await composeQrPng(url, nombre, info?.sucursal || ""), `QR_${nombre}.png`) }
    catch { downloadDataUrl(url, `QR_${nombre}.png`) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-6 text-center shadow-sm">
        {info === null ? (
          <p className="py-12 text-sm text-slate-500">Cargando QR…</p>
        ) : !info.ok ? (
          <div className="py-10">
            <p className="text-lg font-bold text-red-600">QR no válido</p>
            <p className="mt-2 text-sm text-slate-500">{info.error || "Este QR fue regenerado o no existe."}</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ponche de asistencia</p>
            <h1 className="mt-1 text-xl font-black text-slate-800">{info.employee_nombre}</h1>
            {info.sucursal ? <p className="text-sm text-slate-500">{info.sucursal}</p> : null}
            {url ? <img src={url} alt="QR personal" className="mx-auto my-4 w-60 h-60" /> : <p className="py-12 text-sm text-slate-500">Generando…</p>}
            <p className="text-[12px] text-slate-500">Presenta este QR en el kiosco autorizado de tu sucursal para registrar entrada y salida. Solo funciona dentro de la geocerca y desde un dispositivo autorizado.</p>
            <a href={`/ponche-movil/${encodeURIComponent(token)}`} className="mt-4 block w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white">Ponchar desde el celular</a>
            <button onClick={download} className="mt-2 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white">Descargar QR</button>
          </>
        )}
      </div>
    </div>
  )
}
