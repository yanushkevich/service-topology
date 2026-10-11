# Backend scaffold (not active)

Files that belong at the root of the future `backend/` Go module. They live here until Milestone B1 creates `backend/` and moves them:

| File here | Becomes | Notes |
|---|---|---|
| `Makefile` | `backend/Makefile` | targets assume commands run from `backend/` |
| `docker-compose.yml` | `backend/docker-compose.yml` | ArcadeDB `26.10.1`, bound to `127.0.0.1:2480` |
| `.env.example` | `backend/.env.example` | no secrets; password via `secrets/` file |
| `.gitignore` | `backend/.gitignore` | ignores `secrets/` and `.env` (also protects this folder) |
| `backend-CLAUDE.md` | `backend/CLAUDE.md` | backend agent rules; the root `CLAUDE.md` still applies |
| `topology-backend-SKILL.md` | `.claude/skills/topology-backend/SKILL.md` (optional) | install only if wanted |

Nothing here is run by the frontend toolchain. Do not create `secrets/` here.
