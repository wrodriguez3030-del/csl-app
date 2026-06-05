// Codemod de un solo uso: reemplaza inputs de "ID Empleado" por <EmployeeSelect>
// en los módulos de RR.HH. Idempotente y verificable (aborta si un patrón no aparece).
const fs = require("fs")
const path = require("path")
const dir = path.join(__dirname, "../components/hr")

const IMPORT_ANCHOR = 'import { Input } from "@/components/ui/input"'
const IMPORT_LINE = 'import { EmployeeSelect } from "@/components/hr/employee-select"'

// find → replace por archivo (solo el input de empleado)
const EDITS = {
  "rrhh-dias-laborados-page.tsx": [[
    `<div className="space-y-1 col-span-2"><Label className="text-xs">ID Empleado *</Label><Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="sol_... o EMP-001" /></div>`,
    `<div className="space-y-1 col-span-2"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", employee_nombre: emp?.nombre || "", sueldo_mensual: emp?.sueldo || editing.sueldo_mensual || 0, sucursal: emp?.sucursal || editing.sucursal || "" })} /></div>`,
  ]],
  "rrhh-incentivos-page.tsx": [[
    `<div className="space-y-1"><Label className="text-xs">ID Empleado *</Label><Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="sol_... o EMP-001" /></div>`,
    `<div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", employee_nombre: emp?.nombre || "" })} /></div>`,
  ]],
  "rrhh-vacaciones-page.tsx": [[
    `<div className="space-y-1"><Label className="text-xs">ID Empleado *</Label><Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="sol_... o EMP-001" /></div>`,
    `<div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", employee_nombre: emp?.nombre || "" })} /></div>`,
  ]],
  "rrhh-prestamos-page.tsx": [[
    `<div className="space-y-1"><Label className="text-xs">ID Empleado *</Label><Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="sol_... o EMP-001" /></div>`,
    `<div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", employee_nombre: emp?.nombre || "" })} /></div>`,
  ]],
  "rrhh-doble-sueldo-page.tsx": [[
    `<div className="space-y-1"><Label className="text-xs">ID Empleado *</Label><Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="sol_... o EMP-001" /></div>`,
    `<div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", employee_nombre: emp?.nombre || "", sueldo_mensual: emp?.sueldo || editing.sueldo_mensual || 0 })} /></div>`,
  ]],
  "rrhh-liquidaciones-page.tsx": [[
    `<div className="space-y-1 col-span-2"><Label className="text-xs">ID Empleado *</Label><Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="sol_... o EMP-001" /></div>`,
    `<div className="space-y-1 col-span-2"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", employee_nombre: emp?.nombre || "", sueldo_mensual: emp?.sueldo || editing.sueldo_mensual || 0 })} /></div>`,
  ]],
  "rrhh-permisos-page.tsx": [[
    `<div className="space-y-1 col-span-2"><Label className="text-xs">ID Empleado *</Label><Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="EMP-001" /></div>`,
    `<div className="space-y-1 col-span-2"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "" })} /></div>`,
  ]],
  "rrhh-txt-bancarios-page.tsx": [[
    `<div className="space-y-1"><Label className="text-xs">ID Empleado *</Label><Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="sol_... o EMP-001" /></div>`,
    `<div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", beneficiary: emp?.nombre || editing.beneficiary || "" })} /></div>`,
  ]],
  "rrhh-documentos-page.tsx": [[
    `                  <Label className="text-xs">ID Empleado *</Label>\n                  <Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="EMP-001" />`,
    `                  <Label className="text-xs">Empleado *</Label>\n                  <EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "" })} />`,
  ]],
  "rrhh-horarios-page.tsx": [[
    `                <Label className="text-xs">ID Empleado *</Label>\n                <Input value={assigning.employee_id || ""} onChange={e => setAssigning({ ...assigning, employee_id: e.target.value })} placeholder="EMP-001" />`,
    `                <Label className="text-xs">Empleado *</Label>\n                <EmployeeSelect value={assigning.employee_id} onSelect={emp => setAssigning({ ...assigning, employee_id: emp?.empleado_id || "", sucursal: emp?.sucursal || assigning.sucursal || "" })} />`,
  ]],
  "rrhh-contratos-page.tsx": [[
    `                  <Label className="text-xs">ID Empleado *</Label>\n                  <Input\n                    value={editing.employee_id || ""}\n                    onChange={e => setEditing({ ...editing, employee_id: e.target.value })}\n                    placeholder="EMP-001"\n                  />`,
    `                  <Label className="text-xs">Empleado *</Label>\n                  <EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", salary: emp?.sueldo ?? editing.salary ?? null, position_name: emp?.puesto || editing.position_name || "" })} />`,
  ]],
  "rrhh-ponche-page.tsx": [
    [
      `<div className="space-y-1"><Label className="text-xs">ID Empleado *</Label><Input value={correction.employee_id || ""} onChange={e => setCorrection({ ...correction, employee_id: e.target.value })} placeholder="EMP-001" /></div>`,
      `<div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={correction.employee_id} onSelect={emp => setCorrection({ ...correction, employee_id: emp?.empleado_id || "" })} /></div>`,
    ],
    [
      `<div className="space-y-1"><Label className="text-xs">ID Empleado *</Label><Input value={pinDialog.employee_id} onChange={e => setPinDialog({ ...pinDialog, employee_id: e.target.value })} placeholder="EMP-001" /></div>`,
      `<div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={pinDialog.employee_id} onSelect={emp => setPinDialog({ ...pinDialog, employee_id: emp?.empleado_id || "" })} /></div>`,
    ],
  ],
  "rrhh-asistencia-page.tsx": [[
    `<div><Label className="text-xs">Empleado</Label><Input value={empFilter} onChange={e => setEmpFilter(e.target.value)} placeholder="ID empleado" className="h-8 w-40" /></div>`,
    `<div className="w-56"><Label className="text-xs">Empleado</Label><div className="flex items-center gap-1"><EmployeeSelect value={empFilter} onSelect={emp => setEmpFilter(emp?.empleado_id || "")} placeholder="Todos" />{empFilter && <button type="button" className="text-xs text-muted-foreground underline shrink-0" onClick={() => setEmpFilter("")}>limpiar</button>}</div></div>`,
  ]],
}

let totalFiles = 0, totalEdits = 0
for (const [file, edits] of Object.entries(EDITS)) {
  const fp = path.join(dir, file)
  let src = fs.readFileSync(fp, "utf8")
  // import idempotente
  if (!src.includes(IMPORT_LINE)) {
    if (!src.includes(IMPORT_ANCHOR)) throw new Error(`${file}: no se encontró el anchor de import`)
    src = src.replace(IMPORT_ANCHOR, IMPORT_ANCHOR + "\n" + IMPORT_LINE)
  }
  for (const [from, to] of edits) {
    if (src.includes(to)) { console.log(`· ${file}: ya aplicado`); continue }
    if (!src.includes(from)) throw new Error(`${file}: patrón NO encontrado:\n${from.slice(0, 90)}…`)
    src = src.replace(from, to)
    totalEdits++
    console.log(`✓ ${file}: input reemplazado`)
  }
  fs.writeFileSync(fp, src)
  totalFiles++
}
console.log(`\nListo: ${totalEdits} input(s) en ${totalFiles} archivo(s).`)
