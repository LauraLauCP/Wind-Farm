# Wind Farm — front-end (Part 3)

React 19 + Vite + TypeScript SPA that queries the Wind Farm API
(`/api/datos`, `/api/estaciones`) and renders the dataset as small-multiple
line charts and a sortable, paginated table.

```bash
npm install
npm run dev        # http://localhost:5173 — proxies /api to :3000
npm test           # unit + smoke tests (jsdom, fetch stubbed)
npm run build      # bundles to dist/, served by the Express API in prod
```

See the root README for the full picture.
