import "./style.css";
import { supabase } from "./supabase.js";
import { initAuth, openAuth, signOut, displayName } from "./auth.js";
import * as store from "./store.js";

const FR = {
  format: { TV: "Série TV", TV_SHORT: "Série courte", MOVIE: "Film", SPECIAL: "Spécial", OVA: "OAV", ONA: "ONA (web)", MUSIC: "Clip musical" },
  status: { FINISHED: "Terminé", RELEASING: "En cours", NOT_YET_RELEASED: "À venir", CANCELLED: "Annulé", HIATUS: "En pause" },
  season: { WINTER: "Hiver", SPRING: "Printemps", SUMMER: "Été", FALL: "Automne" },
  country: { JP: "Japon", CN: "Chine", KR: "Corée du Sud", TW: "Taïwan" },
  source: { ORIGINAL: "Original", MANGA: "Manga", LIGHT_NOVEL: "Light novel", VISUAL_NOVEL: "Visual novel", VIDEO_GAME: "Jeu vidéo", NOVEL: "Roman",
    WEB_NOVEL: "Web novel", OTHER: "Autre", DOUJINSHI: "Doujinshi", ANIME: "Anime", WEB_MANGA: "Web manga", LIVE_ACTION: "Film live", GAME: "Jeu",
    COMIC: "Comic", MULTIMEDIA_PROJECT: "Projet multimédia", PICTURE_BOOK: "Livre illustré", MULTIMEDIA: "Multimédia" },
  genres: { Action: "Action", Adventure: "Aventure", Comedy: "Comédie", Drama: "Drame", Ecchi: "Ecchi", Fantasy: "Fantasy", Horror: "Horreur",
    "Mahou Shoujo": "Magical girl", Mecha: "Mecha", Music: "Musique", Mystery: "Mystère", Psychological: "Psychologique", Romance: "Romance",
    "Sci-Fi": "Science-fiction", "Slice of Life": "Tranche de vie", Sports: "Sport", Supernatural: "Surnaturel", Thriller: "Thriller", Hentai: "Hentai",
    Isekai: "Isekai", Shounen: "Shōnen", Shoujo: "Shōjo", Seinen: "Seinen", Josei: "Josei", "Martial Arts": "Arts martiaux", School: "Vie scolaire",
    Historical: "Historique", Military: "Militaire", Harem: "Harem", "Reverse Harem": "Harem inversé", Iyashikei: "Iyashikei (apaisant)",
    "Super Power": "Super-pouvoirs", Magic: "Magie", Cyberpunk: "Cyberpunk", "Post-Apocalyptic": "Post-apocalyptique", Reincarnation: "Réincarnation",
    Survival: "Survie", Space: "Espace", Vampire: "Vampires", Samurai: "Samouraïs", "Video Games": "Jeux vidéo", Cooking: "Cuisine", Idol: "Idols",
    "Boys' Love": "Boys' Love (BL / Yaoi)", Yuri: "Yuri", Detective: "Enquête", Zombie: "Zombies", Demons: "Démons", Mythology: "Mythologie" }
};
const tr = (k, v) => (FR[k] && FR[k][v]) || v.replace(/_/g, " ").toLowerCase().replace(/^./, c => c.toUpperCase());
const norm = s => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let UP = -1, T, A = [], view = [], shown = 0;
const S = { q: "", chara: "", lang: "FE", genreIn: new Set(), genreEx: new Set(), tagIn: new Set(), tagEx: new Set(),
  format: new Set(), status: new Set(), season: new Set(), source: new Set(), country: new Set(), yMin: null, yMax: null,
  eMin: null, eMax: null, dMin: null, dMax: null, score: 0, studio: "", sort: "pop", adult: false, upcoming: false, col: "all" };

fetch("/data.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(init).catch(() => {
  $("list").innerHTML = '<div class="empty">Le catalogue n\'a pas pu être chargé. Rechargez la page.</div>'; $("count").textContent = "";
});

