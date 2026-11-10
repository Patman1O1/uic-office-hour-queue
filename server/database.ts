/** Stateless gateway: durable state and authorization live in the database RPC. */
export async function databaseRequest(event: unknown, payload: unknown) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase is not configured on this server.');
  if (typeof event !== 'string' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Invalid request.' };
  }
  const response = await fetch(`${url}/rest/v1/rpc/officehours_request`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_event: event, p_payload: payload }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('The queue database is unavailable.');
  return response.json();
}
