const fs=require("fs"),path=require("path")
const env=path.join(__dirname,"../.env.local")
if(fs.existsSync(env))for(const ln of fs.readFileSync(env,"utf8").split(/\r?\n/)){const m=ln.match(/^([A-Z0-9_]+)=(.*)$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,"")}
const URL=(process.env.NEXT_PUBLIC_SUPABASE_URL||"").trim(),KEY=(process.env.SUPABASE_SERVICE_ROLE_KEY||"").trim()
const H={apikey:KEY,Authorization:`Bearer ${KEY}`}
const get=async p=>{const r=await fetch(URL+p,{headers:H});if(!r.ok)throw new Error(`${p}: ${r.status} ${await r.text()}`);return r.json()}
;(async()=>{
  const emails=["cariascmad@gmail.com","wrodriguez3030@gmail.com"]
  for(const e of emails){
    const rows=await get(`/rest/v1/csl_user_profiles?select=user_id,nombre,username,is_admin,is_superadmin,activo,business_id,menus&username=eq.${encodeURIComponent(e)}`)
    if(!rows.length){console.log(`\n${e}: NO EXISTE`);continue}
    const u=rows[0]
    console.log(`\n=== ${e} ===`)
    console.log(`  user_id: ${u.user_id}`)
    console.log(`  nombre: ${u.nombre}`)
    console.log(`  is_admin: ${u.is_admin}  is_superadmin: ${u.is_superadmin}  activo: ${u.activo}`)
    console.log(`  business_id: ${u.business_id}`)
    console.log(`  menus(${(u.menus||[]).length}): ${JSON.stringify(u.menus)}`)
  }
})().catch(e=>{console.error("ERR",e.message);process.exit(1)})
