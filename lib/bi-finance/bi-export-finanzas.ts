/**
 * Hojas y secciones extra del export financiero: flujo mensual, ventas por
 * servicio e histórico anual. Lógica PURA (sin ExcelJS ni DOM) para que
 * `bi-export.ts` solo tenga que enchufarlas.
 */
import type { BiSummary } from "@/components/bi-finance/bi-shared"
import { serviceRows, flujoTotals, inversionBranches, fmtGrowth } from "./finanzas-format"

export interface ExportCol { header: string; key: string; width?: number; money?: boolean; pct?: boolean }
export interface ExportSheet { name: string; title: string; cols: ExportCol[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> }

const rd = (n: number) => Math.round(Number(n) || 0)
const esc = (s: unknown) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c))
const money = (n: number) => "RD$" + rd(n).toLocaleString("en-US")

/** Las tres hojas nuevas del Excel ejecutivo. */
export function finanzasSheets(summary: BiSummary): ExportSheet[] {
  const out: ExportSheet[] = []
  const flujo = summary.flujoMensual || []
  if (flujo.length) {
    const branches = inversionBranches(flujo)
    const total = flujoTotals(flujo)
    const toRow = (r: typeof total) => ({
      label: r.label, ventas: r.ventas, gastos: r.gastosOperativos, invGeneral: r.inversionGeneral,
      ...Object.fromEntries(branches.map((b) => [`inv_${b}`, r.inversionByBranch?.[b] || 0])),
      retiros: r.retiros, neto: r.neto,
    })
    out.push({
      name: "Flujo mensual", title: "Flujo de efectivo mensual (12 meses)",
      cols: [
        { header: "Mes", key: "label", width: 16 },
        { header: "Ventas", key: "ventas", money: true },
        { header: "Gastos oper.", key: "gastos", money: true },
        { header: "Inv. general", key: "invGeneral", money: true },
        ...branches.map((b) => ({ header: `Inv. ${b}`, key: `inv_${b}`, money: true })),
        { header: "Retiros socios", key: "retiros", money: true },
        { header: "Flujo neto", key: "neto", money: true },
      ],
      rows: flujo.map(toRow), totals: toRow(total),
    })
  }
  const servicios = serviceRows(summary.ingresos.porServicio)
  if (servicios.some((s) => s.monto > 0)) {
    out.push({
      name: "Ventas por servicio", title: "Ventas por servicio",
      cols: [{ header: "Servicio", key: "label", width: 22 }, { header: "Ventas", key: "monto", money: true }, { header: "% del total", key: "pct", pct: true }],
      rows: servicios.map((s) => ({ label: s.label, monto: s.monto, pct: s.pct })),
    })
  }
  const hist = summary.historicoAnual || []
  if (hist.length) {
    out.push({
      name: "Histórico anual", title: "Histórico anual de ventas",
      cols: [{ header: "Año", key: "year", width: 12 }, { header: "Ventas", key: "ventas", money: true }, { header: "Crecimiento", key: "crecimiento", width: 16 }],
      rows: hist.map((h) => ({ year: `${h.year}${h.parcial ? " (parcial)" : ""}`, ventas: h.ventas, crecimiento: fmtGrowth(h.crecimientoPct) })),
    })
  }
  return out
}

/** Sección HTML del flujo mensual para el PDF ejecutivo. */
export function finanzasPdfSection(summary: BiSummary): string {
  const flujo = summary.flujoMensual || []
  if (!flujo.length) return ""
  const branches = inversionBranches(flujo)
  const total = flujoTotals(flujo)
  const cells = (r: typeof total) => [money(r.ventas), money(r.gastosOperativos), money(r.inversionGeneral),
    ...branches.map((b) => money(r.inversionByBranch?.[b] || 0)), money(r.retiros), money(r.neto)]
    .map((v) => `<td class="r">${v}</td>`).join("")
  const head = ["Mes", "Ventas", "Gastos oper.", "Inv. general", ...branches.map((b) => `Inv. ${b}`), "Retiros socios", "Flujo neto"]
  return `
    <h2>Flujo de efectivo mensual (12 meses)</h2>
    <table><thead><tr>${head.map((h, i) => `<th${i ? ' class="r"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${flujo.map((r) => `<tr><td>${esc(r.label)}</td>${cells(r)}</tr>`).join("")}</tbody>
    <tfoot><tr><td>TOTAL</td>${cells(total)}</tr></tfoot></table>`
}
