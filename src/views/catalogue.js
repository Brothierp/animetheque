// Vue « Catalogue » : grille d'affiches, barre des genres, panneau de filtres, tri, défilement infini.
import { A, T, UP, tr, norm, ready, loadChars } from "../data.js";
import { ent, adultAllowed, ME } from "../state.js";
import { $, esc, fmt, grid } from "../ui.js";

export const S = { q: "", chara: "", lang: "FE", genreIn: new Set(), genreEx: new Set(), tagIn: new Set(), tagEx: new Set(),
  format: new Set(), status: new Set(), season: new Set(), source: new Set(), country: new Set(), yMin: null, yMax: null,
  eMin: null, eMax: null, dMin: null, dMax: null, score: 0, studio: "", sort: "pop", adult: false, upcoming: false };
const SETS = ["genreIn", "genreEx", "tagIn", "tagEx", "format", "status", "season", "source", "country"];
const DEFAULTS = { q: "", chara: "", lang: "FE", yMin: null, yMax: null, eMin: null, eMax: null, dMin: null, dMax: null, score: 0, studio: "", sort: "pop", adult: false, upcoming: false };
export function resetFilters() { Object.assign(S, DEFAULTS); SETS.forEach(k => S[k].clear()); }

const SORTS = { pop: "Popularité", score: "Mieux notés", new: "Plus récents", old: "Plus anciens", az: "Titre A → Z", eps: "Nombre d'épisodes" };
let view = [], shown = 0, io = null, root = null;

/** Applique des paramètres d'URL (#/catalogue?genre=Isekai&sort=score…). Renvoie vrai s'il y en avait. */
export function applyParams(p) {
  if (![...p.keys()].length) return false;
  resetFilters();
  const idx = (k, v) => T[k].indexOf(v);
  if (p.get("q")) S.q = p.get("q");
  if (p.get("chara")) S.chara = p.get("chara");
  if (p.get("sort") && SORTS[p.get("sort")]) S.sort = p.get("sort");
  for (const g of p.getAll("genre")) { const i = idx("genres", g); if (i >= 0) S.genreIn.add(i); }
  for (const g of p.getAll("tag")) { const i = idx("tags", g); if (i >= 0) S.tagIn.add(i); }
  for (const g of p.getAll("format")) { const i = idx("format", g); if (i >= 0) S.format.add(i); }
  for (const g of p.getAll("status")) { const i = idx("status", g); if (i >= 0) { S.status.add(i); if (i === UP) S.upcoming = true; } }
  for (const g of p.getAll("studio")) S.studio = norm(g);
  if (p.get("lang")) S.lang = p.get("lang");
  if (p.get("minscore")) S.score = +p.get("minscore");
  return true;
}

function filterCount() {
  let n = SETS.reduce((s, k) => s + (k.startsWith("genre") ? 0 : S[k].size), 0);
  for (const k of ["yMin", "yMax", "eMin", "eMax", "dMin", "dMax"]) if (S[k] != null) n++;
  if (S.score) n++; if (S.studio) n++; if (S.chara) n++; if (S.lang !== "FE") n++; if (S.adult) n++; if (S.upcoming) n++;
  return n;
}

