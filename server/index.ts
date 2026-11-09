import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 3001);

const { httpServer } = createApp({ staticDir: path.join(root, 'dist') });

httpServer.listen(port, () => {
  console.log(`MyOfficeHours server listening on http://localhost:${port}`);
});
