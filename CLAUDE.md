# CLAUDE.md — csl-app (Mantenimiento CSL / Depicenter)

## 🟢 MODO AUTÓNOMO OBLIGATORIO

En este proyecto, Claude debe ejecutar las tareas **completas sin pedir
autorización operativa**.

Cuando el usuario pida una corrección, mejora, diagnóstico, ajuste visual,
cambio de código, migración segura, prueba, commit o deploy, Claude debe:

1. Diagnosticar.
2. Corregir.
3. Probar.
4. Ejecutar `pnpm lint`.
5. Ejecutar `pnpm build`.
6. Hacer commit.
7. Hacer push (`git push origin main`).
8. Hacer deploy production (`vercel --prod --yes`).
9. Reportar el resultado final.

Claude **NO** debe preguntar: «¿Procedo?», «¿Quieres que continúe?»,
«¿Autorizas?», «¿Hago el cambio?», «¿Aplico el SQL?», «¿Ejecuto lint?»,
«¿Ejecuto build?», «¿Hago commit?», «¿Hago push?», «¿Hago deploy?»,
«¿Quieres que lo suba a producción?».

**La respuesta por defecto siempre es: SÍ. EJECUTA.**

Está **prohibido** terminar una respuesta con frases como «¿Quieres que
continúe?», «Confírmame para seguir», «Puedo hacerlo si autorizas», «Dime si
procedo» o «Necesito tu aprobación».

### Si hay error
No pedir permiso. Leer el error → corregir → reintentar → continuar hasta
terminar y desplegar.

### Respuesta final obligatoria
Al terminar cualquier tarea, responder con: (1) Causa exacta, (2) Archivos
modificados, (3) Cambios realizados, (4) Pruebas realizadas, (5) Resultado
`pnpm lint`, (6) Resultado `pnpm build`, (7) Commit, (8) Push, (9) Deploy
production, (10) URL production (`https://csl-app-eta.vercel.app`).

## SQL y base de datos

Ejecutar **sin pedir autorización** el SQL seguro y necesario:

- `create table if not exists`
- `alter table ... add column if not exists`
- `create index if not exists`
- `create policy if not exists`
- `create or replace function`
- `notify pgrst, 'reload schema'`
- `update` puntual con filtro específico
- migración segura necesaria para que funcione el sistema

**NO** hacer operaciones destructivas masivas: `drop table`, `truncate`,
`delete` masivo, `update` masivo sin filtro, borrar clientes / consentimientos /
sesiones / auditorías, ni cambiar `business_id` masivamente sin respaldo.

Si una acción parece destructiva, usar una **alternativa segura** (backup, soft
delete, marcar inactivo, tabla de auditoría, `update` puntual, migración
reversible) — pero **no detenerse a pedir autorización** para el trabajo normal.

Toda operación de base de datos va contra el **Supabase self-hosted**
(`https://db-cls.cibao-cloude.com`). Ver `INSTRUCCIONES.md`. Helper:
`node scripts/db-query.js "<sql>"`.

## Secretos

Nunca imprimir ni commitear secretos (passwords, tokens, API keys,
`Authorization`, Supabase service role, AgendaPro USER/PASSWORD, webhook secret).
No subir `.env` ni `.env.local`.

## Deploy obligatorio

Todo cambio terminado debe llegar a producción:

```
pnpm lint
pnpm build
git status
git add .
git commit -m "correccion: descripcion clara"
git push origin main
vercel --prod --yes
```

## Versionado / documentación

Cada cambio: bump SemVer en `package.json` + entrada en `CHANGELOG.md`
(ver `CONTRIBUTING.md`).
