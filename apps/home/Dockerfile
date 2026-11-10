# The local demo home: static files only. Build from the repo root:
# docker build -f apps/home/Dockerfile .
FROM nginxinc/nginx-unprivileged:1.31.7-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e
COPY apps/home/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/home/index.html apps/home/styles.css apps/home/app.js apps/home/icon.svg /usr/share/nginx/html/
COPY apps/home/fonts /usr/share/nginx/html/fonts
COPY apps/home/img /usr/share/nginx/html/img
COPY apps/home/media /usr/share/nginx/html/media
USER 101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD ["wget", "-qO-", "http://127.0.0.1:8080/"]