function init(d) {
  T = d.tables;
  A = d.items.map(x => ({ id: x[0], mal: x[1], romaji: x[2], english: x[3], native: x[4], syn: x[5], format: x[6], status: x[7], eps: x[8], dur: x[9],
    season: x[10], year: x[11], genres: x[12], tags: x[13], studios: x[14], score: x[15], pop: x[16], country: x[17], source: x[18], desc: x[19],
    plats: x[20], lang: x[21], adult: x[22] === 1, cov: x[23], chars: [], charHay: "", hay: norm([x[2], x[3], x[4], ...x[5]].join(" ")),
    studioHay: x[14].map(i => norm(T.studios[i])).join("|") }));
  A.forEach((a, i) => a.rank = i);
  $("dbsize").textContent = A.length.toLocaleString("fr-FR") + " titres";
  const nA = A.filter(a => a.adult).length;
  adultCount = nA; updateAdultUI();
  UP = T.status.indexOf("NOT_YET_RELEASED");
  const nU = A.filter(a => a.status === UP).length;
  $("upcomingHint").textContent = `${nU.toLocaleString("fr-FR")} titres pas encore sortis, masqués par défaut.`;
  buildFilters(); apply();
  fetch("/chars.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(C => {
    let n = 0;
    C.forEach((cs, i) => { const a = A[i]; if (!a) return; a.chars = cs; n += cs.length; a.charHay = norm(cs.map(c => c[0] + " " + c[1]).join(" | ")); });
    $("chara").disabled = false; $("charaHint").textContent = `${n.toLocaleString("fr-FR")} personnages indexés (les 25 plus importants par animé).`;
    if (shown <= 50) render(true);
  }).catch(() => { $("charaHint").textContent = "Les personnages n'ont pas pu être chargés."; });
}

function counts(key, field) {
  const c = new Array(T[key].length).fill(0);
  for (const a of A) { const v = a[field]; if (Array.isArray(v)) v.forEach(i => c[i]++); else if (v >= 0) c[v]++; }
  return c;
}
function chipGroup(el, key, field, set, opts = {}) {
  const c = counts(key, field);
  const order = T[key].map((v, i) => i).filter(i => c[i] >= (opts.min || 1) && T[key][i] !== opts.skip);
  if (opts.alpha) order.sort((a, b) => tr(key, T[key][a]).localeCompare(tr(key, T[key][b]), "fr"));
  $(el).innerHTML = order.map(i => `<button class="chip" data-i="${i}" title="${c[i].toLocaleString("fr-FR")} titres">${esc(tr(key, T[key][i]))}</button>`).join("");
  $(el).addEventListener("click", e => {
    const b = e.target.closest(".chip"); if (!b) return; const i = +b.dataset.i;
    if (opts.tri) {
      const [inc, exc] = set;
      if (inc.has(i)) { inc.delete(i); exc.add(i); } else if (exc.has(i)) exc.delete(i); else inc.add(i);
    } else set.has(i) ? set.delete(i) : set.add(i);
    syncChips(); apply();
  });
}
function syncChips() {
  const mark = (el, inc, exc) => $(el).querySelectorAll(".chip").forEach(b => {
    const i = +b.dataset.i; b.classList.toggle("on", inc.has(i)); b.classList.toggle("ex", !!exc && exc.has(i));
    b.setAttribute("aria-pressed", inc.has(i) || (exc && exc.has(i)) ? "true" : "false");
  });
  mark("genre", S.genreIn, S.genreEx); mark("format", S.format); mark("status", S.status); mark("season", S.season);
  mark("source", S.source); mark("country", S.country);
  $("tag").innerHTML = [...S.tagIn].map(i => `<button class="chip on" data-i="${i}" data-k="in">${esc(T.tags[i])}</button>`).join("") +
    [...S.tagEx].map(i => `<button class="chip ex" data-i="${i}" data-k="ex">${esc(T.tags[i])}</button>`).join("");
  $("lang").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === S.lang));
}
function buildFilters() {
  chipGroup("genre", "genres", "genres", [S.genreIn, S.genreEx], { tri: true, alpha: true });
  chipGroup("format", "format", "format", S.format);
  chipGroup("status", "status", "status", S.status, { skip: "NOT_YET_RELEASED" });
  chipGroup("season", "season", "season", S.season);
  chipGroup("source", "source", "source", S.source, { min: 20 });
  chipGroup("country", "country", "country", S.country);
  let tc; $("chara").addEventListener("input", e => { clearTimeout(tc); tc = setTimeout(() => { S.chara = e.target.value; apply(); }, 160); });
  $("tagList").innerHTML = T.tags.map(t => `<option value="${esc(t)}"></option>`).join("");
  $("studioList").innerHTML = T.studios.slice(0, 1500).map(t => `<option value="${esc(t)}"></option>`).join("");
  $("tagInput").addEventListener("change", e => {
    const i = T.tags.findIndex(t => t.toLowerCase() === e.target.value.trim().toLowerCase());
    if (i >= 0) { S.tagIn.add(i); e.target.value = ""; syncChips(); apply(); }
  });
  $("tag").addEventListener("click", e => {
    const b = e.target.closest(".chip"); if (!b) return; const i = +b.dataset.i;
    if (b.dataset.k === "in") { S.tagIn.delete(i); S.tagEx.add(i); } else S.tagEx.delete(i);
    syncChips(); apply();
  });
  $("lang").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.lang = b.dataset.v; syncChips(); apply(); });
  let t; $("q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value; apply(); }, 140); });
  for (const k of ["yMin", "yMax", "eMin", "eMax", "dMin", "dMax"]) $(k).addEventListener("input", e => { S[k] = e.target.value === "" ? null : +e.target.value; apply(); });
  $("score").addEventListener("input", e => { S.score = +e.target.value; $("scoreVal").textContent = S.score ? "≥ " + S.score + " / 100" : "toutes"; apply(); });
  $("studio").addEventListener("input", e => { S.studio = norm(e.target.value); apply(); });
  $("sort").addEventListener("change", e => { S.sort = e.target.value; apply(); });
  $("adult").addEventListener("change", e => { S.adult = e.target.checked && adultAllowed(); e.target.checked = S.adult; apply(); });
  $("upcoming").addEventListener("change", e => { S.upcoming = e.target.checked; apply(); });
  document.querySelectorAll("[data-clear]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.clear;
    if (k === "genre") { S.genreIn.clear(); S.genreEx.clear(); } else if (k === "tag") { S.tagIn.clear(); S.tagEx.clear(); } else S[k].clear();
    syncChips(); apply();
  }));
  $("reset").addEventListener("click", resetAll);
  $("more").addEventListener("click", () => render(false));
  $("toggleFilters").addEventListener("click", () => { const o = $("filters").classList.toggle("open"); $("toggleFilters").setAttribute("aria-expanded", o); });
  $("active").addEventListener("click", e => { const b = e.target.closest(".chip"); if (b) { activeActions[+b.dataset.a](); syncChips(); apply(); } });
  syncChips();
}
function resetAll() {
  Object.assign(S, { col: "all", adult: false, upcoming: false, chara: "", q: "", lang: "FE", yMin: null, yMax: null, eMin: null, eMax: null, dMin: null, dMax: null, score: 0, studio: "" });
  ["genreIn", "genreEx", "tagIn", "tagEx", "format", "status", "season", "source", "country"].forEach(k => S[k].clear());
  ["q", "chara", "yMin", "yMax", "eMin", "eMax", "dMin", "dMax", "studio"].forEach(k => $(k).value = "");
  $("score").value = 0; $("scoreVal").textContent = "toutes"; $("adult").checked = false; $("upcoming").checked = false; $("col").value = "all"; syncChips(); apply();
}

