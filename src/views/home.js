// Vue « Accueil » : animé à la une, rangées thématiques, recommandations, genres.
import { A, T, UP, RELEASING, byId, tr, titleOf, coverStyle, loadDesc, onePerFranchise, franchiseKey, FRANCHISE } from "../data.js";
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
  // pas de recommandation dans une franchise que tu connais déjà (ses suites sont dans « La suite de tes séries »)
  const known = new Set([...ME.entries.keys()].map(id => byId.get(id)).filter(Boolean).map(franchiseKey));
  const out = [];
  for (const a of A) {
    if (a.adult || a.status === UP || inCollection(a.id) || a.rank > 6000 || known.has(franchiseKey(a))) continue;
    let s = 0;
    for (const t of a.tags) s += w.get("t" + t) || 0;
    for (const g of a.genres) s += w.get("g" + g) || 0;
    if (s <= 0) continue;
    out.push([s * (0.6 + (a.score || 60) / 100) - a.rank / 3000, a]);
  }
  return onePerFranchise(out.sort((x, y) => y[0] - x[0]).map(x => x[1]), n);
}

/** La suite de tes séries : pour chaque franchise où tu as vu un titre principal, le titre principal suivant pas encore vu. */
function nextUp(n = 20) {
  const out = [], done = new Set();
  const byRecent = [...ME.entries.entries()].filter(([, e]) => e.s === "watched").sort((a, b) => b[1].t - a[1].t);
  for (const [id] of byRecent) {
    const f = FRANCHISE.get(id); if (!f || done.has(f.list)) continue;
    done.add(f.list);
    // suite = série, film ou ONA de la ligne principale (pas les OAV préquelles ni les spéciaux)
    const main = f.list.filter(x => x.k === 0 && ["TV", "TV_SHORT", "MOVIE", "ONA"].includes(T.format[x.a.format])).map(x => x.a);
    let last = -1; main.forEach((a, i) => { const e = ME.entries.get(a.id); if (e && e.s === "watched") last = i; });
    const next = main.slice(last + 1).find(a => { const e = ME.entries.get(a.id); return !(e && e.s) && !a.adult; });
    if (next) out.push(next);
    if (out.length >= n) break;
  }
  return out;
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

/** Guide de bienvenue (une fois, masquable). */
const TIP_KEY = "animetheque:welcome-done";
function welcome() {
  try { if (localStorage.getItem(TIP_KEY)) return ""; } catch { return ""; }
  return `<section class="welcome" id="welcome"><button type="button" class="x" data-close-welcome aria-label="Masquer">×</button>
    <h2>Bienvenue sur l'Animéthèque 👋</h2>
    <div class="w-grid">
      <div><b>⌕ Cherche</b><span>un animé ou un personnage dans la barre du haut (raccourci <kbd>/</kbd>).</span></div>
      <div><b>♡ Coup de cœur</b><span>et <b>+</b> sur chaque affiche : statut (à voir, en cours, vu…) et listes, en un clic.</span></div>
      <div><b>+1</b><span>sur tes séries en cours à chaque épisode vu : la suite et les recommandations s'adaptent.</span></div>
      <div><b>📅 Calendrier</b><span>les épisodes de la semaine ; <b>Importer</b> ta liste MyAnimeList ou AniList depuis « Mon compte ».</span></div>
    </div></section>`;
}
export function render(el) {
  root = el;
  if (!featured) featured = pickFeatured();
  // une seule saison par franchise dans chaque rangée, pour plus de variété
  const top = n => onePerFranchise(A.filter(a => safe(a) && a.status !== UP), n);
  const airing = A.filter(a => safe(a) && a.status === RELEASING).slice(0, 20);
  const best = onePerFranchise(A.filter(a => safe(a) && a.rank < 2500 && a.score).sort((a, b) => b.score - a.score), 20);
  const gems = onePerFranchise(A.filter(a => safe(a) && a.rank >= 1500 && a.rank < 8000 && a.score >= 78 && a.status !== UP).sort((a, b) => b.score - a.score), 20);
  const soon = A.filter(a => safe(a) && a.status === UP).slice(0, 20);
  el.innerHTML = `<div class="page home">${hero(featured)}${welcome()}<div id="personal"></div>
    ${row("En ce moment", airing, "#/catalogue?status=RELEASING", "Les séries en cours de diffusion")}
    ${row("Les plus populaires", top(20), "#/catalogue?sort=pop")}
    ${row("Les mieux notés", best, "#/catalogue?sort=score")}
    ${row("Pépites à découvrir", gems, "#/catalogue?sort=score&minscore=78", "Très bien notés, moins connus")}
    ${row("Bientôt", soon, "#/catalogue?status=NOT_YET_RELEASED", "Pas encore sortis")}
    <div id="homeChars"></div>
    ${genreTiles()}
  </div>`;
  const w = el.querySelector("[data-close-welcome]");
  if (w) w.addEventListener("click", () => { try { localStorage.setItem(TIP_KEY, "1"); } catch {} el.querySelector("#welcome").remove(); });
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
  const recs = recommendations(), next = nextUp();
  const name = ME.profile && ME.profile.username;
  p.innerHTML = row("Reprendre", watching.slice(0, 20), "#/collection/watching", FEATURES.progress ? "Un clic sur +1 à chaque épisode vu" : "Tes séries en cours")
    + row("La suite de tes séries", next, "", "La saison ou le film suivant de ce que tu as terminé")
    + row(name ? `Recommandé pour ${esc(name)}` : "Recommandé pour toi", recs, "", "D'après tes coups de cœur, notes et visionnages")
    + row("Ma liste « à voir »", plan.slice(0, 20), "#/collection/plan");
  if (!watching.length && !recs.length && !plan.length && !next.length) p.innerHTML = `<div class="tip">Ajoute des titres à ta collection (♥, note, statut) : l'accueil te proposera des recommandations personnalisées.</div>`;
}
onChange(what => { if (root && root.isConnected && (what === "collection" || what === "session" || what === "profile")) renderPersonal(); });
