import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { QueueService } from './queue-service.js';
import { registerQueueHandlers } from './queue-sockets.js';
import { resolveConfiguration } from './configuration.js';
import { RateLimiter } from './rate-limiter.js';

// Creating an application never binds a port, so each caller owns its lifecycle.
export function createApplication({ queueService, config = {}, rateNow } = {}) {
  const settings = resolveConfiguration(config);
  const service = queueService ?? new QueueService({ limits: settings });
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    maxHttpBufferSize: settings.maxPayloadBytes,
    cors: { origin: settings.allowedOrigins, methods: ['GET', 'POST'] },
    allowRequest: (request, done) => {
      const origin = request.headers.origin;
      done(null, origin === undefined || settings.allowedOrigins.includes(origin));
    },
  });
  registerQueueHandlers(io, service, new RateLimiter(settings, rateNow));

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  return { app, httpServer, io };
}
