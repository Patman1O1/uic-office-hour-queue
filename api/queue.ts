import type { IncomingMessage, ServerResponse } from 'node:http';
import { databaseRequest } from '../server/database.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: 'Use POST for queue operations.' }));
    return;
  }
  try {
    if (Number(req.headers['content-length'] || 0) > 16384) {
      res.statusCode = 413;
      res.end(JSON.stringify({ ok: false, error: 'Request too large.' }));
      return;
    }
    const body = req.body as { event?: unknown; payload?: unknown } | undefined;
    const result = await databaseRequest(body?.event, body?.payload);
    res.end(JSON.stringify(result));
  } catch {
    res.statusCode = 503;
    res.end(JSON.stringify({ ok: false, error: 'Unable to reach the queue database. Reconnect to check the current state.' }));
  }
}
