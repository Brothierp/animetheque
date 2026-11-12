// Composants partagés : cartes d'affiche, menu « + Ajouter », étoiles, rangées.
import { byId, titleOf, coverStyle, hdUrl, tr, T } from "./data.js";
import { ME, ent, STATUSES, STATUS_SHORT, setEntry, setInList, createList, sortedLists, requireUser, onChange, setProgress, FEATURES } from "./state.js";
import { toast } from "./toast.js";

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const fmt = n => n.toLocaleString("fr-FR");

/** Affiche seule (sans actions). */
/**
 * Affiche : la miniature (planche d'images, instantanée) sert de fond, l'image haute définition d'AniList
 * se pose par-dessus dès qu'elle est chargée. sizes = largeur affichée, pour que le navigateur choisisse
 * 230 px ou 460 px selon l'écran. Si l'image HD ne vient pas, la miniature reste.
 */
export const cover = (a, cls = "", sizes = "(max-width: 640px) 112px, 150px") => {
  if (!a || (a.cov < 0 && !a.hd)) return `<span class="cv none ${cls}">${esc((a ? titleOf(a)[0] : "?").toUpperCase())}</span>`;
  const srcset = a.hdMax === "large" ? `${hdUrl(a, "medium")} 230w, ${hdUrl(a, "large")} 460w` : `${hdUrl(a, "medium")} 230w`;
  const hd = a.hd ? `<img src="${hdUrl(a, "medium")}" srcset="${srcset}" sizes="${sizes}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="this.classList.add('ok')" onerror="this.remove()">` : "";
  // avec une affiche HD, le fond est sa couleur dominante (pas besoin de télécharger la planche de miniatures)
  const bg = a.hd ? (a.color ? `background-color:#${a.color}` : "") : a.cov >= 0 ? coverStyle(a) : "";
  return `<span class="cv ${cls}" style="${bg}">${hd}</span>`;
};

function badges(a) {
  const e = ent(a.id);
  return `<span class="pc-tl">${a.score ? `<span class="b-score">${a.score}</span>` : ""}${e.r ? `<span class="b-mine">★${e.r}</span>` : ""}${a.adult ? `<span class="b-18">18+</span>` : ""}</span>
    ${e.s ? `<span class="pc-bl"><span class="b-status s-${e.s}">${STATUS_SHORT[e.s]}</span></span>` : ""}`;
}
/** Carte d'affiche avec actions rapides (♥ et +). */
export function card(a, opts = {}) {
  const e = ent(a.id), t = titleOf(a);
  const sub = [a.year, a.format >= 0 ? tr("format", T.format[a.format]) : "", a.eps > 1 ? a.eps + " ép." : ""].filter(Boolean).join(" · ");
  return `<article class="pc" data-id="${a.id}">
    <div class="pc-w">
      <a class="pc-cv" href="#/anime/${a.id}" aria-label="${esc(t)}">${cover(a)}${badges(a)}</a>
      <button type="button" class="pc-fav${e.f ? " on" : ""}" data-act="fav" aria-pressed="${!!e.f}" aria-label="Coup de cœur">${e.f ? "♥" : "♡"}</button>
      <button type="button" class="pc-add${!e.s && !Object.keys(e.l).length ? "" : " on"}" data-act="add" aria-label="Ajouter à ma collection ou à une liste">${e.s || Object.keys(e.l).length ? "✓" : "+"}</button>
      ${opts.remove ? `<button type="button" class="pc-rm" data-act="rm" aria-label="Retirer de la liste">×</button>` : ""}
      ${progressBar(a, e)}
    </div>
    <a class="pc-t" href="#/anime/${a.id}">${esc(t)}</a>
    <div class="pc-sub">${esc(sub)}</div>
  </article>`;
}
export const grid = (items, opts) => items.map(a => card(a, opts)).join("");

