/**
 * Compone una imagen PNG lista para imprimir/compartir: fondo blanco, el QR y,
 * debajo, el nombre del empleado (centrado) + una línea opcional (cédula/puesto).
 * Mantiene alta resolución para que el QR siga escaneando. Cliente (usa canvas).
 */
export function composeQrPng(qrDataUrl: string, primary: string, secondary?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const QR = 512, M = 56, GAP = 30
        const nameSizeBase = 36, subSize = 26
        const canvas = document.createElement("canvas")
        const ctx = canvas.getContext("2d")
        if (!ctx) { reject(new Error("sin canvas 2d")); return }
        const W = QR + M * 2
        // Ajustar tamaño de fuente del nombre para que no se salga del ancho.
        let nameSize = nameSizeBase
        ctx.font = `bold ${nameSize}px Arial, Helvetica, sans-serif`
        while (nameSize > 18 && ctx.measureText(primary || "").width > W - M * 1.5) {
          nameSize -= 2
          ctx.font = `bold ${nameSize}px Arial, Helvetica, sans-serif`
        }
        const nameBlock = nameSize * 1.15
        const subBlock = secondary ? subSize * 1.3 + 6 : 0
        canvas.width = W
        canvas.height = M + QR + GAP + nameBlock + subBlock + M

        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, M, M, QR, QR)

        ctx.textAlign = "center"
        ctx.fillStyle = "#111827"
        ctx.font = `bold ${nameSize}px Arial, Helvetica, sans-serif`
        ctx.fillText(primary || "Empleado", canvas.width / 2, M + QR + GAP + nameSize)
        if (secondary) {
          ctx.fillStyle = "#6b7280"
          ctx.font = `${subSize}px Arial, Helvetica, sans-serif`
          ctx.fillText(secondary, canvas.width / 2, M + QR + GAP + nameSize + 10 + subSize)
        }
        resolve(canvas.toDataURL("image/png"))
      } catch (e) { reject(e instanceof Error ? e : new Error("error componiendo QR")) }
    }
    img.onerror = () => reject(new Error("no se pudo cargar el QR"))
    img.src = qrDataUrl
  })
}

/** Descarga un dataURL PNG con el nombre de archivo dado. */
export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a")
  a.href = dataUrl
  a.download = filename.replace(/\s+/g, "_")
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
