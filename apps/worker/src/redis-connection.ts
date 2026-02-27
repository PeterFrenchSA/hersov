import type { ConnectionOptions } from 'bullmq';

function parseRedisDatabase(pathname: string): number {
  const trimmed = pathname.replace('/', '').trim();
  if (!trimmed) {
    return 0;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function getBullConnectionOptions(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const parsed = new URL(redisUrl);
  const isTls = parsed.protocol === 'rediss:';

  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parseRedisDatabase(parsed.pathname),
    ...(isTls ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
