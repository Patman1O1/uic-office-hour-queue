import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { databaseRequest } from './server/database.ts'

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), 'SUPABASE_'));
  return {
    plugins: [react(), {
      name: 'local-queue-api',
      configureServer(server) {
        server.middlewares.use('/api/queue', async (req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: 'Use POST.' }));
            return;
          }
          try {
            let raw = '';
            for await (const chunk of req) {
              raw += chunk;
              if (Buffer.byteLength(raw) > 16384) throw Error('Request too large');
            }
            const body = JSON.parse(raw);
            res.end(JSON.stringify(await databaseRequest(body.event, body.payload)));
          } catch {
            res.statusCode = 503;
            res.end(JSON.stringify({ ok: false, error: 'The queue database is unavailable.' }));
          }
        });
      },
    }],
    server: { host: true },
  };
})
