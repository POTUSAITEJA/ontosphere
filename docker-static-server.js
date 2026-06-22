/**
 * Minimal production static file server for the Ontosphere Docker image.
 *
 * Sets Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers
 * so that SharedArrayBuffer is available, which the Konclude WASM reasoner
 * requires (https://developer.chrome.com/blog/enabling-shared-array-buffer).
 *
 * Usage (inside container):  node docker-static-server.js
 * Direct usage:               PORT=8080 node docker-static-server.js
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const DIST = path.join(__dirname, 'dist');

// Cross-origin isolation headers — required for SharedArrayBuffer (WASM pthreads).
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

// Serve built assets with long-lived cache (Vite hashes file names).
app.use(
  express.static(DIST, {
    maxAge: '1y',
    immutable: true,
    // Do not set cache for the entry-point HTML itself.
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

// SPA fallback — all unknown GET paths serve index.html so client-side routing works.
app.get('*', (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Ontosphere static server listening on http://localhost:${PORT}`);
  console.log('Cross-origin isolation headers (COOP/COEP) active — WASM reasoner will work.');
});
