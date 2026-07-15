"use client"

/**
 * CF PARA IMPRIMIR · Previsualización del certificado.
 *
 * Renderiza el MISMO SVG que se exporta/imprime (cert-svg), pero con los
 * recursos por URL y las fuentes cargadas vía @font-face global → "lo que ves
 * es lo que sale". Responsive (el SVG llena el ancho del contenedor).
 */
import { useEffect, useMemo } from "react"
import { renderCertificate, CERT_ART_SRC } from "@/lib/certificados/cert-talonario"
import type { GiftCertData } from "@/lib/certificados/cert-layout"

let assetsInjected = false
function ensureAssets() {
  if (assetsInjected || typeof document === "undefined") return
  assetsInjected = true
  const style = document.createElement("style")
  style.textContent = `
    @font-face{font-family:'CFMont';src:url('/fonts/Montserrat.ttf') format('truetype');font-weight:100 900;font-display:swap}
    @font-face{font-family:'CFAllura';src:url('/fonts/Allura-Regular.ttf') format('truetype');font-display:swap}
    .cf-cert-preview svg{display:block;width:100%;height:auto}
  `
  document.head.appendChild(style)
  // Precalienta las fuentes para que el primer render use Montserrat/Allura.
  const anyDoc = document as unknown as { fonts?: { load: (f: string) => Promise<unknown> } }
  if (anyDoc.fonts) {
    void anyDoc.fonts.load("600 20px CFMont")
    void anyDoc.fonts.load("400 40px CFAllura")
  }
}

export function CertificadoPreview({
  data,
  qrDataUri,
  className,
}: {
  data: GiftCertData
  qrDataUri?: string
  className?: string
}) {
  useEffect(() => {
    ensureAssets()
  }, [])

  const svg = useMemo(
    () =>
      renderCertificate(data, {
        includeArt: true,
        artSrc: CERT_ART_SRC,
        qrDataUri,
        code: data.codigo,
        embedFonts: false,
      }),
    [data, qrDataUri],
  )

  return <div className={`cf-cert-preview ${className || ""}`} dangerouslySetInnerHTML={{ __html: svg }} />
}