function apply() {
  if (!T) return;
  const qs = norm(S.q).split(" ").filter(Boolean);
  const cq = norm(S.chara).split(" ").filter(Boolean);
  const inRange = (v, lo, hi) => (lo == null || (v && v >= lo)) && (hi == null || (v && v <= hi));
  view = A.filter(a => {
    if (a.adult !== S.adult) return false;
    if (S.col !== "all") { if (!inCol(a.id, S.col)) return false; }
    else {
      if (a.status === UP && !S.upcoming) return false;
      if (S.lang === "FE" && !a.lang) return false;
      if (S.lang === "F" && !a.lang.includes("F")) return false;
      if (S.lang === "E" && !a.lang.includes("E")) return false;
      if (S.lang === "both" && a.lang !== "FE") return false;
    }
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
  const cmp = { pop: (a, b) => a.rank - b.rank, score: (a, b) => b.score - a.score || a.rank - b.rank,
    new: (a, b) => b.year - a.year || a.rank - b.rank, old: (a, b) => (a.year || 9999) - (b.year || 9999) || a.rank - b.rank,
    az: (a, b) => title(a).localeCompare(title(b), "fr"), eps: (a, b) => b.eps - a.eps || a.rank - b.rank,
    mine: (a, b) => (ent(b.id).r || 0) - (ent(a.id).r || 0) || a.rank - b.rank, recent: (a, b) => (ent(b.id).t || 0) - (ent(a.id).t || 0) || a.rank - b.rank }[S.sort];
  view.sort(cmp);
  $("count").innerHTML = `<b>${view.length.toLocaleString("fr-FR")}</b> ${view.length > 1 ? "titres" : "titre"}`;
  renderActive(); render(true);
}
let activeActions = [];
function renderActive() {
  const L = []; activeActions = [];
  const add = (label, fn) => { L.push(`<button class="chip" data-a="${activeActions.length}">${esc(label)}</button>`); activeActions.push(fn); };
  if (S.col !== "all") add(colLabel(S.col), () => { S.col = "all"; $("col").value = "all"; });
  if (S.q) add(`« ${S.q} »`, () => { S.q = ""; $("q").value = ""; });
  if (S.chara) add(`Personnage : ${S.chara}`, () => { S.chara = ""; $("chara").value = ""; });
  S.genreIn.forEach(i => add(tr("genres", T.genres[i]), () => S.genreIn.delete(i)));
  S.genreEx.forEach(i => add("sans " + tr("genres", T.genres[i]), () => S.genreEx.delete(i)));
  S.tagIn.forEach(i => add(T.tags[i], () => S.tagIn.delete(i)));
  S.tagEx.forEach(i => add("sans " + T.tags[i], () => S.tagEx.delete(i)));
  for (const k of ["format", "status", "season", "source", "country"]) S[k].forEach(i => add(tr(k, T[k][i]), () => S[k].delete(i)));
  if (S.yMin != null || S.yMax != null) add(`Années ${S.yMin ?? "…"}–${S.yMax ?? "…"}`, () => { S.yMin = S.yMax = null; $("yMin").value = $("yMax").value = ""; });
  if (S.eMin != null || S.eMax != null) add(`Épisodes ${S.eMin ?? "…"}–${S.eMax ?? "…"}`, () => { S.eMin = S.eMax = null; $("eMin").value = $("eMax").value = ""; });
  if (S.dMin != null || S.dMax != null) add(`Durée ${S.dMin ?? "…"}–${S.dMax ?? "…"} min`, () => { S.dMin = S.dMax = null; $("dMin").value = $("dMax").value = ""; });
  if (S.score) add(`Note ≥ ${S.score}`, () => { S.score = 0; $("score").value = 0; $("scoreVal").textContent = "toutes"; });
  if (S.studio) add(`Studio : ${$("studio").value}`, () => { S.studio = ""; $("studio").value = ""; });
  $("active").innerHTML = L.join("");
}
function card(a) {
  const main = a.english || a.romaji;
  const alts = [...new Set([a.romaji, a.native].filter(t => t && t.toLowerCase() !== main.toLowerCase()))].join(" · ");
  const meta = [
    a.format >= 0 ? `<b>${esc(tr("format", T.format[a.format]))}</b>` : "",
    a.year ? `${a.season >= 0 ? tr("season", T.season[a.season]) + " " : ""}${a.year}` : "",
    a.eps ? `${a.eps} ép.` : "", a.dur ? `${a.dur} min` : "",
    a.status >= 0 ? tr("status", T.status[a.status]) : "",
    a.studios.length ? a.studios.map(i => esc(T.studios[i])).join(", ") : "",
    a.source >= 0 ? "d'après : " + tr("source", T.source[a.source]) : ""
  ].filter(Boolean).map(x => `<span>${x}</span>`).join("");
  const langs = a.lang ? [...a.lang].map(l => `<span class="lg ${l}">${l === "F" ? "FR" : "EN"}</span>`).join("") : `<span class="lg N">non dispo</span>`;
  const adultTag = a.adult ? `<span class="lg A">18+</span>` : "";
  const genres = a.genres.map(i => `<span class="g">${esc(tr("genres", T.genres[i]))}</span>`).join("");
  const plats = a.plats.map(([i, u]) => `<a class="p" href="${esc(u)}" target="_blank" rel="noopener">${esc(T.platforms[i])}</a>`).join("");
  const tags = a.tags.map(i => esc(T.tags[i])).join(", ");
  const ROLE = { M: "principal", S: "secondaire", B: "figurant" };
  // AniList renvoie une page 404 aux visiteurs non connectés pour les titres adultes : on préfère MyAnimeList pour ceux-là.
  const link = a.adult && a.mal ? `https://myanimelist.net/anime/${a.mal}` : `https://anilist.co/anime/${a.id}`;
  const chars = a.chars.length ? `<div class="chars">${a.chars.map(c => `<span class="ch ${c[2]}" title="${esc((c[1] ? c[1] + " · " : "") + ROLE[c[2]])}">${esc(c[0] || c[1])}</span>`).join("")}</div>` : "";
  const cover = a.cov >= 0
    ? `<span class="cv" role="img" aria-label="Affiche de ${esc(main)}" style="background-image:url(/covers/s${Math.floor(a.cov / 200)}.webp);background-position:${(a.cov % 10) / 9 * 100}% ${(Math.floor((a.cov % 200) / 10)) / 19 * 100}%"></span>`
    : `<span class="cv none" aria-hidden="true">${esc((main[0] || "?").toUpperCase())}</span>`;
  return `<article class="card">
    <a href="${link}" target="_blank" rel="noopener" tabindex="-1">${cover}</a>
    <div class="body">
    <h3><a href="${link}" target="_blank" rel="noopener">${esc(main)}</a></h3>
    <div class="side"><div class="score">${a.score ? a.score + "<small>/100</small>" : '<small>sans note</small>'}</div><div class="langs">${adultTag}${langs}</div></div>
    ${alts ? `<div class="alt">${esc(alts)}</div>` : ""}
    <div class="meta">${meta}</div>
    <div class="row2">${genres}${genres && plats ? '<span class="sep"></span>' : ""}${plats}</div>
    <div class="minebox" data-id="${a.id}" style="display:contents">${mineHTML(a.id)}</div>
    ${a.desc || tags || chars ? `<details><summary>Synopsis, personnages et thèmes</summary>${a.desc ? `<p>${esc(a.desc)}</p>` : ""}${chars ? `<p class="hint">Personnages (principaux en violet) :</p>${chars}` : ""}${tags ? `<p class="hint">Thèmes : ${tags}</p>` : ""}
      <div class="links"><a href="https://anilist.co/anime/${a.id}" target="_blank" rel="noopener">${a.adult ? "Fiche AniList (compte avec contenu adulte activé requis)" : "Fiche AniList"}</a>${a.mal ? `<a href="https://myanimelist.net/anime/${a.mal}" target="_blank" rel="noopener">Fiche MyAnimeList</a>` : ""}</div></details>` : ""}
    </div>
  </article>`;
}
function render(reset) {
  if (reset) { shown = 0; $("list").innerHTML = ""; }
  if (!view.length) {
    $("list").innerHTML = S.col !== "all"
      ? '<div class="empty">Aucun titre ici pour l\'instant. Ajoute des titres à ta collection depuis le catalogue.</div>'
      : '<div class="empty">Aucun titre ne correspond. Retirez un filtre ou élargissez la disponibilité à « Toutes ».</div>';
    $("more").hidden = true; return;
  }
  const next = view.slice(shown, shown + 50); shown += next.length;
  $("list").insertAdjacentHTML("beforeend", next.map(card).join(""));
  $("more").hidden = shown >= view.length;
  $("more").textContent = `Afficher 50 de plus (${(view.length - shown).toLocaleString("fr-FR")} restants)`;
}

// ===== Ma collection : données privées de chaque utilisateur connecté (Supabase + RLS) =====
const STATUSES = { watched: "Regardé", watching: "En cours", plan: "Je veux regarder", dropped: "Abandonné" };
const ME = { user: null, entries: new Map(), lists: {}, ready: false, loading: false, open: null, birthYear: undefined };

// ===== Contenu adulte : réservé aux comptes majeurs (d'après l'année de naissance) =====
// Avec la seule année, on ne connaît pas la date d'anniversaire : par prudence, on considère la personne
// majeure à partir de l'année de ses 19 ans (elle a alors 18 ans révolus quel que soit son jour de naissance).
let adultCount = 0;
const adultAllowed = () => !!(ME.user && ME.birthYear && new Date().getFullYear() - ME.birthYear > 18);
function updateAdultUI() {
  const ok = adultAllowed(), n = adultCount.toLocaleString("fr-FR"), act = $("adultAction");
  $("adult").disabled = !ok;
  if (!ok && S.adult) { S.adult = false; $("adult").checked = false; if (T) apply(); }
  act.hidden = true;
  if (ok) $("adultHint").textContent = `${n} titres réservés aux adultes. Case cochée, seuls ces titres s'affichent.`;
  else if (!supabase) $("adultHint").textContent = `${n} titres réservés aux adultes, accessibles uniquement avec un compte majeur.`;
  else if (!ME.user) { $("adultHint").textContent = `${n} titres réservés aux adultes : connecte-toi avec un compte majeur pour y accéder.`; act.textContent = "Se connecter"; act.hidden = false; }
  else if (ME.birthYear === undefined) $("adultHint").textContent = "Vérification de ton âge…";
  else if (ME.birthYear === null) { $("adultHint").textContent = "Réservé aux majeurs : indique ton année de naissance pour y accéder."; act.textContent = "Indiquer mon année de naissance"; act.hidden = false; }
  else $("adultHint").textContent = "Contenu réservé aux personnes majeures.";
}
async function onBirthYear(y) {
  await store.saveBirthYear(ME.user.id, y);
  ME.birthYear = y; updateAdultUI();
  toast(adultAllowed() ? "Année enregistrée : le contenu 18+ est accessible." : "Année enregistrée.");
}
const ent = id => ME.entries.get(id) || {};
const isEmpty = e => !e.f && !e.r && !e.c && !e.s && !Object.values(e.l || {}).some(Boolean);
function inCol(id, col) {
  const e = ent(id);
  if (col === "any") return !isEmpty(e);
  if (col === "fav") return !!e.f;
  if (col === "rated") return !!e.r;
  if (col.startsWith("s:")) return e.s === col.slice(2);
  if (col.startsWith("l:")) return !!(e.l && e.l[col.slice(2)]);
  return true;
}
function colLabel(col) {
  if (col === "any") return "Toute ma collection"; if (col === "fav") return "Coups de cœur"; if (col === "rated") return "Notés";
  if (col.startsWith("s:")) return STATUSES[col.slice(2)];
  if (col.startsWith("l:")) return "Liste : " + ((ME.lists[col.slice(2)] || {}).n || "?");
  return "Tout le catalogue";
}
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
const sortedLists = () => Object.entries(ME.lists).filter(([, v]) => v && v.n).sort((a, b) => a[1].t - b[1].t);

function mineHTML(id) {
  if (!supabase) return "";
  const e = ME.ready ? ent(id) : {}, open = ME.ready && ME.open === id;
  const stars = [1, 2, 3, 4, 5].map(n => `<button type="button" data-act="star" data-v="${n}" class="${(e.r || 0) >= n ? "on" : ""}" aria-label="${n} étoile${n > 1 ? "s" : ""}">★</button>`).join("");
  const nl = Object.values(e.l || {}).filter(Boolean).length;
  let h = `<div class="mine">
    <button type="button" class="ib fav ${e.f ? "on" : ""}" data-act="fav" aria-pressed="${!!e.f}" title="Coup de cœur">${e.f ? "♥" : "♡"}</button>
    <select data-act="status" class="${e.s ? "set" : ""}" aria-label="Statut"><option value="">${e.s ? "Aucun statut" : "Ajouter à…"}</option>${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}"${e.s === k ? " selected" : ""}>${v}</option>`).join("")}</select>
    <span class="stars" role="group" aria-label="Ma note">${stars}</span>
    <button type="button" class="ib ${e.c || nl ? "has" : ""}" data-act="edit" aria-expanded="${open}">${e.c ? "Mon avis" : "Avis"}${nl ? ` · ${nl} liste${nl > 1 ? "s" : ""}` : " et listes"}</button>
  </div>`;
  if (e.c && !open) h += `<p class="mycomment">« ${esc(e.c)} »</p>`;
  if (open) {
    const L = sortedLists();
    h += `<form class="editor" data-act="save">
      <label for="cm-${id}" class="hint">Commentaire rapide (280 caractères max)</label>
      <textarea id="cm-${id}" name="c" maxlength="280" placeholder="Ce que tu en as pensé…">${esc(e.c || "")}</textarea>
      ${L.length ? `<div class="hint">Mes listes</div><div class="lists">${L.map(([k, v]) => `<label><input type="checkbox" name="l" value="${esc(k)}"${e.l && e.l[k] ? " checked" : ""}> ${esc(v.n)}</label>`).join("")}</div>` : `<div class="hint">Crée tes propres listes dans le panneau « Ma collection ».</div>`}
      <div class="row"><button type="button" class="ib" data-act="clear">Retirer de ma collection</button><span style="display:flex;gap:8px"><button type="button" class="ib" data-act="close">Annuler</button><button type="submit" class="btn primary">Enregistrer</button></span></div>
    </form>`;
  }
  return h;
}
function refreshCard(id) { const box = document.querySelector(`.minebox[data-id="${id}"]`); if (box) box.innerHTML = mineHTML(id); }
function refreshAllCards() { document.querySelectorAll(".minebox").forEach(b => b.innerHTML = mineHTML(+b.dataset.id)); }

// Les écritures d'un même titre sont sérialisées pour respecter l'ordre des clics.
const queues = {};
function enqueue(key, fn) { const p = (queues[key] || Promise.resolve()).then(fn); queues[key] = p.catch(() => {}); return p; }
function onWriteError(err) {
  console.error(err);
  if (err && /list_limit_reached/.test(err.message || "")) toast("50 listes maximum.");
  else if (err && err.code === "23505") toast("Tu as déjà une liste de ce nom.");
  else if (err && (err.status === 401 || /JWT/i.test(err.message || ""))) { toast("Ta session a expiré : reconnecte-toi."); openAuth(); }
  else toast("L'enregistrement a échoué. Réessaie dans un instant.");
  reloadCollection(); // on resynchronise avec le serveur
}

function localEntry(id) {
  if (!ME.entries.has(id)) ME.entries.set(id, { f: false, r: 0, c: "", s: "", t: 0, l: {} });
  return ME.entries.get(id);
}
function saveEntry(id, patch) {
  if (!ME.user) return openAuth();
  const e = localEntry(id);
  Object.assign(e, patch, { t: Date.now() });
  const snap = { f: e.f, r: e.r, c: e.c, s: e.s };
  if (isEmpty(e)) ME.entries.delete(id);
  refreshCard(id); updateColCounts();
  const uid = ME.user.id;
  return enqueue(id, () => store.saveEntry(uid, id, snap)).catch(onWriteError);
}
function saveListMembership(id, changes) {
  const e = localEntry(id), diff = {};
  for (const [k, v] of Object.entries(changes)) if (!!(e.l[k]) !== v) { diff[k] = v; if (v) e.l[k] = true; else delete e.l[k]; }
  if (!Object.keys(diff).length) { if (isEmpty(e)) ME.entries.delete(id); return; }
  e.t = Date.now();
  if (isEmpty(e)) ME.entries.delete(id);
  refreshCard(id); updateColCounts();
  const uid = ME.user.id;
  return enqueue(id, () => store.saveListMembership(uid, id, diff)).catch(onWriteError);
}
function clearAnime(id) {
  ME.entries.delete(id); refreshCard(id); updateColCounts();
  return enqueue(id, () => store.clearAnime(id)).catch(onWriteError);
}

function updateColCounts() {
  if (!ME.ready) return;
  const ids = [...ME.entries.entries()].filter(([, v]) => !isEmpty(v)).map(([k]) => k);
  const count = col => ids.filter(id => inCol(id, col)).length;
  const opt = (v, label) => `<option value="${esc(v)}"${S.col === v ? " selected" : ""}>${esc(label)} (${count(v)})</option>`;
  const L = sortedLists();
  $("col").innerHTML = `<option value="all">Tout le catalogue</option>` + opt("any", "Toute ma collection") + opt("fav", "♥ Coups de cœur") + opt("rated", "★ Notés")
    + `<optgroup label="Statut">${Object.entries(STATUSES).map(([k, v]) => opt("s:" + k, v)).join("")}</optgroup>`
    + (L.length ? `<optgroup label="Mes listes">${L.map(([k, v]) => opt("l:" + k, v.n)).join("")}</optgroup>` : "");
  if (S.col !== "all" && !$("col").value) { S.col = "all"; $("col").value = "all"; }
}
function renderListAdmin() {
  const L = sortedLists();
  $("myLists").innerHTML = L.length ? L.map(([k, v]) => `<div><span>${esc(v.n)}</span><button type="button" data-del="${esc(k)}" aria-label="Supprimer la liste ${esc(v.n)}">supprimer</button></div>`).join("") : `<div class="hint">Aucune liste personnelle pour l'instant.</div>`;
  updateColCounts();
}

