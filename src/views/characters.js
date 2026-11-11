// Vue « Personnages » : recherche, étiquettes (barre rapide + panneau complet), grille de portraits.
import { norm, titleOf } from "../data.js";
import { CH, TAGS, CATS, loadCharacters, loadAllCharacters, chReady, imgUrl, visibleApps, mainAnime, onCharsComplete } from "../chars.js";
import { adultAllowed, ME } from "../state.js";
import { $, esc, fmt } from "../ui.js";

const S = { q: "", tags: new Set(), sort: "fav" };
let root = null, view = [], shown = 0, io = null;

/** Carte de personnage (portrait). */
export function charCard(c, sub) {
  const a = sub === undefined ? mainAnime(c, adultAllowed()) : null;
  const line = sub !== undefined ? sub : a ? titleOf(a) : "";
  const src = imgUrl(c);
  return `<a class="cc" href="#/personnage/${c.id}">
    <span class="cc-img">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<span class="cc-none">${esc((c.name || "?")[0])}</span>`}
      ${c.fav >= 1000 ? `<span class="cc-fav">♥ ${c.fav >= 10000 ? Math.round(c.fav / 1000) + " k" : fmt(c.fav)}</span>` : ""}${ME.favChars.has(c.id) ? `<span class="cc-mine" title="Dans tes favoris">♥</span>` : ""}</span>
    <b>${esc(c.name || c.native)}</b>${line ? `<small>${esc(line)}</small>` : ""}
  </a>`;
}

// Étiquettes mises en avant dans la barre rapide (si présentes).
const QUICK = ["Personnage principal", "Femme", "Homme", "Mage", "Épéiste", "Ninja", "Démon", "Vampire", "Pirate", "Idol", "Tsundere", "Génie",
  "Lunettes", "Robot / androïde", "Dieu / déesse", "Elfe", "Détective", "Princesse / prince", "Lycéen·ne", "Assassin", "Centenaire / immortel", "Cheveux roses", "Cheveux blancs"];

export function applyParams(p) {
  if (!p || ![...p.keys()].length) return;
  S.tags.clear(); S.q = p.get("q") || "";
  for (const t of p.getAll("tag")) { const x = TAGS.find(y => y.label === t || String(y.i) === t); if (x) S.tags.add(x.i); }
}

function compute() {
  const qs = norm(S.q).split(" ").filter(Boolean), ok = adultAllowed(), tags = [...S.tags];
  view = CH.filter(c => {
    if (qs.length && !qs.every(w => c.hay.includes(w))) return false;
    for (const t of tags) if (!c.tags.includes(t)) return false;
    return visibleApps(c, ok).length > 0;
  });
  if (S.sort === "az") view.sort((x, y) => x.name.localeCompare(y.name, "fr"));
  else if (S.sort === "img") view.sort((x, y) => (!!y.img - !!x.img) || x.rank - y.rank);
}
function quickBar() {
  return QUICK.map(l => TAGS.find(t => t.label === l)).filter(Boolean)
    .map(t => `<button type="button" class="gchip${S.tags.has(t.i) ? " on" : ""}" data-t="${t.i}">${S.tags.has(t.i) ? "✓ " : ""}${esc(t.label)}</button>`).join("");
}
function active() {
  const L = [...S.tags].map(i => `<button type="button" class="achip" data-t="${i}">${esc(TAGS[i].label)} <span aria-hidden="true">×</span></button>`);
  if (S.q) L.unshift(`<button type="button" class="achip" data-clearq>« ${esc(S.q)} » <span aria-hidden="true">×</span></button>`);
  if (L.length > 1) L.push(`<button type="button" class="linkbtn" data-clearall>Tout effacer</button>`);
  return L.join("");
}
function drawerHTML() {
  return `<div class="dr-h"><h2>Étiquettes</h2><button type="button" class="x" data-dr="close" aria-label="Fermer">×</button></div>
  <div class="dr-b">${CATS.map((cat, ci) => {
    const ts = TAGS.filter(t => t.cat === ci); if (!ts.length) return "";
    return `<section><h3>${esc(cat)}</h3><div class="chips">${ts.map(t => `<button type="button" class="chip${S.tags.has(t.i) ? " on" : ""}" data-t="${t.i}">${esc(t.label)} <small>${fmt(t.n)}</small></button>`).join("")}</div></section>`;
  }).join("")}
  <section><p class="hint">Les étiquettes sont déduites des fiches AniList (genre, âge, anniversaire, groupe sanguin, taille, description). Elles sont indicatives et parfois incomplètes : les personnages les mieux documentés en ont le plus.</p></section></div>
  <div class="dr-f"><button type="button" class="btn" data-dr="reset">Réinitialiser</button><button type="button" class="btn primary" data-dr="close" id="chDrCount">Voir</button></div>`;
}

function renderMore() {
  const next = view.slice(shown, shown + 60); shown += next.length;
  $("chGrid").insertAdjacentHTML("beforeend", next.map(c => charCard(c)).join(""));
}
function refresh() {
  if (!root || !root.isConnected || !chReady.loaded) return;
  compute();
  countText();
  $("chQuick").innerHTML = quickBar(); $("chActive").innerHTML = active();
  $("chFilt").innerHTML = `<span aria-hidden="true">⚙</span> Étiquettes${S.tags.size ? ` <b class="cnt">${S.tags.size}</b>` : ""}`;
  const dc = $("chDrCount"); if (dc) dc.textContent = `Voir ${fmt(view.length)} personnage${view.length > 1 ? "s" : ""}`;
  const d = $("chDrawer"); if (d && d.classList.contains("open")) d.querySelectorAll("[data-t]").forEach(b => b.classList.toggle("on", S.tags.has(+b.dataset.t)));
  shown = 0; $("chGrid").innerHTML = ""; $("chEmpty").hidden = !!view.length;
  renderMore();
}
function countText() {
  $("chCount").innerHTML = `<b>${fmt(view.length)}</b> personnage${view.length > 1 ? "s" : ""}` + (chReady.full ? "" : ` <span class="hint">· chargement des ${fmt(chReady.total - CH.length)} autres…</span>`);
}
// Quand le reste de l'index arrive : sans filtre, on complète la liste sans la redessiner (l'ordre ne change pas).
onCharsComplete(() => {
  if (!root || !root.isConnected) return;
  if (!S.q && !S.tags.size && S.sort === "fav") { compute(); countText(); $("chEmpty").hidden = !!view.length; }
  else refresh();
});
function toggleTag(i) { S.tags.has(i) ? S.tags.delete(i) : S.tags.add(i); refresh(); }

function openDrawer() {
  let d = $("chDrawer");
  if (!d) {
    d = document.createElement("aside"); d.id = "chDrawer"; d.className = "drawer"; d.setAttribute("aria-label", "Étiquettes");
    document.body.appendChild(d);
    const back = document.createElement("div"); back.id = "chDrawerBack"; back.className = "drawer-back"; document.body.appendChild(back);
    back.addEventListener("click", closeCharDrawer);
    d.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.dr === "close") return closeCharDrawer();
      if (b.dataset.dr === "reset") { S.tags.clear(); return refresh(); }
      if (b.dataset.t) toggleTag(+b.dataset.t);
    });
  }
  d.innerHTML = drawerHTML(); refresh();
  requestAnimationFrame(() => { d.classList.add("open"); $("chDrawerBack").classList.add("open"); });
  document.body.classList.add("noscroll");
}
export function closeCharDrawer() {
  const d = $("chDrawer"); if (!d) return;
  d.classList.remove("open"); $("chDrawerBack").classList.remove("open"); document.body.classList.remove("noscroll");
}

export function render(el, params) {
  root = el;
  el.innerHTML = `<div class="page chars-page">
    <div class="cat-top">
      <div><h1>Personnages</h1><div class="count" id="chCount">Chargement…</div></div>
      <div class="cat-tools">
        <div class="chsearch"><input type="search" id="chq" placeholder="Nom du personnage…" value="${esc(S.q)}" autocomplete="off" aria-label="Rechercher un personnage"></div>
        <button type="button" class="btn" id="chFilt">Étiquettes</button>
        <label class="sortsel"><span class="sr">Trier par</span><select id="chSort"><option value="fav">Les plus aimés</option><option value="az">Nom A → Z</option><option value="img">Avec image d'abord</option></select></label>
      </div>
    </div>
    <div class="genre-bar" id="chQuick" role="group" aria-label="Étiquettes rapides"></div>
    <div class="active" id="chActive"></div>
    <div class="cgrid" id="chGrid"><div class="boot"><div class="spinner" aria-hidden="true"></div><p>Chargement des personnages…</p></div></div>
    <div class="empty" id="chEmpty" hidden><p>Aucun personnage ne correspond.</p><button type="button" class="btn" data-clearall>Effacer les filtres</button></div>
    <div id="chSentinel" aria-hidden="true"></div>
  </div>`;
  $("chSort").value = S.sort;
  $("chFilt").addEventListener("click", openDrawer);
  $("chSort").addEventListener("change", e => { S.sort = e.target.value; refresh(); });
  let t; $("chq").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value; refresh(); }, 150); });
  el.querySelector(".chars-page").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.t) toggleTag(+b.dataset.t);
    else if (b.hasAttribute("data-clearq")) { S.q = ""; $("chq").value = ""; refresh(); }
    else if (b.hasAttribute("data-clearall")) { S.q = ""; $("chq").value = ""; S.tags.clear(); refresh(); }
  });
  if (io) io.disconnect();
  io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting) && shown < view.length) renderMore(); }, { rootMargin: "900px" });
  io.observe($("chSentinel"));
  loadCharacters().then(() => { applyParams(params); if ($("chq")) $("chq").value = S.q; refresh(); setTimeout(() => loadAllCharacters().catch(() => {}), 0); })
    .catch(() => { if ($("chGrid")) $("chGrid").innerHTML = `<div class="empty"><p>Les personnages n'ont pas pu être chargés.</p></div>`; });
}
