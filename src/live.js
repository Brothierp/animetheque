// Informations en direct d'AniList pour la fiche d'un animé : bande-annonce et prochain épisode.
// La vidéo YouTube (version « sans cookie ») n'est chargée qu'au clic sur « Bande-annonce ».
import { esc } from "./ui.js";

const cache = new Map();
export function fetchLive(id) {
  if (id >= 900000) return Promise.resolve(null);          // séries ajoutées à la main (absentes d'AniList)
  if (cache.has(id)) return cache.get(id);
  const q = `query($id:Int){ Media(id:$id){ trailer{ id site } nextAiringEpisode{ episode airingAt } } }`;
  const p = fetch("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query: q, variables: { id } }) })
    .then(r => r.json()).then(d => (d.data && d.data.Media) || null)
    .catch(() => { cache.delete(id); return null; });
  cache.set(id, p);
  return p;
}

const when = t => {
  const d = new Date(t * 1000), s = (t * 1000 - Date.now()) / 1000;
  const day = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), hour = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (s < 3600) return `dans ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `aujourd'hui à ${hour}`;
  if (s < 2 * 86400) return `demain à ${hour}`;
  return `${day} à ${hour}`;
};

/** HTML du bloc « en direct » (bande-annonce + prochain épisode), ou "" s'il n'y a rien. */
export function liveHTML(m) {
  if (!m) return "";
  const yt = m.trailer && m.trailer.site === "youtube" && /^[\w-]{6,20}$/.test(m.trailer.id) ? m.trailer.id : null;
  const next = m.nextAiringEpisode;
  if (!yt && !next) return "";
  return `<section class="d-live">
    ${next ? `<p class="next-ep">📺 <b>Épisode ${next.episode}</b> ${esc(when(next.airingAt))}</p>` : ""}
    ${yt ? `<div class="trailer" data-yt="${yt}"><button type="button" class="tr-play" aria-label="Lire la bande-annonce">
      <img src="https://i.ytimg.com/vi/${yt}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer"><span>▶ Bande-annonce</span></button></div>` : ""}
  </section>`;
}
/** Remplace l'aperçu par la vidéo au clic. */
export function bindTrailer(root) {
  root.addEventListener("click", e => {
    const b = e.target.closest(".tr-play"); if (!b) return;
    const box = b.closest(".trailer"), id = box.dataset.yt;
    box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" title="Bande-annonce" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  });
}
