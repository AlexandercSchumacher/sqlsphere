# Multi-stage Dockerfile: build the Vite bundle, serve it with nginx,
# and proxy backend routes to the FastAPI container so the entire
# stack is reachable from a single same-origin HTTP localhost URL
# (defaults to http://localhost:8080).
#
# Same-origin matters for Safari, which blocks every HTTPS-page ->
# HTTP-localhost request as Mixed Content even though Chrome and
# Firefox special-case localhost as a secure context. Serving the
# frontend over HTTP from the same port the API is reached at
# sidesteps the issue entirely.

FROM node:20-alpine AS build
WORKDIR /app
COPY lovable/query-sage-lab/package.json lovable/query-sage-lab/package-lock.json ./
RUN npm ci --no-fund --no-audit --ignore-scripts
COPY lovable/query-sage-lab/ ./
# Empty VITE_BACKEND_URL makes the bundle fall back to
# window.location.origin at runtime, which is exactly what we want
# when nginx is also proxying /api, /chat, /query, etc.
ENV VITE_BACKEND_URL=""
ENV VITE_LOCAL_MODE="true"
RUN npm run build

FROM nginx:alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY docker/nginx-frontend.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
