import { QueueServiceError } from './queue-service.js';

function errorData(error) {
  if (error instanceof QueueServiceError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.field === undefined ? {} : { field: error.field }),
    };
  }
  return { code: 'INTERNAL_ERROR', message: 'Unable to process the request.' };
}

export function registerQueueHandlers(io, service, limiter) {
  // Credentials stay server-side. Never broadcast a roster to a shared room.
  function publish(queueId) {
    for (const peer of io.sockets.sockets.values()) {
      const subscription = peer.data.queueSubscription;
      if (subscription?.queueId !== queueId) continue;
      try {
        peer.emit('queue:state', service.getState(subscription).state);
      } catch {
        // A stale/invalid subscription must not receive any private data.
        delete peer.data.queueSubscription;
      }
    }
  }

  io.on('connection', (socket) => {
    function handle(event, operation, { subscriptionFor, mutation = false } = {}) {
      socket.on(event, (...args) => {
        const ack = args.at(-1);
        // Do not create queues/memberships whose credentials cannot be returned.
        if (typeof ack !== 'function') return;
        let result;
        try {
          if (args.length !== 2) throw new QueueServiceError('INVALID_PAYLOAD');
          result = operation(args[0]);
        } catch (error) {
          ack({ ok: false, error: errorData(error) });
          return;
        }
        // Operations and installation are synchronous: no mutation can interleave
        // between the authenticated snapshot and subscription replacement.
        if (subscriptionFor) socket.data.queueSubscription = subscriptionFor(result, args[0]);
        ack({ ok: true, data: result });
        if (mutation) publish(result.state.queue.queueId);
      });
    }

    const admit = (action) => () => limiter.consume(action, socket.handshake.address);
    handle('queue:create', (payload) => service.createQueue(payload, { admit: admit('create') }), {
      mutation: true,
      subscriptionFor: (result) => ({
        queueId: result.queueId, role: 'instructor', managementToken: result.managementToken,
      }),
    });
    handle('queue:get', (payload) => service.getQueue(payload));
    handle('student:join', (payload) => service.joinStudent(payload, { admit: admit('join') }), {
      mutation: true,
      subscriptionFor: (result) => ({
        queueId: result.queueId, role: 'student', membershipToken: result.membershipToken,
      }),
    });
    handle('queue:subscribe', (payload) => service.getState(payload), {
      subscriptionFor: (_result, payload) => payload.role === 'instructor'
        ? { queueId: payload.queueId, role: payload.role, managementToken: payload.managementToken }
        : { queueId: payload.queueId, role: payload.role, membershipToken: payload.membershipToken },
    });
    for (const [event, method] of [
      ['queue:call-next', 'callNext'],
      ['student:done', 'completeStudent'],
      ['student:remove', 'removeStudent'],
      ['student:leave', 'leaveStudent'],
      ['queue:end', 'endQueue'],
    ]) {
      handle(event, (payload) => service[method](payload), { mutation: true });
    }
  });
}
