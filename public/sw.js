// Service worker : démarrage rapide et consultation hors ligne du catalogue déjà visité.
// - Pages (navigation) : réseau d'abord, copie en cache si hors ligne.
// - Code (/assets, fichiers versionnés), affiches, morceaux de données : cache d'abord.
// - data.json et index des personnages : cache d'abord puis mise à jour en arrière-plan.
// Les appels à Supabase et AniList ne passent jamais par ce cache.
const V = "v3", STATIC = "static-" + V, DATA = "data-" + V;
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => !k.endsWith(V)).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(STATIC).then(x => x.put("/", c)); return res; }).catch(() => caches.match("/")));
    return;
  }
  if (/^\/(assets|covers|cshards|dshards)\/|\.(png|svg|webmanifest)$/.test(u.pathname)) {
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(STATIC).then(x => x.put(r, c)); } return res; })));
    return;
  }
  if (/^\/(data|characters|characters-more|characters-top|chars|covers-hd|franchises)\.json$/.test(u.pathname)) {
    e.respondWith(caches.open(DATA).then(cache => cache.match(r).then(hit => {
      const net = fetch(r).then(res => { if (res.ok) cache.put(r, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
  }
});

// Notifications sur l'appareil (Web Push) : envoyées par la fonction Supabase « push ».
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Animéthèque", {
    body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: d.tag || undefined, renotify: !!d.tag,
    data: { url: d.url || "/" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const w = list.find(c => c.url.startsWith(self.location.origin));
    if (w) { w.focus(); return w.navigate ? w.navigate(url) : null; }
    return self.clients.openWindow(url);
  }));
});