function compute() {
  const qs = norm(S.q).split(" ").filter(Boolean), cq = norm(S.chara).split(" ").filter(Boolean);
  const inRange = (v, lo, hi) => (lo == null || (v && v >= lo)) && (hi == null || (v && v <= hi));
  const adult = S.adult && adultAllowed();
  view = A.filter(a => {
    if (a.adult !== adult) return false;
    if (a.status === UP && !S.upcoming && !S.status.has(UP)) return false;
    if (S.lang === "FE" && !a.lang) return false;
    if (S.lang === "F" && !a.lang.includes("F")) return false;
    if (S.lang === "E" && !a.lang.includes("E")) return false;
    if (S.lang === "both" && a.lang !== "FE") return false;
    if (qs.length && !qs.every(w => a.hay.includes(w))) return false;
    if (cq.length && !cq.every(w => a.charHay.includes(w))) return false;
    for (const g of S.genreIn) if (!a.genres.includes(g)) return false;
    for (const g of S.genreEx) if (a.genres.includes(g)) return false;
    for (const g of S.tagIn) if (!a.tags.includes(g)) return false;
    for (const g of S.tagEx) if (a.tags.includes(g)) return false;
    if (S.format.size && !S.format.has(a.format)) return false;
    if (S.status.size && !S.status.has(a.status)) return false;
    if (S.season.size && !S.season.has(a.season)) return false;
    if (S.source.size && !S.source.has(a.source)) return false;
    if (S.country.size && !S.country.has(a.country)) return false;
    if (!inRange(a.year, S.yMin, S.yMax) || !inRange(a.eps, S.eMin, S.eMax) || !inRange(a.dur, S.dMin, S.dMax)) return false;
    if (S.score && a.score < S.score) return false;
    if (S.studio && !a.studioHay.includes(S.studio)) return false;
    return true;
  });
  const title = a => (a.english || a.romaji).toLowerCase();
  view.sort({ pop: (a, b) => a.rank - b.rank, score: (a, b) => b.score - a.score || a.rank - b.rank,
    new: (a, b) => (b.year || 0) - (a.year || 0) || a.rank - b.rank, old: (a, b) => (a.year || 9999) - (b.year || 9999) || a.rank - b.rank,
    az: (a, b) => title(a).localeCompare(title(b), "fr"), eps: (a, b) => b.eps - a.eps || a.rank - b.rank }[S.sort]);
}

// ---------- Rendu ----------
function genreBar() {
  const counts = new Array(T.genres.length).fill(0);
  for (const a of A) if (!a.adult) a.genres.forEach(g => counts[g]++);
  const order = T.genres.map((_, i) => i).filter(i => counts[i] > 0 && T.genres[i] !== "Hentai").sort((a, b) => counts[b] - counts[a]);
  return order.map(i => `<button type="button" class="gchip${S.genreIn.has(i) ? " on" : S.genreEx.has(i) ? " ex" : ""}" data-g="${i}"
    title="${fmt(counts[i])} titres · 1er clic : inclure, 2e : exclure, 3e : retirer">${S.genreEx.has(i) ? "− " : S.genreIn.has(i) ? "✓ " : ""}${esc(tr("genres", T.genres[i]))}</button>`).join("");
}
function activeChips() {
  const L = [];
  const add = (label, key, extra = "") => L.push(`<button type="button" class="achip" data-rm="${key}"${extra}>${esc(label)} <span aria-hidden="true">×</span></button>`);
  if (S.q) add(`« ${S.q} »`, "q");
  if (S.lang !== "any") add({ FE: "Dispo en FR ou EN", F: "Dispo en FR", E: "Dispo en EN", both: "Dispo en FR et EN" }[S.lang], "lang");
  if (S.chara) add(`Personnage : ${S.chara}`, "chara");
  S.genreIn.forEach(i => add(tr("genres", T.genres[i]), "genreIn:" + i));
  S.genreEx.forEach(i => add("sans " + tr("genres", T.genres[i]), "genreEx:" + i));
  S.tagIn.forEach(i => add(T.tags[i], "tagIn:" + i));
  S.tagEx.forEach(i => add("sans " + T.tags[i], "tagEx:" + i));
  for (const k of ["format", "status", "season", "source", "country"]) S[k].forEach(i => add(tr(k, T[k][i]), k + ":" + i));
  if (S.yMin != null || S.yMax != null) add(`Années ${S.yMin ?? "…"}–${S.yMax ?? "…"}`, "years");
  if (S.eMin != null || S.eMax != null) add(`Épisodes ${S.eMin ?? "…"}–${S.eMax ?? "…"}`, "eps");
  if (S.dMin != null || S.dMax != null) add(`Durée ${S.dMin ?? "…"}–${S.dMax ?? "…"} min`, "dur");
  if (S.score) add(`Note ≥ ${S.score}`, "score");
  if (S.studio) add(`Studio : ${S.studioLabel || S.studio}`, "studio");
  if (S.upcoming) add("Avec les titres à venir", "upcoming");
  if (S.adult) add("Contenu 18+ uniquement", "adult");
  if (L.length > 1) L.push(`<button type="button" class="linkbtn" data-rm="all">Tout effacer</button>`);
  return L.join("");
}
function removeChip(key) {
  if (key === "all") { const q = S.q; resetFilters(); S.lang = "any"; S.q = q; S.q = ""; const qi = $("q"); if (qi) qi.value = ""; return; }
  const [k, v] = key.split(":");
  if (v != null) S[k].delete(+v);
  else if (k === "q") { S.q = ""; const qi = $("q"); if (qi) qi.value = ""; }
  else if (k === "lang") S.lang = "any";
  else if (k === "years") S.yMin = S.yMax = null;
  else if (k === "eps") S.eMin = S.eMax = null;
  else if (k === "dur") S.dMin = S.dMax = null;
  else if (k === "studio") { S.studio = ""; S.studioLabel = ""; }
  else if (k === "score") S.score = 0;
  else S[k] = DEFAULTS[k];
}

