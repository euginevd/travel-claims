# Build from the repo root: docker build -f apps/portal/Dockerfile .
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS build
WORKDIR /web
COPY apps/portal/package.json apps/portal/package-lock.json apps/portal/.npmrc ./
RUN npm ci
COPY apps/portal ./
# Only a local image offers the seeded customers on its sign-in page.
ARG VITE_LOCAL_SIGN_IN=false
ENV VITE_LOCAL_SIGN_IN=$VITE_LOCAL_SIGN_IN
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.6-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03
COPY apps/portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD ["wget", "-qO-", "http://127.0.0.1:8080/"]
