// Corrige nombres oficiales de operadoras (tabla actualizada): KATHERIN/EMELI/ROQUELMI.
// No destructivo: UPDATE/PATCH; nunca DELETE. No toca seriales ni pulsos.
const fs = require("fs")
for (const ln of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "") }
const U = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(), K = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const H = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" }
const get = async p => (await fetch(U + p, { headers: H })).json()
const patch = async (p, b) => { const r = await fetch(U + p, { method: "PATCH", headers: H, body: JSON.stringify(b) }); return r.ok ? true : (console.log("  PATCH fail " + p + ": " + r.status + " " + (await r.text()).slice(0, 90)), false) }
const ALIAS = { KATHERINE: "KATHERIN", EMELY: "EMELI", RIQUELMI: "ROQUELMI", YESICA: "YESSICA", SAOMY: "SAHOMY" }
const EQ_OFICIAL = { "10": "NAYELI", "13": "LILIAN", "11": "YAMILKA", "9": "KATHERIN", "7": "DIANA", "8": "EMELI", "5": "ROQUELMI", "1": "MADELIN", "6": "ROSA", "17": "SAHOMY", "19": "YESSICA" }
;(async () => {
  const cibao = (await get("/rest/v1/businesses?select=id&slug=eq.csl"))[0]; const B = cibao.id

  // 1) csl_equipos — operadora oficial por equipo
  console.log("== csl_equipos ==")
  for (const [eqId, op] of Object.entries(EQ_OFICIAL)) {
    const ok = await patch(`/rest/v1/csl_equipos?business_id=eq.${B}&equipo_id=eq.${encodeURIComponent(eqId)}`, { operadora: op, updated_at: new Date().toISOString() })
    if (ok) console.log(`  Eq${eqId} -> ${op}`)
  }

  // 2) csl_operadoras — renombrar variantes al oficial (si no choca)
  console.log("== csl_operadoras ==")
  const ops = await get(`/rest/v1/csl_operadoras?select=operadora_id,nombre&business_id=eq.${B}`)
  const opNames = new Set(ops.map(o => (o.nombre || "").toUpperCase()))
  for (const o of ops) {
    const up = (o.nombre || "").toUpperCase(); const off = ALIAS[up]
    if (off && !opNames.has(off)) { if (await patch(`/rest/v1/csl_operadoras?operadora_id=eq.${o.operadora_id}&business_id=eq.${B}`, { nombre: off })) { console.log(`  ${o.nombre} -> ${off}`); opNames.add(off) } }
    else if (off) console.log(`  ${o.nombre}: ya existe ${off}, saltado`)
  }

  // 3) csl_operator_shots — consolidar variantes->oficial por (period,sucursal)
  console.log("== csl_operator_shots ==")
  const shots = await get(`/rest/v1/csl_operator_shots?select=id,period_start,period_end,sucursal_normalizada,operadora_normalizada,disparos,sesiones&business_id=eq.${B}`)
  const byKey = new Map(); for (const s of shots) byKey.set(`${s.period_start}|${s.period_end}|${s.sucursal_normalizada}|${s.operadora_normalizada}`, s)
  let merged = 0, renamed = 0
  for (const s of shots) {
    const off = ALIAS[s.operadora_normalizada]; if (!off) continue
    const k = `${s.period_start}|${s.period_end}|${s.sucursal_normalizada}|${off}`
    const officialRow = byKey.get(k)
    if (officialRow) {
      const val = Math.max(Number(officialRow.disparos) || 0, Number(s.disparos) || 0)
      const ses = Math.max(Number(officialRow.sesiones) || 0, Number(s.sesiones) || 0)
      await patch(`/rest/v1/csl_operator_shots?id=eq.${officialRow.id}`, { disparos: val, sesiones: ses, updated_at: new Date().toISOString() })
      await patch(`/rest/v1/csl_operator_shots?id=eq.${s.id}`, { disparos: 0, sesiones: 0, updated_at: new Date().toISOString() })
      officialRow.disparos = val; merged++
    } else {
      if (await patch(`/rest/v1/csl_operator_shots?id=eq.${s.id}`, { operadora_normalizada: off, updated_at: new Date().toISOString() })) { byKey.set(k, { ...s, operadora_normalizada: off }); renamed++ }
    }
  }
  console.log(`  consolidadas=${merged} renombradas=${renamed}`)

  // 4) pulse_readings — YESICA -> YESSICA (label)
  console.log("== csl_pulse_readings ==")
  const ok = await patch(`/rest/v1/csl_pulse_readings?business_id=eq.${B}&operadora=eq.YESICA`, { operadora: "YESSICA", updated_at: new Date().toISOString() })
  console.log("  YESICA->YESSICA: " + (ok ? "ok" : "n/a"))
  console.log("\nLISTO")
})().catch(e => { console.error(e.message); process.exit(1) })