function chipSet(key, set, opts = {}) {
  const counts = new Array(T[key].length).fill(0);
  const field = { genres: "genres", format: "format", status: "status", season: "season", source: "source", country: "country" }[key];
  for (const a of A) { const v = a[field]; if (Array.isArray(v)) v.forEach(i => counts[i]++); else if (v >= 0) counts[v]++; }
  return T[key].map((v, i) => i).filter(i => counts[i] >= (opts.min || 1) && T[key][i] !== opts.skip)
    .map(i => `<button type="button" class="chip${set.has(i) ? " on" : ""}" data-set="${opts.name || key}" data-i="${i}">${esc(tr(key, T[key][i]))}</button>`).join("");
}
function drawerHTML() {
  const ok = adultAllowed();
  return `<div class="dr-h"><h2>Filtres</h2><button type="button" class="x" data-dr="close" aria-label="Fermer">×</button></div>
  <div class="dr-b">
    <section><h3>Disponibilité en streaming légal</h3>
      <div class="seg" data-seg="lang">${[["any", "Toutes"], ["FE", "FR ou EN"], ["F", "FR"], ["E", "EN"], ["both", "FR + EN"]].map(([v, l]) => `<button type="button" data-v="${v}" class="${S.lang === v ? "on" : ""}">${l}</button>`).join("")}</div>
      <p class="hint">Déduit des plateformes qui diffusent le titre (doublage ou sous-titres, selon le pays).</p></section>
    <section><h3>Diffusion</h3><div class="chips">${chipSet("status", S.status)}</div>
      <label class="tgl"><input type="checkbox" data-bool="upcoming"${S.upcoming ? " checked" : ""}> Inclure les animés à venir</label></section>
    <section><h3>Format</h3><div class="chips">${chipSet("format", S.format)}</div></section>
    <section><h3>Année</h3><div class="range"><input type="number" inputmode="numeric" data-num="yMin" placeholder="de" value="${S.yMin ?? ""}"><span>–</span><input type="number" inputmode="numeric" data-num="yMax" placeholder="à" value="${S.yMax ?? ""}"></div>
      <div class="chips">${chipSet("season", S.season)}</div></section>
    <section><h3>Personnage</h3><input type="text" data-text="chara" value="${esc(S.chara)}" placeholder="Ex. Luffy, Levi, Frieren…">
      <p class="hint">${ready.chars ? "25 personnages principaux indexés par animé." : "Chargement des personnages…"}</p></section>
    <section><h3>Thèmes</h3><input type="text" data-tag list="tagList" placeholder="Ex. Time Travel, Female Protagonist…">
      <datalist id="tagList">${T.tags.map(t => `<option value="${esc(t)}"></option>`).join("")}</datalist>
      <div class="chips">${[...S.tagIn].map(i => `<button type="button" class="chip on" data-tagchip="${i}">${esc(T.tags[i])}</button>`).join("")}${[...S.tagEx].map(i => `<button type="button" class="chip ex" data-tagchip="${i}">${esc(T.tags[i])}</button>`).join("")}</div></section>
    <section><h3>Nombre d'épisodes</h3><div class="range"><input type="number" inputmode="numeric" data-num="eMin" placeholder="min" value="${S.eMin ?? ""}"><span>–</span><input type="number" inputmode="numeric" data-num="eMax" placeholder="max" value="${S.eMax ?? ""}"></div></section>
    <section><h3>Durée d'un épisode (min)</h3><div class="range"><input type="number" inputmode="numeric" data-num="dMin" placeholder="min" value="${S.dMin ?? ""}"><span>–</span><input type="number" inputmode="numeric" data-num="dMax" placeholder="max" value="${S.dMax ?? ""}"></div></section>
    <section><h3>Note minimale <output id="scoreOut">${S.score ? "≥ " + S.score : "toutes"}</output></h3><input type="range" min="0" max="95" step="5" data-num="score" value="${S.score}"></section>
    <section><h3>Studio</h3><input type="text" data-studio list="studioList" value="${esc(S.studioLabel || "")}" placeholder="Ex. MAPPA, Kyoto Animation…">
      <datalist id="studioList">${T.studios.slice(0, 1500).map(t => `<option value="${esc(t)}"></option>`).join("")}</datalist></section>
    <section><h3>Œuvre d'origine</h3><div class="chips">${chipSet("source", S.source, { min: 20 })}</div></section>
    <section><h3>Pays de production</h3><div class="chips">${chipSet("country", S.country)}</div></section>
    <section><h3>Contenu adulte</h3>
      <label class="tgl${ok ? "" : " off"}"><input type="checkbox" data-bool="adult"${S.adult && ok ? " checked" : ""}${ok ? "" : " disabled"}> Uniquement le contenu 18+</label>
      <p class="hint">${ok ? "Case cochée, seuls les titres adultes s'affichent." : ME.user ? "Réservé aux comptes majeurs (année de naissance indiquée dans ton profil)." : "Réservé aux comptes majeurs : connecte-toi pour y accéder."}</p></section>
  </div>
  <div class="dr-f"><button type="button" class="btn" data-dr="reset">Réinitialiser</button><button type="button" class="btn primary" data-dr="close" id="drCount">Voir les titres</button></div>`;
}

