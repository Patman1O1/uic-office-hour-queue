// Presentation only: no push subscription, credentials, or cached queue data.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(client => client.url === url.href);
    if (existing) return existing.focus();
    return self.clients.openWindow(url.href);
  }));
});
