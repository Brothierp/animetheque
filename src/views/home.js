// Vue « Accueil » : animé à la une, rangées thématiques, recommandations, genres.
import { A, T, UP, RELEASING, byId, tr, titleOf, coverStyle, loadDesc } from "../data.js";
import { ME, ent, inCollection, onChange, FEATURES } from "../state.js";
import { esc, fmt, row, cover } from "../ui.js";
import { loadTopCharacters } from "../chars.js";
import { charCard } from "./characters.js";

let root = null, featured = null;

/** Recommandations : genres et thèmes des titres aimés (♥, 4-5 étoiles, vus, en cours), pondérés par la note AniList. */
function recommendations(n = 20) {
  const w = new Map(); let base = 0;
  for (const [id, e] of ME.entries) {
    const x = byId.get(id); if (!x) continue;
    const k = (e.f ? 3 : 0) + (e.r >= 4 ? e.r - 2 : e.r && e.r <= 2 ? -2 : 0) + (e.s === "watched" || e.s === "watching" ? 1 : 0) + (e.s === "dropped" ? -2 : 0);
    if (!k) continue; base++;
    for (const t of x.tags) w.set("t" + t, (w.get("t" + t) || 0) + k);
    for (const g of x.genres) w.set("g" + g, (w.get("g" + g) || 0) + k * 1.5);
  }
  if (base < 1) return [];
  const out = [];
  for (const a of A) {
    if (a.adult || a.status === UP || inCollection(a.id) || a.rank > 6000) continue;
    let s = 0;
    for (const t of a.tags) s += w.get("t" + t) || 0;
    for (const g of a.genres) s += w.get("g" + g) || 0;
    if (s <= 0) continue;
    out.push([s * (0.6 + (a.score || 60) / 100) - a.rank / 3000, a]);
  }
  return out.sort((x, y) => y[0] - x[0]).slice(0, n).map(x => x[1]);
}

const safe = a => !a.adult;
function pickFeatured() {
  const pool = A.filter(a => safe(a) && a.status === RELEASING && a.hasDesc && a.cov >= 0).slice(0, 12);
  return pool[Math.floor(Math.random() * pool.length)] || A.find(safe);
}

function hero(a) {
  const e = ent(a.id);
  const meta = [a.format >= 0 ? tr("format", T.format[a.format]) : "", a.year, a.eps ? a.eps + " ép." : "", a.score ? "★ " + a.score + "/100" : ""].filter(Boolean).join(" · ");
  return `<section class="hero">
    <div class="hero-bg" style="${coverStyle(a)}"></div>
    <div class="hero-in">
      ${cover(a, "hero-cv")}
      <div class="hero-txt">
        <span class="kicker">À la une · en cours de diffusion</span>
        <h1>${esc(titleOf(a))}</h1>
        <p class="hero-meta">${esc(meta)}</p>
        <p class="hero-syn" id="heroSyn">${a.desc ? esc(a.desc.slice(0, 260)) + (a.desc.length > 260 ? "…" : "") : ""}</p>
        <div class="hero-act"><a class="btn primary" href="#/anime/${a.id}">Voir la fiche</a>
          <button type="button" class="btn" data-quick-add="${a.id}">+ Ajouter à ma collection</button>
          <button type="button" class="btn" data-random="any" title="Une suggestion au hasard">🎲 Je ne sais pas quoi regarder</button></div>
      </div>
    </div>
  </section>`;
}

function genreTiles() {
  const counts = new Array(T.genres.length).fill(0), sample = new Array(T.genres.length).fill(null);
  for (const a of A) if (safe(a)) for (const g of a.genres) { counts[g]++; if (!sample[g] && a.cov >= 0 && a.rank > 30) sample[g] = a; }
  const order = T.genres.map((_, i) => i).filter(i => counts[i] >= 40 && T.genres[i] !== "Hentai").sort((a, b) => counts[b] - counts[a]);
  return `<section class="row"><div class="row-h"><h2>Explorer par genre</h2></div>
    <div class="gtiles">${order.map(i => `<a class="gtile" href="#/catalogue?genre=${encodeURIComponent(T.genres[i])}"><span class="gt-bg" style="${coverStyle(sample[i])}"></span><b>${esc(tr("genres", T.genres[i]))}</b><small>${fmt(counts[i])} titres</small></a>`).join("")}</div></section>`;
}

