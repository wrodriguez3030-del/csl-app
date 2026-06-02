/**
 * Generador del PDF profesional de Auditoría PULSE — usa window.print()
 * sobre HTML formal, mismo patrón que pulse-cuadre-pdf.ts y la Ficha
 * Dermatológica pública.
 *
 * Convención de color (alineada con lib/pulse-colors.ts):
 *   - diferencia < 0  → rojo  (#dc2626)
 *   - diferencia > 0  → azul  (#2563eb)
 *   - diferencia = 0  → verde (#059669)
 *
 * Estado (badge):
 *   - OK         → verde
 *   - Advertencia → amarillo
 *   - Crítico    → rojo
 */

import { getBusinessBranding, type BusinessBranding } from "@/lib/business"

export interface AuditoriaPdfRow {
  sucursal: string
  cabina: string
  operadora: string
  equipo: string
  pulsosInicio: number
  pulsosFin: number
  dispLaser: number
  dispOperador: number
  diferencia: number
  pct: number
  alerta: "OK" | "Advertencia" | "Critico"
}

export interface AuditoriaPdfSemana {
  /** Inicio de semana en ISO (period_start). */
  fecha: string
  rows: AuditoriaPdfRow[]
  totPulsosInicio: number
  totPulsosFin: number
  totDispLaser: number
  totDispOp: number
  totDiferencia: number
}

export interface AuditoriaPdfSnapshot {
  semanas: AuditoriaPdfSemana[]
  filtroSemana: string
  filtroSucursal: string
  generadoEn: string
  generadoPor?: string
  /** Branding del tenant activo. Si falta, cae a CSL. */
  branding?: BusinessBranding
}

/** Absolutiza el logo para que cargue dentro del popup de impresión (about:blank). */
function absoluteLogoUrl(logoUrl: string): string {
  if (!logoUrl) return ""
  if (/^https?:\/\//.test(logoUrl)) return logoUrl
  if (typeof window !== "undefined") return window.location.origin + logoUrl
  return logoUrl
}

const SUC_MAP: Record<string, string> = {
  "Rafael Vidal": "R. VIDAL",
  "Los Jardines": "JARDINES",
  "Villa Olga": "V. OLGA",
  "La Vega": "LA VEGA",
  "RAFAEL VIDAL": "R. VIDAL",
  "LOS JARDINES": "JARDINES",
  "VILLA OLGA": "V. OLGA",
  "LA VEGA": "LA VEGA",
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Color de texto para valores firmados — alineado con signedColorClass. */
function signedColor(value: number): string {
  if (value < 0) return "#dc2626" // red-600
  if (value > 0) return "#2563eb" // blue-600
  return "#059669"                // emerald-600
}

function alertaBg(a: "OK" | "Advertencia" | "Critico"): string {
  if (a === "OK") return "#059669"          // emerald-600
  if (a === "Advertencia") return "#d97706" // amber-600
  return "#dc2626"                          // red-600
}

function fmtN(n: number): string {
  return Math.round(n).toLocaleString("es-DO")
}

function fmtSemanaRango(fechaIso: string): string {
  if (!fechaIso) return "—"
  const clean = String(fechaIso).split("T")[0].trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return fechaIso
  const start = new Date(clean + "T12:00:00")
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const startTxt = start.toLocaleDateString("es-DO", { day: "2-digit", month: "short" })
  const endTxt = end.toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })
  return `Del ${startTxt} al ${endTxt}`
}

