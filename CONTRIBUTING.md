# Guía de contribución — csl-app

Cómo hacer y **documentar cada cambio** para que el equipo sepa qué cambió y por qué.
**Obligatoria para todos los colaboradores.**

- **Repositorios:** `gitea` → `http://infra:3000/ARB/csl-app` · `origin` → GitHub (`wrodriguez3030-del/csl-app`)
- **Red:** Tailscale en tailnet `cibaocloud@` (que `infra` responda) para `push`/`pull` a Gitea.
- **Rama principal:** `main`. **Stack:** Next.js 16 + Supabase self-hosted (`db-cls.cibao-cloude.com`). Multi-tenant (CSL + Depicenter). Dev en `:3000`.

## 1. Flujo de cada cambio (OBLIGATORIO)

```bash
git checkout main && git pull gitea main
git checkout -b feat/nombre-corto          # un cambio = una rama
# ...editar y probar local (:3000)...
# 1) bump version en package.json (SemVer)  2) entrada en CHANGELOG.md
git add -A
git commit -m "feat: agrega X"             # Conventional Commits
git push gitea feat/nombre-corto           # y a origin (GitHub) si aplica
# Abrir Pull Request en Gitea hacia main
```

> **Deploy:** producción se auto-promueve con `vercel --prod --yes` tras push aprobado.
> **Multi-tenant:** nunca mezclar datos entre tenants; los filtros por `business_id`
> (AsyncLocalStorage + RLS) son críticos. **Doble confirmación `CONFIRMO BORRAR`**
> para DELETE/DROP/borrado masivo/cambios salariales reales/mover datos entre tenants.

## 2. SemVer (`MAJOR.MINOR.PATCH`)
- **PATCH** (`0.1.0→0.1.1`): bugfix. · **MINOR** (`→0.2.0`): feature compatible. · **MAJOR** (`→1.0.0`): rompe.
- Tag opcional: `git tag -a v0.2.0 -m "..." && git push gitea v0.2.0`

## 3. CHANGELOG.md (Keep a Changelog)
Categorías: **Added / Changed / Deprecated / Removed / Fixed / Security**.
Escribe bajo `## [Unreleased]` y al publicar muévelo a una versión con fecha. Describe **qué cambió y por qué**.

## 4. Commits — Conventional Commits
`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`. Ej: `feat(nomina): agrega cálculo TSS 2026`.

## 5. Checklist antes del push
- [ ] Funciona local (`:3000`). · [ ] No subí `.env` ni `node_modules`.
- [ ] Bump de versión. · [ ] Entrada en CHANGELOG. · [ ] Commit convencional. · [ ] PR abierto.

## 6. Comandos
```bash
git pull gitea main
git push gitea <rama>
git push gitea --tags
```
