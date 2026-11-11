// Vue « Ma collection » : onglets par statut, coups de cœur, notés ; grille d'affiches.
import { byId, titleOf, T, tr } from "../data.js";
import { ME, STATUSES, isEmpty, adultAllowed, onChange } from "../state.js";
import { $, esc, fmt, grid } from "../ui.js";
import { charById, loadCharacters, loadAllCharacters, visibleApps } from "../chars.js";
import { charCard } from "./characters.js";
import { FEATURES } from "../state.js";

const TABS = [["all", "Tout"], ["watching", "En cours"], ["plan", "À voir"], ["watched", "Vu"], ["dropped", "Abandonné"], ["fav", "♥ Coups de cœur"], ["rated", "★ Notés"], ["persos", "♥ Personnages"]];
const SORTS = { recent: "Ajoutés récemment", mine: "Ma note", score: "Note AniList", az: "Titre A → Z" };
let root = null, tab = "all", sort = "recent";

const test = (e, t) => t === "all" ? !isEmpty(e) : t === "fav" ? e.f : t === "rated" ? !!e.r : e.s === t;

export function gate(title, text) {
  return `<div class="page"><div class="gate2"><h1>${title}</h1><p>${text}</p><button type="button" class="btn primary" data-need-auth>Se connecter ou créer un compte</button></div></div>`;
}