$("list").addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el || el.tagName === "SELECT" || el.tagName === "FORM") return;
  const box = el.closest(".minebox"); if (!box) return;
  if (!ME.user) { openAuth(); return; }
  if (!ME.ready) { toast("Ta collection est en cours de chargement…"); return; }
  const id = +box.dataset.id, cur = ent(id);
  const act = el.dataset.act;
  if (act === "fav") { saveEntry(id, { f: !cur.f }); toast(cur.f ? "Retiré des coups de cœur" : "Ajouté aux coups de cœur"); }
  else if (act === "star") { const v = +el.dataset.v; saveEntry(id, { r: cur.r === v ? 0 : v }); }
  else if (act === "edit") { ME.open = ME.open === id ? null : id; refreshAllCards(); const t = document.getElementById("cm-" + id); if (t) t.focus(); }
  else if (act === "close") { ME.open = null; refreshCard(id); }
  else if (act === "clear") { ME.open = null; clearAnime(id); toast("Retiré de ta collection"); }
});
$("list").addEventListener("change", e => {
  const el = e.target; if (el.dataset.act !== "status") return;
  const id = +el.closest(".minebox").dataset.id;
  if (!ME.user || !ME.ready) { el.value = ""; if (!ME.user) openAuth(); return; }
  saveEntry(id, { s: el.value });
  if (el.value) toast("Ajouté à « " + STATUSES[el.value] + " »");
});
$("list").addEventListener("submit", e => {
  const f = e.target; if (f.dataset.act !== "save") return; e.preventDefault();
  if (!ME.user) return openAuth();
  const id = +f.closest(".minebox").dataset.id, l = {};
  f.querySelectorAll('input[name="l"]').forEach(c => l[c.value] = c.checked);
  const c = f.elements.c.value.trim().slice(0, 280);
  ME.open = null;
  // la fiche d'abord (pour l'ordre local), puis les listes
  if (c !== (ent(id).c || "")) saveEntry(id, { c }); else refreshCard(id);
  saveListMembership(id, l);
  toast("Enregistré");
});
$("col").addEventListener("change", e => { S.col = e.target.value; apply(); });
$("newListForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!ME.user) return openAuth();
  const n = $("newList").value.trim().slice(0, 40); if (!n) return;
  if (Object.values(ME.lists).some(v => v && v.n && v.n.toLowerCase() === n.toLowerCase())) { toast("Tu as déjà une liste de ce nom."); return; }
  if (sortedLists().length >= 50) { toast("50 listes maximum."); return; }
  const btn = e.target.querySelector("button"); btn.disabled = true;
  try {
    const row = await store.createList(ME.user.id, n);
    ME.lists[row.id] = { n: row.name, t: Date.parse(row.created_at) };
    $("newList").value = ""; renderListAdmin(); refreshAllCards(); toast("Liste « " + n + " » créée");
  } catch (err) { onWriteError(err); }
  finally { btn.disabled = false; }
});
$("myLists").addEventListener("click", async e => {
  const b = e.target.closest("[data-del]"); if (!b) return; const k = b.dataset.del;
  if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "confirmer ?"; setTimeout(() => { b.dataset.confirm = ""; b.textContent = "supprimer"; }, 3000); return; }
  delete ME.lists[k];
  for (const [id, en] of ME.entries) { if (en.l && en.l[k]) { delete en.l[k]; if (isEmpty(en)) ME.entries.delete(id); } }
  if (S.col === "l:" + k) S.col = "all";
  renderListAdmin(); apply(); toast("Liste supprimée");
  try { await store.deleteList(k); } catch (err) { onWriteError(err); }
});

