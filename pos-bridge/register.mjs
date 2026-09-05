// Engancha el resolver de imports sin extensión (los de `src/` del repo) antes de
// cargar el CLI. Mismo molde que `scripts/pool-backfill/register.mjs`.
import { register } from 'node:module'
register('./ts-resolve-hook.mjs', import.meta.url)
