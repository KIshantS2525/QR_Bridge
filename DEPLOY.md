# Deployment

This app has no server functions (no `createServerFn` anywhere) — it's 100%
client-side (camera, canvas, QR, file handling). The build layer (Nitro, via
TanStack Start) still produces a small SSR shell for the initial HTML, and it
auto-targets whatever platform it's built on.

## Vercel — verified, zero config

Actually tested: building with Vercel's own `VERCEL=1` env var set (which
Vercel's platform sets automatically on every build, CLI or Git integration)
against this repo **unmodified** produces a fully valid Vercel Build Output
API v3 bundle:

- `.vercel/output/config.json` — version 3, correct routing (static assets
  cached immutably, everything else proxied to the server function)
- `.vercel/output/functions/__server.func/.vc-config.json` — valid Node.js
  function config with streaming enabled

**To deploy:** push to GitHub, import the repo in Vercel, done. No
`vercel.json`, no `vite.config.ts` edit, nothing. Vercel runs
`npm install && npm run build` and picks up `.vercel/output` as-is.

One non-blocking note from the build log: a few JS chunks are >500KB
post-minification, mainly `@react-three/drei` (the animated background
scene, unrelated to the QR/fountain-coding logic). It deploys and runs fine;
worth revisiting with code-splitting only if initial load time becomes a
concern.

## GitHub Pages — not push-button today

The app is a legitimate candidate for pure static hosting (no server
functions), and Nitro even ships a purpose-built `github-pages` preset
(auto `.nojekyll`, prerendering, `gh-pages` deploy script). Tried directly via:

```ts
// vite.config.ts
export default defineConfig({
  // ...
  nitro: { preset: "github-pages" },
});
```

This gets partway there, but the prerender step 404s on `/` and the build
fails after — a version-compatibility snag between this template's pinned
TanStack Start (`1.168.32`) and the pre-release Nitro v3 beta it ships with,
not an issue with the app's own code. Fixable with some prerender/route
config work, just not a one-line change — ask if you want this chased down.
