# frontend/Dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_BACKEND_WS_URL=ws://localhost:8000/ws/session
ENV VITE_BACKEND_WS_URL=$VITE_BACKEND_WS_URL
RUN npm run build

# ponytail: stock nginx on :80, compose maps 5173:80. Own nginx.conf only if we need SPA fallback or gzip tuning.
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
