const CACHE_NAME = 'totalfit-cache-v1';
const urlsToCache = [
  '/login.html',
  '/profil.html',
  '/totalfit_logo.png',
  '/ping.mp3'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

// Slušanje Push notifikacija u pozadini
self.addEventListener('push', event => {
  const podaci = event.data ? event.data.json() : { naslov: 'Total Fit', tekst: 'Imate novo obaveštenje!' };
  
  const opcije = {
    body: podaci.tekst,
    icon: '/totalfit_logo.png',
    badge: '/totalfit_logo.png', // Mala ikonica na vrhu ekrana (Android)
    vibrate: [200, 100, 200], // Vibracija telefona
    data: { url: '/profil.html' }
  };

  event.waitUntil(
    self.registration.showNotification(podaci.naslov, opcije)
  );
});

// Šta se dešava kada korisnik klikne na notifikaciju
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});