// ===== Session =====
function setSignedOutUI() {
  $("me").hidden = true; $("signOut").hidden = true; $("signIn").hidden = !supabase;
  $("col").disabled = true; $("col").innerHTML = `<option value="all">Tout le catalogue</option>`;
  $("listAdmin").hidden = true;
  $("colSignIn").hidden = !supabase;
  $("colHint").textContent = supabase
    ? "Connecte-toi pour garder tes coups de cœur, notes, statuts et listes. Ta collection est privée."
    : "Collection indisponible : le site n'est pas relié à sa base de données (variables VITE_SUPABASE_* manquantes).";
}
async function reloadCollection() {
  if (!ME.user || ME.loading) return;
  const uid = ME.user.id;
  ME.loading = true;
  try {
    const [data, birthYear] = await Promise.all([store.loadCollection(), store.loadBirthYear()]);
    if (!ME.user || ME.user.id !== uid) return; // déconnecté entre-temps
    const askBirth = ME.birthYear === undefined && birthYear === null;
    ME.birthYear = birthYear; updateAdultUI();
    if (askBirth && !$("auth").open) openAuth("birth"); // ex. première connexion avec Google
    ME.entries = data.entries; ME.lists = data.lists; ME.ready = true;
    $("col").disabled = false; $("listAdmin").hidden = false;
    $("colHint").textContent = "Tes coups de cœur, notes et listes sont privés : personne d'autre ne les voit.";
    renderListAdmin();
    if (S.col !== "all" || S.sort === "mine" || S.sort === "recent") apply(); else refreshAllCards();
  } catch (err) {
    console.error(err);
    $("colHint").textContent = "Ta collection n'a pas pu être chargée. Recharge la page plus tard.";
  } finally { ME.loading = false; }
}
function onSession(session) {
  const user = session ? session.user : null;
  if (user && ME.user && ME.user.id === user.id) { ME.user = user; return; } // simple rafraîchissement de jeton
  ME.user = user; ME.ready = false; ME.entries = new Map(); ME.lists = {}; ME.open = null; ME.birthYear = undefined;
  updateAdultUI();
  if (!user) {
    setSignedOutUI();
    if (S.col !== "all") { S.col = "all"; apply(); } else refreshAllCards();
    return;
  }
  $("me").textContent = displayName(user); $("me").title = user.email || ""; $("me").hidden = false;
  $("signOut").hidden = false; $("signIn").hidden = true; $("colSignIn").hidden = true;
  $("colHint").textContent = "Chargement de ta collection…";
  refreshAllCards();
  reloadCollection();
}

