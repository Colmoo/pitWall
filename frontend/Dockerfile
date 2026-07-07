# frontend/Dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
ARG VITE_BACKEND_WS_URL=ws://localhost:8000/ws/session
ENV VITE_BACKEND_WS_URL=$VITE_BACKEND_WS_URL
RUN npm run build
CMD ["npm", "run", "preview"]
