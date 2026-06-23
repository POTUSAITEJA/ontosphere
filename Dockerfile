# ── Stage 1: build ────────────────────────────────────────────────────────────
# Pin to a specific node:22-slim digest for reproducibility.
# To update: docker pull node:22-slim and replace the tag with the new digest.
FROM node:22-slim AS builder

WORKDIR /app

# Copy manifests first so dependency installation is cached as a separate layer.
COPY package.json package-lock.json ./

# Install exact locked versions (no network calls beyond npm registry).
RUN npm ci

# Copy the rest of the source tree and build.
COPY . .
RUN npm run build

# ── Stage 2: serve ────────────────────────────────────────────────────────────
# Minimal Node runtime; no build tools, no source, only dist/.
FROM node:22-slim AS server

WORKDIR /app

# Only the production dependency for the static file server.
# express is already a runtime dependency (listed in package.json dependencies),
# so we install only it rather than the full node_modules tree.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built assets and the production server script from the builder stage.
COPY --from=builder /app/dist ./dist

# Production static server — sets the required COOP/COEP headers for SharedArrayBuffer
# (used by the Konclude WASM reasoner).
# See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements
COPY --from=builder /app/docker-static-server.js ./

EXPOSE 8080

ENV PORT=8080 \
    NODE_ENV=production

# One-command run (after image build):
#   docker run --rm -p 8080:8080 ontosphere:latest
# Then open http://localhost:8080 in a Chromium-based browser.
CMD ["node", "docker-static-server.js"]
