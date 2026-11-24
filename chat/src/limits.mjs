const IP_LIMIT = 8;
const IP_WINDOW_MS = 300_000;
const DAY_LIMIT = 300;

export async function checkLimits(kv, ip, now) {
  const ipKey = `ip:${ip}`;
  let hits = [];
  try {
    const parsed = JSON.parse((await kv.get(ipKey)) ?? '[]');
    if (Array.isArray(parsed)) hits = parsed.filter((t) => typeof t === 'number' && now - t < IP_WINDOW_MS);
  } catch { hits = []; }
  if (hits.length >= IP_LIMIT) return 'ip';

  const dayKey = `day:${new Date(now).toISOString().slice(0, 10)}`;
  const count = parseInt((await kv.get(dayKey)) ?? '0', 10) || 0;
  if (count >= DAY_LIMIT) return 'daily';

  hits.push(now);
  await kv.put(ipKey, JSON.stringify(hits), { expirationTtl: 300 });
  await kv.put(dayKey, String(count + 1), { expirationTtl: 172800 });
  return null;
}
