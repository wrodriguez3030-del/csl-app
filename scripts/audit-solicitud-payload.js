/**
 * Read-only: audita que las solicitudes de empleo lleguen COMPLETAS al sistema.
 * Trae las últimas 5 filas de csl_solicitudes_empleo y reporta, por cada una,
 * qué claves trae payload_json (el form completo) vs las columnas dedicadas.
 * No muta nada.
 */
const fs = require("fs")
const path = require("path")

// Cargar .env.local manualmente (sin dependencias extra).
const envText = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
const env = {}
for (const line of envText.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require("@supabase/supabase-js")
const sb = createClient(url, key, { auth: { persistSession: false } })

const EXPECTED_FORM_KEYS = [
  "fechaIngresoLaboral", "puestoSolicitado", "sucursal", "nombre", "apellido", "cedula",
  "fechaNacimiento", "tipoSangre", "sexo", "estatura", "peso", "estadoCivil", "nacionalidad",
  "telefonoResidencia", "celular", "calle", "numeroDir", "sector", "ciudad", "email",
  "licenciaConducir", "categoriaLicencia", "perteneceAFP", "cualAFP", "banco", "numeroCuenta",
  "tipoCuenta", "pretensionesSalariales", "emergenciaContacto", "nivelEducacion", "especialidad",
  "familia", "educacion", "experiencia", "referencias", "excel", "word", "powerPoint", "access",
  "windows", "otrosConocimientos", "disponibilidad", "firma", "observaciones",
]

;(async () => {
  const { data, error } = await sb
    .from("csl_solicitudes_empleo")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5)
  if (error) { console.error("ERROR:", error.message); process.exit(1) }
  console.log(`Filas: ${data.length}\n`)
  for (const row of data) {
    const pj = row.payload_json || {}
    const present = EXPECTED_FORM_KEYS.filter((k) => pj[k] !== undefined && pj[k] !== "" && !(Array.isArray(pj[k]) && pj[k].length === 0))
    const missing = EXPECTED_FORM_KEYS.filter((k) => pj[k] === undefined)
    console.log(`#${row.solicitud_id} | ${row.nombre} ${row.apellido} | business=${row.business_id?.slice(0, 8)} | estado=${row.estado}`)
    console.log(`  payload_json existe: ${!!row.payload_json} | claves totales: ${Object.keys(pj).length}`)
    console.log(`  campos con valor: ${present.length}/${EXPECTED_FORM_KEYS.length}`)
    console.log(`  arrays: familia=${(pj.familia||[]).length} educacion=${(pj.educacion||[]).length} experiencia=${(pj.experiencia||[]).length} referencias=${(pj.referencias||[]).length}`)
    console.log(`  firma: ${pj.firma ? "sí ("+String(pj.firma).slice(0,20)+"...)" : "NO"}`)
    if (missing.length) console.log(`  claves AUSENTES en payload_json: ${missing.join(", ")}`)
    console.log("")
  }
})()
