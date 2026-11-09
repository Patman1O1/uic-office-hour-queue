export const DEFAULTS = Object.freeze({
  allowedOrigins: Object.freeze(['http://localhost:5173', 'http://127.0.0.1:5173']),
  maxPayloadBytes: 16_384,
  maxQueues: 100,
  maxStudentsPerQueue: 200,
  maxStudentsTotal: 5_000,
  createLimit: 10,
  joinLimit: 60,
  rateWindowMs: 60_000,
  maxRateBuckets: 10_000,
});

const variables = {
  maxPayloadBytes: 'MAX_PAYLOAD_BYTES',
  maxQueues: 'MAX_QUEUES',
  maxStudentsPerQueue: 'MAX_STUDENTS_PER_QUEUE',
  maxStudentsTotal: 'MAX_STUDENTS_TOTAL',
  createLimit: 'CREATE_LIMIT',
  joinLimit: 'JOIN_LIMIT',
  rateWindowMs: 'RATE_WINDOW_MS',
  maxRateBuckets: 'MAX_RATE_BUCKETS',
};

export function resolveConfiguration(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('Configuration must be an object.');
  }
  for (const name of Object.keys(overrides)) {
    if (!Object.hasOwn(DEFAULTS, name)) throw new Error('Unknown configuration setting.');
  }
  const config = { ...DEFAULTS, ...overrides };
  for (const [name, variable] of Object.entries(variables)) {
    if (!Number.isSafeInteger(config[name]) || config[name] <= 0) {
      throw new Error(`${variable} must be a positive safe integer.`);
    }
  }
  if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must contain at least one HTTP(S) origin.');
  }
  for (const origin of config.allowedOrigins) {
    let valid = false;
    try {
      const url = new URL(origin);
      valid = typeof origin === 'string' && ['http:', 'https:'].includes(url.protocol)
        && url.origin === origin;
    } catch { /* Report configuration names, never supplied values. */ }
    if (!valid) throw new Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths or wildcards.');
  }
  config.allowedOrigins = Object.freeze([...new Set(config.allowedOrigins)]);
  return Object.freeze(config);
}

export function configurationFromEnvironment(environment = process.env) {
  const overrides = {};
  for (const [name, variable] of Object.entries(variables)) {
    const value = environment[variable];
    if (value === undefined) continue;
    if (!/^[0-9]+$/.test(value)) throw new Error(`${variable} must be a positive safe integer.`);
    overrides[name] = Number(value);
  }
  if (environment.ALLOWED_ORIGINS !== undefined) {
    overrides.allowedOrigins = environment.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  }
  return resolveConfiguration(overrides);
}