/** Barre de progression + bouton +1 pour les titres « En cours » (si le suivi des épisodes est activé). */
function progressBar(a, e) {
  if (!FEATURES.progress || e.s !== "watching") return "";
  const p = e.p || 0, tot = a.eps || 0, pct = tot ? Math.min(100, p / tot * 100) : 0;
  return `<div class="pc-prog" title="${p}${tot ? " / " + tot : ""} épisode${p > 1 ? "s" : ""} vu${p > 1 ? "s" : ""}">
    <span class="pc-bar"><i style="width:${pct}%"></i></span><span class="pc-ep">ép. ${p}${tot ? "/" + tot : ""}</span>
    <button type="button" class="pc-plus" data-act="plus1" aria-label="J'ai vu l'épisode suivant">+1</button></div>`;
}
/** Applique +1 épisode et annonce les changements de statut automatiques. */
export function plusOne(id) {
  const a = byId.get(id), e = ent(id), n = (e.p || 0) + 1;
  const auto = setProgress(id, n, a.eps || 0);
  toast(auto === "watched" ? `🎉 Dernier épisode vu : « ${titleOf(a)} » passe en « Regardé »` : auto === "watching" ? `Épisode ${n} vu · ajouté à « En cours »` : `Épisode ${n} vu`);
}

/** Met à jour toutes les cartes d'un titre après un changement. */
export function refreshCards(id) {
  const a = byId.get(id); if (!a) return;
  document.querySelectorAll(`.pc[data-id="${id}"]`).forEach(el => {
    const tmp = document.createElement("div");
    tmp.innerHTML = card(a, { remove: !!el.querySelector(".pc-rm") });
    el.replaceWith(tmp.firstElementChild);
  });
}

/** Rangée horizontale (accueil, similaires). */
export function row(title, items, more, sub = "", opts) {
  if (!items.length) return "";
  return `<section class="row">
    <div class="row-h"><h2>${title}</h2>${sub ? `<span class="row-sub">${sub}</span>` : ""}${more ? `<a class="more-link" href="${more}">Tout voir →</a>` : ""}</div>
    <div class="row-s">${items.map(a => card(a, opts)).join("")}</div>
  </section>`;
}

/** Étoiles cliquables (note personnelle). */
export const starsHTML = id => {
  const r = ent(id).r || 0;
  return `<span class="stars" role="group" aria-label="Ma note">${[1, 2, 3, 4, 5].map(n =>
    `<button type="button" data-act="star" data-v="${n}" class="${r >= n ? "on" : ""}" aria-label="${n} étoile${n > 1 ? "s" : ""}">★</button>`).join("")}</span>`;
};

