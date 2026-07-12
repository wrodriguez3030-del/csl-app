"use client"

/**
 * Selector de PERÍODO (mes/año) [+ sucursal] de Incentivos de Ventas — el
 * modelo estándar de filtros del módulo. Respaldado por el MISMO store global
 * (`commissionFilters`, zustand persistido) que la barra de filtros y el
 * dashboard: elegir "Mayo 2026" aquí se mantiene en TODAS las pantallas.
 *
 * Mes incluye "Todos los meses" (= todo el año seleccionado, month=0). Las
 * pantallas estrictamente mensuales (Cálculo mensual, Clientes atendidos)
 * pasan `allowAllMonths={false}` y muestran el mes efectivo.
 * La sucursal del picker es LOCAL a la pantalla (Clientes/Cálculo exigen una
 * sucursal concreta; no interfiere con el filtro global "Todas").
 */
import { useState } from "react"
import { useAppStore } from "@/lib/store"
import { monthBounds } from "@/lib/commission/period"
import { defaultCommissionFilters, type CommissionFilters } from "./comision-filter-bar"

export const COMMISSION_BRANCHES = ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]
export const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

// Sucursal compartida entre las pantallas del picker (local al módulo, en sesión).
const localShared: { branch: string } = { branch: COMMISSION_BRANCHES[0] }

/**
 * Período global del módulo con semántica de meses: month=0 = "Todos los meses"
 * (todo el año). `setMonth(0)` escribe quick="año" en el store global.
 */
export function usePeriodoCompartido() {
  const { commissionFilters, setCommissionFilters } = useAppStore()
  const f = (commissionFilters as CommissionFilters | null) || defaultCommissionFilters()
  const [branch, setB] = useState(localShared.branch)

  // month=0 cuando el filtro global es "todo el año" o "todo el historial".
  const month = f.quick === "año" || f.quick === "todo" ? 0 : Number(f.month) || new Date().getMonth() + 1
  const year = Number(f.year) || new Date().getFullYear()

  const setMonth = (m: number) => {
    if (m === 0) {
      setCommissionFilters({ ...f, quick: "año", month: 0, year, from: `${year}-01-01`, to: `${year}-12-31` })
    } else {
      const r = monthBounds(year, m)
      setCommissionFilters({ ...f, quick: "mes", month: m, year, from: r.from, to: r.to })
    }
  }
  const setYear = (y: number) => {
    if (month === 0) setCommissionFilters({ ...f, quick: "año", month: 0, year: y, from: `${y}-01-01`, to: `${y}-12-31` })
    else {
      const r = monthBounds(y, month)
      setCommissionFilters({ ...f, quick: "mes", month, year: y, from: r.from, to: r.to })
    }
  }
  return {
    month, year, branch,
    setMonth, setYear,
    setBranch: (v: string) => { localShared.branch = v; setB(v) },
  }
}

export function PeriodoSucursalPicker({
  month, year, branch, onMonth, onYear, onBranch, showBranch = false, allowAllMonths = true,
}: {
  month: number; year: number; branch?: string
  onMonth: (v: number) => void; onYear: (v: number) => void; onBranch?: (v: string) => void
  showBranch?: boolean
  /** false = pantalla estrictamente mensual (sin "Todos los meses"). */
  allowAllMonths?: boolean
}) {
  const now = new Date().getFullYear()
  const years = [now + 1, now, now - 1, now - 2]
  // Pantallas mensuales: si el período global es "Todos", mostrar el mes efectivo.
  const effMonth = !allowAllMonths && month === 0 ? new Date().getMonth() + 1 : month
  return (
    <>
      {showBranch && onBranch ? (
        <div>
          <label className="text-[11px] font-medium">Sucursal</label>
          <select className="mt-0.5 h-9 w-48 rounded-md border border-input bg-white px-2 text-sm" value={branch} onChange={(e) => onBranch(e.target.value)}>
            {COMMISSION_BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      ) : null}
      <div>
        <label className="text-[11px] font-medium">Mes</label>
        <select className="mt-0.5 h-9 w-40 rounded-md border border-input bg-white px-2 text-sm" value={effMonth} onChange={(e) => onMonth(Number(e.target.value))}>
          {allowAllMonths ? <option value={0}>Todos los meses</option> : null}
          {MONTHS_ES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </div>
      <div>
        <label className="text-[11px] font-medium">Año</label>
        <select className="mt-0.5 h-9 w-24 rounded-md border border-input bg-white px-2 text-sm" value={year} onChange={(e) => onYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </>
  )
}
