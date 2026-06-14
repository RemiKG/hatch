# Hatch — single-origin image: build the Vite web app, then run the Express server that serves it + the API.
FROM node:20-slim

WORKDIR /app

# Server deps (root package.json) first for layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Web deps + build (needs dev deps like vite, so a plain install in the web dir).
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm install

# App source.
COPY . .

# Produce web/dist (the server serves it from the same origin).
RUN cd web && npm run build

# Cloud Run provides PORT; the server already reads process.env.PORT.
ENV PORT=8080
EXPOSE 8080

# No --env-file here: env comes from Cloud Run service config (secrets + Vertex via the bound SA).
CMD ["node", "server/index.mjs"]
