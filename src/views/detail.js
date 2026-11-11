// Fiche d'un animé, ouverte dans une fenêtre par-dessus la page (#/anime/<id>).
import { byId, T, tr, titleOf, altTitles, coverStyle, extLink, similar, ready, loadChars } from "../data.js";
import { ME, ent, STATUSES, setEntry, setInList, clearAnime, adultAllowed, requireUser, onChange } from "../state.js";
import { $, esc, cover, row, starsHTML, openAddMenu } from "../ui.js";
import { toast } from "../toast.js";

let el = null, curId = null, onCloseCb = null;
const ROLE = { M: "Principal", S: "Secondaire", B: "Figurant" };

function mineHTML(a) {
  if (!ME.user) return `<div class="mine-cta"><p>Ajoute ce titre à ta collection : statut, note, coup de cœur, commentaire et listes.</p><button type="button" class="btn primary" data-d="login">Se connecter ou créer un compte</button></div>`;
  if (!ME.ready) return `<div class="mine-cta"><p class="hint">Chargement de ta collection…</p></div>`;
  const e = ent(a.id), L = Object.entries(e.l).filter(([k]) => ME.lists[k]);
  return `<div class="mine2">
    <div class="m-row">
      <button type="button" class="btn fav${e.f ? " on" : ""}" data-d="fav" aria-pressed="${!!e.f}">${e.f ? "♥ Coup de cœur" : "♡ Coup de cœur"}</button>
      ${starsHTML(a.id)}
    </div>
    <div class="m-status" role="group" aria-label="Statut">${Object.entries(STATUSES).map(([k, v]) => `<button type="button" data-d="status" data-v="${k}" class="s-${k}${e.s === k ? " on" : ""}" aria-pressed="${e.s === k}">${v}</button>`).join("")}</div>
    <div class="m-lists"><span class="hint">Listes :</span> ${L.map(([k]) => `<span class="lchip">${esc(ME.lists[k].n)}<button type="button" data-d="unlist" data-l="${esc(k)}" aria-label="Retirer de ${esc(ME.lists[k].n)}">×</button></span>`).join("")}
      <button type="button" class="btn sm" data-d="lists">+ Ajouter à une liste</button></div>
    <form class="m-comment" data-d="comment">
      <label for="cm">Mon avis <span class="hint" id="cmCount">${(e.c || "").length}/280</span></label>
      <textarea id="cm" maxlength="280" placeholder="Ce que tu en as pensé (privé)…">${esc(e.c || "")}</textarea>
      <div class="m-c-actions"><button type="submit" class="btn sm primary" id="cmSave" hidden>Enregistrer l'avis</button>
      ${isInCol(e) ? `<button type="button" class="linkbtn" data-d="clear">Retirer de ma collection</button>` : ""}</div>
    </form>
  </div>`;
}
const isInCol = e => e.f || e.r || e.c || e.s || Object.keys(e.l).length;