export function render(el) {
  root = el;
  if (!featured) featured = pickFeatured();
  const top = n => A.filter(safe).filter(a => a.status !== UP).slice(0, n);
  const airing = A.filter(a => safe(a) && a.status === RELEASING).slice(0, 20);
  const best = A.filter(a => safe(a) && a.rank < 2500 && a.score).sort((a, b) => b.score - a.score).slice(0, 20);
  const gems = A.filter(a => safe(a) && a.rank >= 1500 && a.rank < 8000 && a.score >= 78 && a.status !== UP).sort((a, b) => b.score - a.score).slice(0, 20);
  const soon = A.filter(a => safe(a) && a.status === UP).slice(0, 20);
  el.innerHTML = `<div class="page home">${hero(featured)}<div id="personal"></div>
    ${row("En ce moment", airing, "#/catalogue?status=RELEASING", "Les séries en cours de diffusion")}
    ${row("Les plus populaires", top(20), "#/catalogue?sort=pop")}
    ${row("Les mieux notés", best, "#/catalogue?sort=score")}
    ${row("Pépites à découvrir", gems, "#/catalogue?sort=score&minscore=78", "Très bien notés, moins connus")}
    ${row("Bientôt", soon, "#/catalogue?status=NOT_YET_RELEASED", "Pas encore sortis")}
    <div id="homeChars"></div>
    ${genreTiles()}
  </div>`;
  renderPersonal();
  if (featured.desc == null) loadDesc(featured).then(t => { const h = el.querySelector("#heroSyn"); if (h) h.textContent = t.slice(0, 260) + (t.length > 260 ? "…" : ""); }).catch(() => {});
  loadTopCharacters().then(list => {
    const h = el.querySelector("#homeChars"); if (!h) return;
    const top = list.slice(0, 24);
    h.innerHTML = `<section class="row"><div class="row-h"><h2>Personnages les plus aimés</h2><span class="row-sub">Explore-les par étiquettes : mage, tsundere, pirate…</span><a class="more-link" href="#/personnages">Tout voir →</a></div><div class="row-s crow">${top.map(c => charCard(c)).join("")}</div></section>`;
  }).catch(() => {});
}
function renderPersonal() {
  const p = root && root.querySelector("#personal"); if (!p) return;
  if (!ME.user || !ME.ready) { p.innerHTML = ""; return; }
  const watching = [...ME.entries.entries()].filter(([, e]) => e.s === "watching").sort((a, b) => b[1].t - a[1].t).map(([id]) => byId.get(id)).filter(Boolean);
  const plan = [...ME.entries.entries()].filter(([, e]) => e.s === "plan").sort((a, b) => b[1].t - a[1].t).map(([id]) => byId.get(id)).filter(Boolean);
  const recs = recommendations();
  const name = ME.profile && ME.profile.username;
  p.innerHTML = row("Reprendre", watching.slice(0, 20), "#/collection/watching", FEATURES.progress ? "Un clic sur +1 à chaque épisode vu" : "Tes séries en cours")
    + row(name ? `Recommandé pour ${esc(name)}` : "Recommandé pour toi", recs, "", "D'après tes coups de cœur, notes et visionnages")
    + row("Ma liste « à voir »", plan.slice(0, 20), "#/collection/plan");
  if (!watching.length && !recs.length && !plan.length) p.innerHTML = `<div class="tip">Ajoute des titres à ta collection (♥, note, statut) : l'accueil te proposera des recommandations personnalisées.</div>`;
}
onChange(what => { if (root && root.isConnected && (what === "collection" || what === "session" || what === "profile")) renderPersonal(); });