export function buildAuditoriaPdfHtml(snapshot: AuditoriaPdfSnapshot): string {
  const branding = snapshot.branding ?? getBusinessBranding(null)
  const brand = branding.primaryColor
  const logoSrc = absoluteLogoUrl(branding.logoUrl)
  const allRows = snapshot.semanas.flatMap(s => s.rows)
  const totalLaser = allRows.reduce((s, r) => s + r.dispLaser, 0)
  const totalOp = allRows.reduce((s, r) => s + r.dispOperador, 0)
  const totalDif = totalOp - totalLaser
  const totalOk = allRows.filter(r => r.alerta === "OK").length
  const totalWarn = allRows.filter(r => r.alerta === "Advertencia").length
  const totalCrit = allRows.filter(r => r.alerta === "Critico").length

  const semanasHtml = snapshot.semanas.map(semana => {
    const filasHtml = semana.rows.map(r => `
      <tr>
        <td><b>${escapeHtml(SUC_MAP[r.sucursal] || r.sucursal)}</b></td>
        <td class="center">${escapeHtml(r.cabina || "—")}</td>
        <td>${escapeHtml(r.operadora)}</td>
        <td class="center">${escapeHtml(r.equipo)}</td>
        <td class="num">${r.pulsosInicio > 0 ? fmtN(r.pulsosInicio) : "—"}</td>
        <td class="num">${r.pulsosFin > 0 ? fmtN(r.pulsosFin) : "—"}</td>
        <td class="num"><b>${fmtN(r.dispLaser)}</b></td>
        <td class="num">${fmtN(r.dispOperador)}</td>
        <td class="num" style="color: ${signedColor(r.diferencia)}; font-weight: 700">${r.diferencia > 0 ? "+" : ""}${fmtN(r.diferencia)}</td>
        <td class="num" style="color: ${signedColor(r.pct)}; font-weight: 700">${r.pct > 0 ? "+" : ""}${r.pct}%</td>
        <td class="center"><span class="badge" style="background: ${alertaBg(r.alerta)}; color: white">${escapeHtml(r.alerta === "Critico" ? "Crítico" : r.alerta === "Advertencia" ? "Advert." : "OK")}</span></td>
      </tr>`).join("")

    return `
    <h2>Semana ${escapeHtml(fmtSemanaRango(semana.fecha))} · ${semana.rows.length} equipo(s)</h2>
    <table>
      <thead><tr>
        <th>Sucursal</th>
        <th class="center">Cab.</th>
        <th>Operadora</th>
        <th class="center">Eq.</th>
        <th class="num">Pulsos Inicio</th>
        <th class="num">Pulsos Fin</th>
        <th class="num">DISP Láser</th>
        <th class="num">DISP Operador</th>
        <th class="num">Diferencia</th>
        <th class="num">%</th>
        <th class="center">Estado</th>
      </tr></thead>
      <tbody>
        ${filasHtml}
        <tr class="total-row">
          <td colspan="4"><b>TOTAL SEMANA</b></td>
          <td class="num"><b>${semana.totPulsosInicio > 0 ? fmtN(semana.totPulsosInicio) : "—"}</b></td>
          <td class="num"><b>${semana.totPulsosFin > 0 ? fmtN(semana.totPulsosFin) : "—"}</b></td>
          <td class="num"><b>${fmtN(semana.totDispLaser)}</b></td>
          <td class="num"><b>${fmtN(semana.totDispOp)}</b></td>
          <td class="num" style="color: ${signedColor(semana.totDiferencia)}; font-weight: 800">${semana.totDiferencia > 0 ? "+" : ""}${fmtN(semana.totDiferencia)}</td>
          <td colspan="2"></td>
        </tr>
      </tbody>
    </table>`
  }).join("\n")

  return `<!doctype html><html lang="es"><head><meta charset="utf-8" />
<title>Auditoría PULSE - ${escapeHtml(snapshot.generadoEn)}</title>
<style>
  @page { size: letter landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 10.5px; margin: 0; --brand: ${brand}; }
  .logo-img { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; }
  .header {
    border-bottom: 3px solid var(--brand);
    padding-bottom: 12px;
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo-circle {
    width: 48px; height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--brand) 0%, #00bfa5 100%);
    color: white;
    font-weight: 900;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    letter-spacing: -1px;
  }
  .brand-text { line-height: 1.2; }
  .brand-name { font-size: 16px; font-weight: 900; color: var(--brand); letter-spacing: .02em; }
  .brand-tagline { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: .12em; margin-top: 1px; }
  h1 { font-size: 14px; margin: 6px 0 2px; color: #0f172a; }
  .meta { color: #475569; font-size: 9.5px; }
  .meta b { color: #0f172a; }
  .header-right { text-align: right; }

  h2 {
    font-size: 11px;
    background: var(--brand);
    color: white;
    padding: 5px 10px;
    margin: 16px 0 6px;
    text-transform: uppercase;
    letter-spacing: .04em;
    border-radius: 4px;
    page-break-after: avoid;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
    margin-bottom: 8px;
  }
  .stat {
    border: 1px solid #d7dee8;
    border-radius: 6px;
    padding: 8px 6px;
    text-align: center;
    background: #fafbfc;
  }
  .stat .v { font-size: 17px; font-weight: 800; line-height: 1; }
  .stat .l { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #64748b; margin-top: 4px; }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 8px;
    page-break-inside: auto;
  }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  th, td {
    padding: 4px 6px;
    border: 1px solid #e2e8f0;
    font-size: 10px;
    vertical-align: middle;
  }
  th { background: #f1f5f9; text-align: left; font-weight: 700; color: #1e293b; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.center, th.center { text-align: center; }
  tr.total-row td { background: #f1f5f9; font-weight: 700; }

  .badge {
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .03em;
    white-space: nowrap;
    display: inline-block;
  }

  .legend {
    margin-top: 14px;
    padding: 8px 10px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 9px;
    color: #475569;
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

  .footer {
    margin-top: 16px;
    padding-top: 8px;
    border-top: 1px solid #e5e7eb;
    color: #64748b;
    font-size: 8.5px;
    text-align: center;
  }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>

<div class="header">
  <div class="brand">
    ${logoSrc
      ? `<img class="logo-img" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(branding.name)}" />`
      : `<div class="logo-circle">${escapeHtml(branding.shortName)}</div>`}
    <div class="brand-text">
      <div class="brand-name">${escapeHtml(branding.name).toUpperCase()}</div>
      <div class="brand-tagline">${escapeHtml(branding.subtitle)}</div>
    </div>
  </div>
  <div class="header-right">
    <h1>Auditoría PULSE / IA</h1>
    <div class="meta">Generado: <b>${escapeHtml(snapshot.generadoEn)}</b></div>
    ${snapshot.generadoPor ? `<div class="meta">Por: <b>${escapeHtml(snapshot.generadoPor)}</b></div>` : ""}
    <div class="meta">Semana: <b>${escapeHtml(snapshot.filtroSemana)}</b> · Sucursal: <b>${escapeHtml(snapshot.filtroSucursal)}</b></div>
  </div>