setSignedOutUI();
if (supabase) {
  initAuth({ onBirthYear });
  $("adultAction").addEventListener("click", () => openAuth(ME.user ? "birth" : "main"));
  $("signIn").addEventListener("click", () => openAuth());
  $("colSignIn").addEventListener("click", () => openAuth());
  $("signOut").addEventListener("click", async () => { await signOut(); toast("Déconnecté"); });
  $("deleteAccount").addEventListener("click", async () => {
    if (!ME.user) return;
    if (!confirm("Supprimer définitivement ton compte ?\n\nTon e-mail, tes coups de cœur, notes, commentaires, statuts et listes seront effacés. Cette action est irréversible.")) return;
    const { error } = await supabase.rpc("delete_my_account");
    if (error) { console.error(error); toast("La suppression a échoué. Réessaie dans un instant."); return; }
    await supabase.auth.signOut({ scope: "local" });
    toast("Ton compte et toutes tes données ont été supprimés.");
  });
  // Ne pas appeler Supabase directement dans ce rappel (verrou interne) : on diffère.
  supabase.auth.onAuthStateChange((event, session) => { setTimeout(() => onSession(session), 0); });
  // Les erreurs de connexion OAuth reviennent dans l'URL.
  const qp = new URLSearchParams(location.search + "&" + location.hash.slice(1));
  if (qp.get("error_description")) {
    toast("Connexion impossible : " + qp.get("error_description"));
    history.replaceState(null, "", location.pathname);
  }
}
