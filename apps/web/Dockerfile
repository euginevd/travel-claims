# Build from the repo root: docker build -f apps/web/Dockerfile .
FROM node:24-bookworm-slim AS build
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json apps/web/.npmrc ./
RUN npm ci
COPY apps/web ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD ["wget", "-qO-", "http://127.0.0.1:8080/"]
