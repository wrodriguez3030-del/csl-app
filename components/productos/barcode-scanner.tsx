"use client"

/**
 * Escáner de código de barra para el conteo físico.
 *
 * Dos entradas, ambas activas a la vez:
 *   1. **Cámara** — `BarcodeDetector` nativo cuando el navegador lo trae (Chrome
 *      Android, Edge) y `@zxing/browser` como respaldo universal (iOS Safari).
 *      La librería se carga BAJO DEMANDA: ~200 KB que no pesan en el arranque.
 *   2. **Pistola lectora** USB/Bluetooth — se comporta como un teclado. El hook
 *      `useBarcodeWedge` la escucha en toda la pantalla sin que haya que hacer
 *      clic en ningún campo.
 *
 * Requiere HTTPS y que la cabecera `Permissions-Policy` permita `camera=(self)`
 * (ver `vercel.json`): con la lista vacía el navegador apaga la cámara sin decir
 * nada y el botón parece roto.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Camera, CameraOff, ScanLine, X, Loader2 } from "lucide-react"
import { pushWedgeKey, type WedgeState } from "@/lib/productos-scan"

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue?: string }[]>
}
interface ScannerControlsLike {
  stop: () => void
}

/** Formatos de producto. Sin QR: aquí se leen envases, no enlaces. */
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"]

/**
 * Escucha la pistola lectora en toda la pantalla.
 *
 * Se ignora mientras el foco está en un campo de texto, para que teclear una
 * cantidad a mano nunca se interprete como una lectura (y al revés).
 */
export function useBarcodeWedge(onCode: (code: string) => void, enabled = true) {
  const stateRef = useRef<WedgeState>({ buffer: "", lastKeyAt: 0 })
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement
      const tag = el?.tagName?.toLowerCase()
      if (tag === "input" || tag === "textarea" || tag === "select") return
      // Date.now() en ambos lados: mezclar el reloj de `e.timeStamp` (relativo
      // a la carga de la página) con el del sistema daría deltas absurdos.
      const { state, code } = pushWedgeKey(stateRef.current, e.key, Date.now())
      stateRef.current = state
      if (code) {
        e.preventDefault()
        onCodeRef.current(code)
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [enabled])
}

/** Pitido corto de confirmación. Sin archivos de audio: se sintetiza. */
export function beep(okTone = true) {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = okTone ? 1200 : 320
    gain.gain.value = 0.06
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    setTimeout(() => { osc.stop(); void ctx.close() }, okTone ? 90 : 220)
  } catch {
    /* el sonido es un extra: nunca rompe el conteo */
  }
  try { navigator.vibrate?.(okTone ? 40 : [60, 40, 60]) } catch { /* sin vibración */ }
}

export function BarcodeScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const controlsRef = useRef<ScannerControlsLike | null>(null)
  const activeRef = useRef(false)
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  const [starting, setStarting] = useState(false)
  const [on, setOn] = useState(false)
  const [error, setError] = useState("")

  const stop = useCallback(() => {
    activeRef.current = false
    try { controlsRef.current?.stop() } catch { /* ya detenido */ }
    controlsRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setOn(false)
  }, [])

  const start = useCallback(async () => {
    if (activeRef.current || starting || !videoRef.current) return
    setStarting(true)
    setError("")
    try {
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector
      if (BD) {
        let detector: BarcodeDetectorLike | null = null
        try { detector = new BD({ formats: FORMATS }) } catch { detector = null }
        if (detector) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          })
          streamRef.current = stream
          videoRef.current.setAttribute("playsinline", "true")
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          activeRef.current = true
          setOn(true)
          setStarting(false)
          const det = detector
          const tick = async () => {
            if (!activeRef.current) return
            if (videoRef.current) {
              try {
                const codes = await det.detect(videoRef.current)
                const raw = codes?.[0]?.rawValue
                if (raw) onCodeRef.current(String(raw))
              } catch { /* sin código en este cuadro */ }
            }
            setTimeout(tick, 300)
          }
          void tick()
          return
        }
      }

      // Respaldo universal (iOS Safari/Chrome): @zxing/browser, carga diferida.
      const { BrowserMultiFormatReader } = await import("@zxing/browser")
      const reader = new BrowserMultiFormatReader()
      controlsRef.current = (await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current,
        (res) => { if (res && activeRef.current) onCodeRef.current(res.getText()) },
      )) as unknown as ScannerControlsLike
      activeRef.current = true
      setOn(true)
      setStarting(false)
    } catch {
      setStarting(false)
      setOn(false)
      setError("No se pudo abrir la cámara. Permite el acceso y vuelve a intentarlo; si el permiso no aparece, revisa que estés en HTTPS.")
    }
  }, [starting])

  // Arranca sola al abrir el panel y se apaga SIEMPRE al cerrarlo (si no, la
  // luz de la cámara se queda encendida y el móvil sigue gastando batería).
  useEffect(() => {
    void start()
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="rounded-xl border border-[color:var(--brand-border)] bg-slate-950 p-3 text-white">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-bold">
          <ScanLine className="h-4 w-4 text-emerald-400" /> Escáner de código de barra
        </span>
        <Button variant="ghost" size="icon" aria-label="Cerrar escáner" onClick={() => { stop(); onClose() }} className="text-white hover:bg-white/10">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative mx-auto aspect-video w-full max-w-md overflow-hidden rounded-lg border-2 border-white/15 bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
        <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-emerald-400/70" />
        {!on && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 p-4 text-center">
            {starting ? (
              <span className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Abriendo cámara…</span>
            ) : (
              <>
                <Button onClick={() => void start()} className="bg-emerald-500 hover:bg-emerald-600">
                  <Camera className="mr-1.5 h-4 w-4" /> Activar cámara
                </Button>
                {error && <p className="max-w-xs text-xs text-amber-300">{error}</p>}
              </>
            )}
          </div>
        )}
      </div>

      <p className="mt-2 text-center text-xs text-white/60">
        {on ? "Apunta al código de barra del producto" : "También puedes usar una pistola lectora sin abrir la cámara"}
      </p>
      {on && (
        <div className="mt-2 flex justify-center">
          <Button variant="ghost" size="sm" onClick={stop} className="text-white/70 hover:bg-white/10">
            <CameraOff className="mr-1.5 h-3.5 w-3.5" /> Apagar cámara
          </Button>
        </div>
      )}
    </div>
  )
}
