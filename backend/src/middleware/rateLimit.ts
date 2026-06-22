import rateLimit from 'express-rate-limit';
import { config } from '../config';

/** Brute-force protection on login — applied in index.ts before auth routes. */
export const loginRateLimiter = rateLimit({
  windowMs: config.loginRateLimit.windowMs,
  max: config.loginRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});
