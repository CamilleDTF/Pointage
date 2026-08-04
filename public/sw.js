/*
 * Service worker : met en cache la coquille de l'application pour que les chefs
 * d'equipe puissent ouvrir leur fiche sans reseau. Les appels /api/ ne sont
 * jamais servis depuis le cache — les saisies hors ligne passent par la file
 * d'attente locale de commun.js.
 */

const CACHE = 'pointage-v1';

const COQUILLE = [
  '/',
  '/index.html',
  '/chef.html',
  '/directeur.html',
  '/css/style.css',
  '/js/commun.js',
  '/js/chef.js',
  '/js/directeur.js',
  '/manifest.json',
  '/icone.svg',
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evenement) => {
  const url = new URL(evenement.request.url);
  if (evenement.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  evenement.respondWith(
    fetch(evenement.request)
      .then((reponse) => {
        if (reponse.ok && url.origin === self.location.origin) {
          const copie = reponse.clone();
          caches.open(CACHE).then((cache) => cache.put(evenement.request, copie));
        }
        return reponse;
      })
      .catch(() => caches.match(evenement.request).then((c) => c || caches.match('/index.html')))
  );
});