function renderMore() {
  const next = view.slice(shown, shown + 60); shown += next.length;
  $("catGrid").insertAdjacentHTML("beforeend", grid(next));
  $("catEnd").hidden = shown < view.length || !view.length;
}
export function refresh() {
  if (!root || !root.isConnected) return;
  compute();
  $("catCount").innerHTML = `<b>${fmt(view.length)}</b> titre${view.length > 1 ? "s" : ""}`;
  $("genreBar").innerHTML = genreBar();
  $("active").innerHTML = activeChips();
  const n = filterCount(); $("filtBtn").innerHTML = `<span aria-hidden="true">⚙</span> Filtres${n ? ` <b class="cnt">${n}</b>` : ""}`;
  const dc = $("drCount"); if (dc) dc.textContent = `Voir ${fmt(view.length)} titre${view.length > 1 ? "s" : ""}`;
  shown = 0; $("catGrid").innerHTML = "";
  $("catEmpty").hidden = !!view.length;
  renderMore();
}

function openDrawer() {
  let d = $("drawer");
  if (!d) {
    d = document.createElement("aside"); d.id = "drawer"; d.className = "drawer"; d.setAttribute("aria-label", "Filtres");
    document.body.appendChild(d);
    const back = document.createElement("div"); back.id = "drawerBack"; back.className = "drawer-back"; document.body.appendChild(back);
    back.addEventListener("click", closeDrawer);
    bindDrawer(d);
  }
  d.innerHTML = drawerHTML(); refresh();
  requestAnimationFrame(() => { d.classList.add("open"); $("drawerBack").classList.add("open"); });
  document.body.classList.add("noscroll");
  if (!ready.chars) loadChars().then(() => { if ($("drawer")) { const h = $("drawer").querySelector('[data-text="chara"] + .hint'); if (h) h.textContent = "25 personnages principaux indexés par animé."; } });
}
export function closeDrawer() {
  const d = $("drawer"); if (!d) return;
  d.classList.remove("open"); $("drawerBack").classList.remove("open"); document.body.classList.remove("noscroll");
}
function bindDrawer(d) {
  let t;
  d.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.dr === "close") return closeDrawer();
    if (b.dataset.dr === "reset") { const q = S.q; resetFilters(); S.q = q; d.innerHTML = drawerHTML(); return refresh(); }
    if (b.dataset.set) { const s = S[b.dataset.set], i = +b.dataset.i; s.has(i) ? s.delete(i) : s.add(i); b.classList.toggle("on"); return refresh(); }
    if (b.dataset.tagchip) { const i = +b.dataset.tagchip; if (S.tagIn.has(i)) { S.tagIn.delete(i); S.tagEx.add(i); } else S.tagEx.delete(i); d.innerHTML = drawerHTML(); return refresh(); }
    const seg = b.closest("[data-seg]"); if (seg) { S[seg.dataset.seg] = b.dataset.v; seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); return refresh(); }
  });
  d.addEventListener("input", e => {
    const i = e.target;
    if (i.dataset.num) { S[i.dataset.num] = i.value === "" ? (i.dataset.num === "score" ? 0 : null) : +i.value; if (i.dataset.num === "score") $("scoreOut").textContent = S.score ? "≥ " + S.score : "toutes"; }
    else if (i.dataset.text) S[i.dataset.text] = i.value;
    else if (i.hasAttribute("data-studio")) { S.studio = norm(i.value); S.studioLabel = i.value; }
    else return;
    clearTimeout(t); t = setTimeout(refresh, 180);
  });
  d.addEventListener("change", e => {
    const i = e.target;
    if (i.dataset.bool) { S[i.dataset.bool] = i.checked; refresh(); }
    else if (i.hasAttribute("data-tag")) {
      const k = T.tags.findIndex(x => x.toLowerCase() === i.value.trim().toLowerCase());
      if (k >= 0) { S.tagIn.add(k); d.innerHTML = drawerHTML(); refresh(); }
    }
  });
}