export function render(el, sub) {
  root = el;
  if (sub && TABS.some(([k]) => k === sub)) tab = sub;
  if (!ME.user) { el.innerHTML = gate("Ma collection", "Garde la trace de ce que tu regardes : statuts, notes, coups de cœur et avis. Ta collection est privée."); return; }
  if (!ME.ready) { el.innerHTML = `<div class="page"><p class="loading">Chargement de ta collection…</p></div>`; return; }
  const adultOk = adultAllowed();
  const all = [...ME.entries.entries()].map(([id, e]) => [byId.get(id), e]).filter(([a]) => a && (!a.adult || adultOk));
  const counts = Object.fromEntries(TABS.map(([k]) => [k, k === "persos" ? ME.favChars.size : all.filter(([, e]) => test(e, k)).length]));
  let items = all.filter(([, e]) => test(e, tab));
  items.sort({ recent: (x, y) => y[1].t - x[1].t, mine: (x, y) => (y[1].r || 0) - (x[1].r || 0) || y[1].t - x[1].t,
    score: (x, y) => (y[0].score || 0) - (x[0].score || 0), az: (x, y) => titleOf(x[0]).localeCompare(titleOf(y[0]), "fr") }[sort]);
  el.innerHTML = `<div class="page">
    <div class="cat-top"><div><h1>Ma collection</h1><div class="count"><b>${fmt(counts.all)}</b> titre${counts.all > 1 ? "s" : ""} · <a href="#/listes">Mes listes →</a></div></div>
      <label class="sortsel"><span class="sr">Trier par</span><select id="colSort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${sort === k ? " selected" : ""}>${v}</option>`).join("")}</select></label></div>
    ${counts.all && tab === "all" ? statsHTML(all) : ""}
    ${tab === "plan" && counts.plan > 1 ? `<p><button type="button" class="btn" data-random="plan">🎲 Je ne sais pas quoi regarder : tire un titre au hasard</button></p>` : ""}
    <nav class="tabs2" aria-label="Filtrer ma collection">${TABS.map(([k, v]) => `<a href="#/collection/${k}" class="${tab === k ? "on" : ""}"${tab === k ? ' aria-current="page"' : ""}>${v} <span>${counts[k]}</span></a>`).join("")}</nav>
    ${tab === "persos" ? `<div id="favChars">${favCharsHTML()}</div>` : items.length ? `<div class="grid">${grid(items.map(([a]) => a))}</div>`
      : `<div class="empty"><p>${counts.all ? "Rien dans cette catégorie pour l'instant." : "Ta collection est vide."}</p><p class="hint">Sur chaque affiche, utilise ♡ pour un coup de cœur et + pour choisir un statut ou une liste.</p><a class="btn primary" href="#/catalogue">Parcourir le catalogue</a>${counts.all ? "" : ` <a class="btn" href="#/compte" data-goto="import">Importer depuis MyAnimeList ou AniList</a>`}</div>`}
  </div>`;
  $("colSort").addEventListener("change", e => { sort = e.target.value; render(el); });
  if (tab === "persos" && ME.favChars.size && [...ME.favChars.keys()].some(id => !charById.has(id)))
    loadCharacters().then(() => [...ME.favChars.keys()].some(id => !charById.has(id)) ? loadAllCharacters() : null).then(() => { const f = $("favChars"); if (f) f.innerHTML = favCharsHTML(); }).catch(() => {});
}
/** Statistiques de la collection (épisodes vus : progression saisie, sinon tous les épisodes pour « Vu »). */
function statsHTML(all) {
  let eps = 0, mins = 0, rated = 0, sum = 0; const g = new Map(), st = { watching: 0, plan: 0, watched: 0, dropped: 0 };
  for (const [a, e] of all) {
    const n = e.p || (e.s === "watched" ? a.eps || 0 : 0);
    eps += n; mins += n * (a.dur || 24);
    if (e.r) { rated++; sum += e.r; }
    if (e.s) st[e.s]++;
    const w = (e.f ? 2 : 0) + (e.r >= 4 ? 2 : 0) + (e.s === "watched" || e.s === "watching" ? 1 : 0);
    if (w) for (const x of a.genres) g.set(x, (g.get(x) || 0) + w);
  }
  const top = [...g.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
  const tot = Object.values(st).reduce((x, y) => x + y, 0) || 1;
  const h = Math.round(mins / 60);
  return `<section class="stats2">
    <div class="st-n"><b>${fmt(all.filter(([, e]) => !isEmpty(e)).length)}</b><span>titres</span></div>
    <div class="st-n"><b>${fmt(eps)}</b><span>épisodes vus</span></div>
    <div class="st-n"><b>${h >= 48 ? fmt(Math.round(h / 24)) + " j" : fmt(h) + " h"}</b><span>devant les animés${h >= 48 ? ` (${fmt(h)} h)` : ""}</span></div>
    <div class="st-n"><b>${rated ? (sum / rated).toFixed(1).replace(".", ",") + " ★" : "—"}</b><span>note moyenne${rated ? ` (${rated})` : ""}</span></div>
    <div class="st-bar" title="Répartition par statut">${Object.entries(st).filter(([, n]) => n).map(([k, n]) => `<i class="s-${k} on" style="flex:${n}" title="${STATUSES[k]} : ${n}"></i>`).join("")}</div>
    ${top.length ? `<div class="st-g"><span class="hint">Tes genres préférés :</span> ${top.map(([x]) => `<a class="g" href="#/catalogue?genre=${encodeURIComponent(T.genres[x])}">${esc(tr("genres", T.genres[x]))}</a>`).join("")}</div>` : ""}
  </section>`;
}
function favCharsHTML() {
  if (!FEATURES.favChars) return `<div class="empty"><p>Les personnages favoris arrivent bientôt.</p><p class="hint">Cette fonction s'active dès que la base de données est mise à jour (script SQL 20261112000000).</p></div>`;
  if (!ME.favChars.size) return `<div class="empty"><p>Aucun personnage favori pour l'instant.</p><p class="hint">Ouvre la fiche d'un personnage et clique sur « ♡ Ajouter à mes personnages favoris ».</p><a class="btn primary" href="#/personnages">Parcourir les personnages</a></div>`;
  const ok = adultAllowed();
  const L = [...ME.favChars.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => charById.get(id)).filter(c => c && visibleApps(c, ok).length);
  if (!L.length) return `<p class="loading">Chargement de tes personnages…</p>`;
  return `<div class="cgrid">${L.map(c => charCard(c)).join("")}</div>`;
}
onChange(what => { if (root && root.isConnected && ["collection", "session", "lists", "profile", "entry", "favchar"].includes(what)) render(root); });
export const STATUS_LABELS = STATUSES;