// ---------- Menu « + Ajouter » (statut + listes) ----------
let pop = null, popId = null, popAnchor = null;
function popHTML(id) {
  const e = ent(id), L = sortedLists();
  return `<div class="pop-h"><b>${esc(titleOf(byId.get(id)))}</b><button type="button" class="x" data-pop="close" aria-label="Fermer">×</button></div>
    <div class="pop-sec">Statut</div>
    <div class="pop-st">${Object.entries(STATUSES).map(([k, v]) => `<button type="button" data-pop="status" data-v="${k}" class="s-${k}${e.s === k ? " on" : ""}">${e.s === k ? "✓ " : ""}${v}</button>`).join("")}</div>
    <div class="pop-sec">Mes listes</div>
    <div class="pop-lists">${L.length ? L.map(([k, v]) => `<label><input type="checkbox" data-pop="list" value="${esc(k)}"${e.l[k] ? " checked" : ""}> <span>${esc(v.n)}</span></label>`).join("") : `<p class="hint">Aucune liste pour l'instant.</p>`}</div>
    <form class="pop-new" data-pop="new"><input type="text" maxlength="40" placeholder="+ Nouvelle liste" aria-label="Nom de la nouvelle liste"><button class="btn sm" type="submit">Créer</button></form>
    <div class="pop-foot"><button type="button" class="btn sm ${e.f ? "fav-on" : ""}" data-pop="fav">${e.f ? "♥ Coup de cœur" : "♡ Coup de cœur"}</button><a class="btn sm" href="#/anime/${id}" data-pop="close">Fiche complète</a></div>`;
}
function placePop() {
  if (!pop) return;
  // La carte d'origine a pu être redessinée : on retrouve son nouveau bouton, sinon on garde la position actuelle.
  if (!popAnchor || !popAnchor.isConnected) popAnchor = document.querySelector(`.pc[data-id="${popId}"] .pc-add`) || document.querySelector(`[data-quick-add="${popId}"]`) || popAnchor;
  if (!popAnchor || !popAnchor.isConnected) return;
  if (innerWidth < 640) { pop.classList.add("sheet"); pop.style.left = pop.style.top = ""; return; }
  pop.classList.remove("sheet");
  const r = popAnchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  let top = r.bottom + 8; if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 8);
  pop.style.left = left + "px"; pop.style.top = top + "px";
}
export function openAddMenu(anchor, id) {
  if (!requireUser()) return;
  if (!ME.ready) { toast("Ta collection est en cours de chargement…"); return; }
  closeAddMenu();
  popId = id; popAnchor = anchor;
  pop = document.createElement("div"); pop.className = "pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Ajouter à ma collection");
  pop.innerHTML = popHTML(id);
  document.body.appendChild(pop);
  const back = document.createElement("div"); back.className = "pop-back"; back.addEventListener("click", closeAddMenu); document.body.appendChild(back);
  placePop();
  pop.addEventListener("click", onPopClick); pop.addEventListener("change", onPopChange); pop.addEventListener("submit", onPopSubmit);
  const first = pop.querySelector(".pop-st button"); if (first) first.focus({ preventScroll: true });
}
export function closeAddMenu() {
  if (pop) { pop.remove(); pop = null; document.querySelectorAll(".pop-back").forEach(b => b.remove()); if (popAnchor && popAnchor.isConnected) popAnchor.focus({ preventScroll: true }); }
  popId = null; popAnchor = null;
}
function refreshPop() { if (pop && popId != null) { const f = document.activeElement && pop.contains(document.activeElement) && document.activeElement.tagName === "INPUT" ? document.activeElement.value : null; pop.innerHTML = popHTML(popId); if (f) { const i = pop.querySelector(".pop-new input"); i.value = f; } placePop(); } }
function onPopClick(ev) {
  const b = ev.target.closest("[data-pop]"); if (!b) return;
  const k = b.dataset.pop, e = ent(popId);
  if (k === "close") closeAddMenu();
  else if (k === "status") { const v = e.s === b.dataset.v ? "" : b.dataset.v; setEntry(popId, { s: v }); if (v) toast("Ajouté à « " + STATUSES[v] + " »"); }
  else if (k === "fav") { setEntry(popId, { f: !e.f }); toast(e.f ? "Retiré des coups de cœur" : "Ajouté aux coups de cœur ♥"); }
}
function onPopChange(ev) {
  const i = ev.target; if (i.dataset.pop !== "list") return;
  setInList(popId, i.value, i.checked);
  toast((i.checked ? "Ajouté à " : "Retiré de ") + "« " + ME.lists[i.value].n + " »");
}
async function onPopSubmit(ev) {
  ev.preventDefault();
  const inp = ev.target.querySelector("input"), id = popId;
  const lid = await createList(inp.value);
  if (lid) { inp.value = ""; setInList(id, lid, true); toast("Liste « " + ME.lists[lid].n + " » créée et titre ajouté"); }
}
onChange((what, id) => { if (pop && (what === "lists" || what === "collection" || id === popId)) refreshPop(); if (what === "session") closeAddMenu(); });
addEventListener("keydown", e => { if (e.key === "Escape" && pop) closeAddMenu(); });
addEventListener("resize", placePop);
addEventListener("scroll", () => { if (pop && !pop.classList.contains("sheet")) placePop(); }, { passive: true });

// ---------- Actions rapides des cartes (délégation globale) ----------
document.addEventListener("click", ev => {
  const q = ev.target.closest("[data-quick-add]");
  if (q) { ev.preventDefault(); openAddMenu(q, +q.dataset.quickAdd); return; }
  const b = ev.target.closest(".pc [data-act]"); if (!b) return;
  ev.preventDefault();
  const id = +b.closest(".pc").dataset.id, act = b.dataset.act;
  if (act === "fav") {
    if (!requireUser()) return;
    const on = !ent(id).f; setEntry(id, { f: on }); toast(on ? "Ajouté aux coups de cœur ♥" : "Retiré des coups de cœur");
  } else if (act === "add") openAddMenu(b, id);
  else if (act === "plus1") plusOne(id);
});
