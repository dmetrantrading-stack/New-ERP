import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

function parseCorsOrigins(): string[] | true {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) {
    return isProduction ? [] : true;
  }
  if (raw === '*') return true;
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

export const config = {
  port: parseInt(process.env.PORT || '5000'),
  nodeEnv,
  isProduction,
  jwtSecret: process.env.JWT_SECRET || 'default-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  /** Serve built React app from Express (hybrid / cloud single-origin deploy). */
  serveFrontend: process.env.SERVE_FRONTEND === 'true' || isProduction,
  frontendDist: process.env.FRONTEND_DIST || path.join(__dirname, '..', '..', '..', 'frontend', 'dist'),
  trustProxy: process.env.TRUST_PROXY === 'true',
  /** When false (LAN HTTP), Helmet must not send HSTS or HTTPS-only headers. */
  useHttpsSecurityHeaders: process.env.TRUST_PROXY === 'true',
  corsOrigins: parseCorsOrigins(),
  loginRateLimit: {
    windowMs: parseInt(process.env.LOGIN_RATE_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.LOGIN_RATE_MAX || '20', 10),
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    name: process.env.DB_NAME || 'd_metran_erp',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
};