export function render(el, params) {
  root = el;
  if (params) applyParams(params);
  const qi = $("q"); if (qi && qi.value !== S.q) qi.value = S.q;
  el.innerHTML = `<div class="page cat">
    <div class="cat-top">
      <div><h1>Catalogue</h1><div class="count" id="catCount"></div></div>
      <div class="cat-tools">
        <button type="button" class="btn" id="filtBtn">Filtres</button>
        <label class="sortsel"><span class="sr">Trier par</span><select id="sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${S.sort === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
      </div>
    </div>
    <div class="genre-bar" id="genreBar" role="group" aria-label="Genres"></div>
    <div class="active" id="active"></div>
    <div class="grid" id="catGrid"></div>
    <div class="empty" id="catEmpty" hidden><p>Aucun titre ne correspond.</p><button type="button" class="btn" data-rm="lang">Élargir à toutes les disponibilités</button> <button type="button" class="btn" data-rm="all">Effacer les filtres</button></div>
    <p class="end hint" id="catEnd" hidden>Tu as tout vu ! Affine les filtres pour découvrir d'autres titres.</p>
    <div id="sentinel" aria-hidden="true"></div>
  </div>`;
  $("filtBtn").addEventListener("click", openDrawer);
  $("sort").addEventListener("change", e => { S.sort = e.target.value; refresh(); });
  $("genreBar").addEventListener("click", e => {
    const b = e.target.closest(".gchip"); if (!b) return; const i = +b.dataset.g;
    if (S.genreIn.has(i)) { S.genreIn.delete(i); S.genreEx.add(i); } else if (S.genreEx.has(i)) S.genreEx.delete(i); else S.genreIn.add(i);
    refresh();
  });
  el.querySelector(".cat").addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (b) { removeChip(b.dataset.rm); if ($("drawer")) $("drawer").innerHTML = drawerHTML(); refresh(); } });
  if (io) io.disconnect();
  io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting) && shown < view.length) renderMore(); }, { rootMargin: "800px" });
  io.observe($("sentinel"));
  refresh();
  if (S.chara && !ready.chars) loadChars().then(refresh);
}
export function setQuery(q) { S.q = q; refresh(); }
export const onCollection = () => {};
