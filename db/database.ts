import { env } from 'cloudflare:workers';

export function getDatabase() {
  return (env as unknown as { DB: D1Database }).DB;
}
