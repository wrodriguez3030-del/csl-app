"use client"

import { useRef, useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Eraser } from "lucide-react"

interface SignaturePadProps {
  label: string
  value?: string
  onChange: (dataUrl: string) => void
  /**
   * Clase Tailwind opcional para sobrescribir las alturas responsivas
   * por defecto. Si no se pasa, usa min 280px en móvil, 320px sm, 380px lg.
   */
  heightClass?: string
}

// Dimensiones internas del canvas (backing store). Grande para que la firma
// se vea nítida al escalar y al exportar a PDF/PNG. La proporción es ~2.5:1
// que encaja bien tanto en el contenedor responsive como en la caja
// rectangular que renderiza el PDF (drawSignatureImage usa scaleToFit).
const CANVAS_INTERNAL_WIDTH = 1000
const CANVAS_INTERNAL_HEIGHT = 400

export function SignaturePad({ label, value, onChange, heightClass }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [isEmpty, setIsEmpty] = useState(!value)

  const initCanvas = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    // Fondo blanco para que la firma se vea bien en PDF y al imprimir.
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "#000000"
    // lineWidth en pixeles del canvas; al escalar al CSS visible queda
    // ~2 CSS px en escritorio y ~3 CSS px en tablet — buen grosor táctil.
    ctx.lineWidth = 3.5
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    initCanvas(canvas)
    if (value) {
      const img = new Image()
      img.onload = () => {
        const ctx = canvas.getContext("2d")
        if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      }
      img.src = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    // scaleX/scaleY compensan la diferencia entre el backing store (1000×400)
    // y el tamaño CSS real del canvas — mantiene la firma fluida.
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      }
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const pos = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    setDrawing(true)
    setIsEmpty(false)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!drawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const pos = getPos(e, canvas)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
  }

  const endDraw = () => {
    if (!drawing) return
    setDrawing(false)
    const canvas = canvasRef.current
    if (!canvas) return
    onChange(canvas.toDataURL("image/png"))
  }

  const clear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    initCanvas(canvas)
    setIsEmpty(true)
    onChange("")
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={isEmpty}
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <Eraser className="h-3 w-3" /> Borrar
        </Button>
      </div>
      <div className="relative rounded-xl border-2 border-dashed border-border bg-white p-1 shadow-sm">
        <canvas
          ref={canvasRef}
          width={CANVAS_INTERNAL_WIDTH}
          height={CANVAS_INTERNAL_HEIGHT}
          // touch-none evita que el scroll de la página robe el gesto al
          // firmar con el dedo. Alturas responsive según UX request:
          // móvil ≥ 280px, sm/tablet ≥ 320px, lg/desktop ≥ 380px.
          className={`block w-full touch-none cursor-crosshair rounded-lg bg-white ${heightClass ?? "h-[280px] sm:h-[320px] lg:h-[380px]"}`}
          style={{ background: "#ffffff" }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="select-none text-sm text-muted-foreground/40">Firma aquí</p>
          </div>
        )}
      </div>
    </div>
  )
}
