// Vue « Ma collection » : onglets par statut, coups de cœur, notés ; grille d'affiches.
import { byId, titleOf } from "../data.js";
import { ME, STATUSES, isEmpty, adultAllowed, onChange } from "../state.js";
import { $, esc, fmt, grid } from "../ui.js";

const TABS = [["all", "Tout"], ["watching", "En cours"], ["plan", "À voir"], ["watched", "Vu"], ["dropped", "Abandonné"], ["fav", "♥ Coups de cœur"], ["rated", "★ Notés"]];
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
  const counts = Object.fromEntries(TABS.map(([k]) => [k, all.filter(([, e]) => test(e, k)).length]));
  let items = all.filter(([, e]) => test(e, tab));
  items.sort({ recent: (x, y) => y[1].t - x[1].t, mine: (x, y) => (y[1].r || 0) - (x[1].r || 0) || y[1].t - x[1].t,
    score: (x, y) => (y[0].score || 0) - (x[0].score || 0), az: (x, y) => titleOf(x[0]).localeCompare(titleOf(y[0]), "fr") }[sort]);
  el.innerHTML = `<div class="page">
    <div class="cat-top"><div><h1>Ma collection</h1><div class="count"><b>${fmt(counts.all)}</b> titre${counts.all > 1 ? "s" : ""}</div></div>
      <label class="sortsel"><span class="sr">Trier par</span><select id="colSort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${sort === k ? " selected" : ""}>${v}</option>`).join("")}</select></label></div>
    <nav class="tabs2" aria-label="Filtrer ma collection">${TABS.map(([k, v]) => `<a href="#/collection/${k}" class="${tab === k ? "on" : ""}"${tab === k ? ' aria-current="page"' : ""}>${v} <span>${counts[k]}</span></a>`).join("")}</nav>
    ${items.length ? `<div class="grid">${grid(items.map(([a]) => a))}</div>`
      : `<div class="empty"><p>${counts.all ? "Rien dans cette catégorie pour l'instant." : "Ta collection est vide."}</p><p class="hint">Sur chaque affiche, utilise ♡ pour un coup de cœur et + pour choisir un statut ou une liste.</p><a class="btn primary" href="#/catalogue">Parcourir le catalogue</a></div>`}
  </div>`;
  $("colSort").addEventListener("change", e => { sort = e.target.value; render(el); });
}
onChange(what => { if (root && root.isConnected && ["collection", "session", "lists", "profile", "entry"].includes(what)) render(root); });
export const STATUS_LABELS = STATUSES;
