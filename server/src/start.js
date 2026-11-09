import { createApplication } from './app.js';
import { configurationFromEnvironment } from './configuration.js';

const port = Number(process.env.PORT ?? 3001);
if (!/^[0-9]+$/.test(process.env.PORT ?? '3001') || !Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT must be an integer between 0 and 65535.');
}

const { httpServer, io } = createApplication({ config: configurationFromEnvironment() });

httpServer.on('error', (error) => {
  console.error('MyOfficeHours server failed to start:', error.message);
  process.exitCode = 1;
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`MyOfficeHours server listening on port ${httpServer.address().port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    io.close();
  });
}
