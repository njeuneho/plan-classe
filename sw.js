/* ════════════════════════════════════════════════════════════════════
   PlanClasse — Service Worker (V020-v175)
   ──────────────────────────────────────────────────────────────────
   Rôle : permettre le fonctionnement hors-ligne après la première
   visite. Cache index.html, manifest.json et sw.js lui-même au moment
   de l'installation, puis sert depuis le cache si la connexion est
   perdue.

   Stratégie : "stale-while-revalidate" pour index.html
     1. Au premier chargement avec réseau, on met en cache et on sert
     2. Aux chargements suivants, on sert le cache immédiatement (ultra
        rapide, fonctionne hors-ligne) ET on récupère la dernière
        version en arrière-plan pour le prochain chargement.
     → conséquence : après une mise à jour côté GitHub, il faut
       recharger 2 fois pour voir la nouvelle version (1ʳᵉ fois sert
       l'ancienne mais déclenche la mise à jour, 2ᵉ fois sert la
       nouvelle).

   Pour forcer l'invalidation après une nouvelle livraison, on
   incrémente CACHE_NAME.
   ════════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'planclasse-v175';

const PRECACHE_URLS = [
  './',                // = index.html dans le scope
  'index.html',
  'manifest.json',
];

// === Installation : précache des ressources essentielles ===
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // addAll échoue si une seule URL plante. On boucle individuellement
      // pour être tolérant (par ex. manifest.json absent en local).
      return Promise.all(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[sw] Précache échoué pour', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// === Activation : nettoyer les anciens caches ===
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[sw] Nettoyage ancien cache :', k);
        return caches.delete(k);
      })
    )).then(() => self.clients.claim())
  );
});

// === Fetch : stale-while-revalidate sur les requêtes GET de même origine ===
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // On ne touche qu'aux GET de même origine pour ne pas interférer avec
  // d'éventuelles requêtes externes (fonts.googleapis.com, etc.).
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => {
      const fetched = fetch(req).then(networkRes => {
        // Met en cache uniquement les réponses 2xx
        if (networkRes && networkRes.status === 200) {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return networkRes;
      }).catch(err => {
        // Réseau KO, rien à faire (le cached sera utilisé si présent)
        return null;
      });

      // Stale-while-revalidate : on retourne le cache s'il existe
      // (instantané), sinon on attend le réseau.
      return cached || fetched;
    })
  );
});

// === Message API : permet à la page de forcer un skipWaiting si on
// veut une mise à jour immédiate (utilisé par un éventuel bouton
// "Mettre à jour maintenant" dans une future itération). ===
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
