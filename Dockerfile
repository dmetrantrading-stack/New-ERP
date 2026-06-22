# Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Build backend
FROM node:20-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Production image
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000
ENV SERVE_FRONTEND=true
ENV FRONTEND_DIST=/app/frontend/dist
ENV UPLOAD_DIR=/app/uploads

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/uploads /app/backend/uploads \
  && ln -s /app/uploads /app/backend/uploads

WORKDIR /app/backend
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/api/health || exit 1

CMD ["sh", "-c", "node dist/database/migrate.js && node dist/index.js"]
