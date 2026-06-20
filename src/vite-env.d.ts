/// <reference types="vite/client" />

// Identidad del build inyectada por vite `define` (ver vite.config.ts). Se compara contra
// {BASE}version.json (cache-bust) para detectar un deploy nuevo. Ver _handoff/PROD-SW-RCA.md.
declare const __APP_COMMIT__: string
