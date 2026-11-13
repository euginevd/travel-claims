# Build from the repo root: docker build -f apps/console/Dockerfile .
FROM node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS build
# The same depth as the repo, so the lock file's ../../packages/web-core link resolves.
WORKDIR /web/apps/console
COPY packages/web-core /web/packages/web-core
COPY apps/console/package.json apps/console/package-lock.json apps/console/.npmrc ./
RUN npm ci
COPY apps/console ./
# Only a local image offers the test engineer on its sign-in page.
ARG VITE_LOCAL_SIGN_IN=false
ENV VITE_LOCAL_SIGN_IN=$VITE_LOCAL_SIGN_IN
# AWS demo: the test-account buttons, signed in by the api through Cognito.
ARG VITE_TEST_SIGN_IN=false
ENV VITE_TEST_SIGN_IN=$VITE_TEST_SIGN_IN
# On AWS: the audience's Cognito client and region; empty means local sign-in.
ARG VITE_COGNITO_CLIENT_ID=
ARG VITE_COGNITO_REGION=
ENV VITE_COGNITO_CLIENT_ID=$VITE_COGNITO_CLIENT_ID VITE_COGNITO_REGION=$VITE_COGNITO_REGION
# On AWS: the project page's address for the header's back link; empty means the local one on port 5172.
ARG VITE_PROJECT_URL=
ENV VITE_PROJECT_URL=$VITE_PROJECT_URL
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31.7-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e
COPY apps/console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/apps/console/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD ["wget", "-qO-", "http://127.0.0.1:8080/"]