function html(a) {
  const t = titleOf(a), alts = altTitles(a);
  const meta = [a.format >= 0 ? tr("format", T.format[a.format]) : "", a.year ? `${a.season >= 0 ? tr("season", T.season[a.season]) + " " : ""}${a.year}` : "",
    a.eps ? `${a.eps} épisode${a.eps > 1 ? "s" : ""}` : "", a.dur ? `${a.dur} min` : "", a.status >= 0 ? tr("status", T.status[a.status]) : ""].filter(Boolean);
  const studio = a.studios.map(i => `<a href="#/catalogue?studio=${encodeURIComponent(T.studios[i])}">${esc(T.studios[i])}</a>`).join(", ");
  const langs = a.lang ? [...a.lang].map(l => `<span class="lg ${l}">${l === "F" ? "FR" : "EN"}</span>`).join("") : `<span class="lg N">Non dispo en FR/EN</span>`;
  const plats = a.plats.map(([i, u]) => `<a class="plat" href="${esc(u)}" target="_blank" rel="noopener">${esc(T.platforms[i])} <span aria-hidden="true">↗</span></a>`).join("");
  const chars = a.chars.length ? a.chars.map(c => `<a class="ch ${c[2]}" href="#/catalogue?chara=${encodeURIComponent(c[0] || c[1])}" title="${esc((c[1] ? c[1] + " · " : "") + ROLE[c[2]])}">${esc(c[0] || c[1])}</a>`).join("") : "";
  return `<div class="d-banner" style="${coverStyle(a)}"></div>
  <button type="button" class="d-close x" data-d="close" aria-label="Fermer">×</button>
  <div class="d-head">
    ${cover(a, "d-cv")}
    <div class="d-title">
      <h1 id="dTitle">${esc(t)}</h1>
      ${alts.length ? `<p class="d-alt">${esc(alts.join(" · "))}</p>` : ""}
      <div class="d-meta">${meta.map(m => `<span>${esc(m)}</span>`).join("")}</div>
      <div class="d-score">${a.score ? `<b>${a.score}</b><small>/100</small>` : `<small>Pas encore noté</small>`} ${a.adult ? `<span class="lg A">18+</span>` : ""} ${langs}</div>
    </div>
  </div>
  <div class="d-body">
    <div class="d-main">
      <section class="d-mine" id="dMine">${mineHTML(a)}</section>
      ${plats ? `<section><h2>Où regarder</h2><div class="plats">${plats}</div><p class="hint">FR / EN indique qu'au moins une plateforme propose en général cette langue (doublage ou sous-titres) ; cela peut varier selon le pays.</p></section>` : ""}
      ${a.desc ? `<section><h2>Synopsis</h2><p class="syn">${esc(a.desc)}</p></section>` : ""}
      <section><h2>Personnages</h2><div class="chars" id="dChars">${chars || (ready.chars ? `<p class="hint">Aucun personnage référencé.</p>` : `<p class="hint">Chargement…</p>`)}</div></section>
    </div>
    <aside class="d-side">
      <div><h3>Genres</h3><div class="tags">${a.genres.map(i => `<a class="g" href="#/catalogue?genre=${encodeURIComponent(T.genres[i])}">${esc(tr("genres", T.genres[i]))}</a>`).join("") || "—"}</div></div>
      ${studio ? `<div><h3>Studio</h3><p>${studio}</p></div>` : ""}
      ${a.source >= 0 ? `<div><h3>D'après</h3><p>${esc(tr("source", T.source[a.source]))}</p></div>` : ""}
      ${a.tags.length ? `<div><h3>Thèmes</h3><div class="tags">${a.tags.slice(0, 14).map(i => `<a class="tg" href="#/catalogue?tag=${encodeURIComponent(T.tags[i])}">${esc(T.tags[i])}</a>`).join("")}</div></div>` : ""}
      <div><h3>Fiches externes</h3><p class="ext"><a href="${extLink(a)}" target="_blank" rel="noopener">${a.adult && a.mal ? "MyAnimeList" : "AniList"} ↗</a>${a.mal && !a.adult ? ` · <a href="https://myanimelist.net/anime/${a.mal}" target="_blank" rel="noopener">MyAnimeList ↗</a>` : ""}</p></div>
    </aside>
  </div>
  <div class="d-sim" id="dSim"></div>`;
}

function renderMine() { const m = $("dMine"); if (m && curId != null) m.innerHTML = mineHTML(byId.get(curId)); }

export function openDetail(id, onClose) {
  const a = byId.get(id);
  if (!a) return false;
  if (a.adult && !adultAllowed()) { toast("Ce titre est réservé aux comptes majeurs."); return false; }
  curId = id; onCloseCb = onClose;
  if (!el) {
    el = document.createElement("div"); el.className = "dmodal"; el.id = "detail";
    el.innerHTML = `<div class="d-back" data-d="close"></div><div class="d-panel" role="dialog" aria-modal="true" aria-labelledby="dTitle" tabindex="-1"></div>`;
    document.body.appendChild(el); bind();
  }
  const panel = el.querySelector(".d-panel");
  panel.innerHTML = html(a); panel.scrollTop = 0;
  el.classList.add("open"); document.body.classList.add("noscroll");
  panel.focus({ preventScroll: true });
  setTimeout(() => { if (curId === id) $("dSim").innerHTML = row("Dans le même esprit", similar(a, 14, adultAllowed())); }, 30);
  if (!ready.chars) loadChars().then(() => { if (curId === id) { $("dChars").innerHTML = a.chars.map(c => `<a class="ch ${c[2]}" href="#/catalogue?chara=${encodeURIComponent(c[0] || c[1])}">${esc(c[0] || c[1])}</a>`).join("") || `<p class="hint">Aucun personnage référencé.</p>`; } });
  return true;
}
export function closeDetail() {
  if (!el || !el.classList.contains("open")) return;
  el.classList.remove("open"); document.body.classList.remove("noscroll"); curId = null;
}
export const isDetailOpen = () => !!(el && el.classList.contains("open"));

function bind() {
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-d]"); if (!b) { if (e.target.closest("a[href^='#/']")) closeDetail(); return; }
    const k = b.dataset.d, id = curId, cur = ent(id);
    if (k === "close") { if (onCloseCb) onCloseCb(); else closeDetail(); }
    else if (k === "login") requireUser();
    else if (k === "fav") { setEntry(id, { f: !cur.f }); toast(cur.f ? "Retiré des coups de cœur" : "Ajouté aux coups de cœur ♥"); }
    else if (k === "status") { const v = cur.s === b.dataset.v ? "" : b.dataset.v; setEntry(id, { s: v }); if (v) toast("Statut : " + STATUSES[v]); }
    else if (k === "lists") openAddMenu(b, id);
    else if (k === "unlist") { setInList(id, b.dataset.l, false); toast("Retiré de la liste"); }
    else if (k === "clear") { if (confirm("Retirer ce titre de ta collection (statut, note, avis, listes) ?")) { clearAnime(id); toast("Retiré de ta collection"); } }
  });
  el.addEventListener("click", e => { const s = e.target.closest(".d-mine [data-act=star]"); if (!s) return; const v = +s.dataset.v; setEntry(curId, { r: ent(curId).r === v ? 0 : v }); });
  el.addEventListener("input", e => {
    if (e.target.id !== "cm") return;
    $("cmCount").textContent = e.target.value.length + "/280";
    $("cmSave").hidden = e.target.value.trim() === (ent(curId).c || "");
  });
  el.addEventListener("submit", e => {
    if (e.target.dataset.d !== "comment") return; e.preventDefault();
    setEntry(curId, { c: $("cm").value.trim().slice(0, 280) }); toast("Avis enregistré");
  });
  addEventListener("keydown", e => { if (e.key === "Escape" && isDetailOpen() && !document.querySelector(".pop")) { if (onCloseCb) onCloseCb(); else closeDetail(); } });
}
onChange((what, id) => {
  if (!isDetailOpen()) return;
  if (what === "entry" && id === curId) {
    // ne pas effacer un commentaire en cours de saisie
    const t = $("cm"), draft = t && document.activeElement === t ? t.value : null;
    renderMine();
    if (draft != null) { const n = $("cm"); n.value = draft; n.focus(); $("cmSave").hidden = draft.trim() === (ent(curId).c || ""); }
  } else if (["session", "collection", "lists", "profile"].includes(what)) renderMine();
});