</div>

<h2>Resumen ejecutivo</h2>
<div class="summary">
  <div class="stat">
    <div class="v" style="color: var(--brand)">${allRows.length}</div>
    <div class="l">Registros</div>
  </div>
  <div class="stat">
    <div class="v" style="color: #059669">${totalOk}</div>
    <div class="l">OK</div>
  </div>
  <div class="stat">
    <div class="v" style="color: #d97706">${totalWarn}</div>
    <div class="l">Advert.</div>
  </div>
  <div class="stat">
    <div class="v" style="color: #dc2626">${totalCrit}</div>
    <div class="l">Críticos</div>
  </div>
  <div class="stat">
    <div class="v">${fmtN(totalLaser)}</div>
    <div class="l">Disp. Láser</div>
  </div>
  <div class="stat">
    <div class="v">${fmtN(totalOp)}</div>
    <div class="l">Disp. Operador</div>
  </div>
</div>

<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 4px">
  <div class="stat">
    <div class="v" style="color: ${signedColor(totalDif)}">${totalDif > 0 ? "+" : ""}${fmtN(totalDif)}</div>
    <div class="l">Diferencia total</div>
  </div>
  <div class="stat">
    <div class="v">${snapshot.semanas.length}</div>
    <div class="l">Semanas</div>
  </div>
  <div class="stat">
    <div class="v">${totalLaser > 0 ? `${((totalDif / totalLaser) * 100).toFixed(2)}%` : "—"}</div>
    <div class="l">% diferencia global</div>
  </div>
</div>

${semanasHtml || `<div style="text-align: center; padding: 30px; color: #94a3b8">Sin datos en el rango seleccionado.</div>`}

<div class="legend">
  <div class="legend-item"><span class="dot" style="background: #dc2626"></span><b>Negativo</b> = uso láser sin registro de operadora</div>
  <div class="legend-item"><span class="dot" style="background: #2563eb"></span><b>Positivo</b> = operadora reportó más de lo que el equipo registra</div>
  <div class="legend-item"><span class="dot" style="background: #059669"></span><b>Cero</b> = cuadre exacto</div>
  <div class="legend-item"><span class="badge" style="background: #059669; color: white">OK</span> |diferencia| ≤ 2%</div>
  <div class="legend-item"><span class="badge" style="background: #d97706; color: white">Advert.</span> 3%–15%</div>
  <div class="legend-item"><span class="badge" style="background: #dc2626; color: white">Crítico</span> &gt; 15%</div>
</div>

<div class="footer">
  ${escapeHtml(branding.footerText)} · Auditoría PULSE / IA · Reporte generado el ${escapeHtml(snapshot.generadoEn)} ·
  ${allRows.length} registro(s) en ${snapshot.semanas.length} semana(s)
</div>

</body></html>`
}

/** Abre popup, escribe el HTML y dispara el diálogo de impresión. */
export function printAuditoria(snapshot: AuditoriaPdfSnapshot): void {
  const html = buildAuditoriaPdfHtml(snapshot)
  const popup = window.open("", "_blank", "width=1200,height=900")
  if (!popup) return
  popup.document.write(html)
  popup.document.close()
  popup.onload = () => setTimeout(() => popup.print(), 400)
}
