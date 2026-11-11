// Application : en-tête, navigation, routeur (#/…), session, recherche globale.
import "./style.css";
import { supabase } from "./supabase.js";
import { loadCatalogue, ready, A, byId, UP, norm, titleOf, coverStyle, tr, T } from "./data.js";
import { loadCharacters, loadAllCharacters, chReady, CH, visibleApps, mainAnime, imgUrl } from "./chars.js";
import { ME, onChange, initSession, updateProfile } from "./state.js";
import { initAuth, openAuth, isAuthOpen, signOut } from "./auth.js";
import { displayName, avatarUrl, avatarHTML, isAdultYear } from "./profile.js";
import { $, esc, fmt, refreshCards, closeAddMenu } from "./ui.js";
import { toast } from "./toast.js";
import * as home from "./views/home.js";
import * as catalogue from "./views/catalogue.js";
import * as collection from "./views/collection.js";
import * as lists from "./views/lists.js";
import * as account from "./views/account.js";
import * as characters from "./views/characters.js";
import * as calendar from "./views/calendar.js";
import { openDetail, closeDetail, isDetailOpen } from "./views/detail.js";
import { openCharacter, closeCharacter, isCharacterOpen } from "./views/character.js";
const isModalOpen = () => isDetailOpen() || isCharacterOpen();
const closeModals = () => { closeDetail(); closeCharacter(); };

const VIEWS = { "": home, catalogue, personnages: characters, calendrier: calendar, collection, listes: lists, compte: account };
const view = $("view");
let base = null;        // dernière route « page » (hors fiche)
let depth = 0;          // nombre de fiches ouvertes depuis cette page (pour revenir avec « Retour »)

function parse() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, query] = h.split("?");
  return { parts: path.split("/").filter(Boolean), params: new URLSearchParams(query || "") };
}
function setNav(key) {
  document.querySelectorAll("[data-nav]").forEach(a => { const on = a.dataset.nav === key; a.classList.toggle("on", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); });
}
function renderPage(parts, params) {
  const key = parts[0] || "";
  const v = VIEWS[key] || home;
  closeAddMenu(); catalogue.closeDrawer(); characters.closeCharDrawer();
  if (key !== "catalogue" && catalogue.S.q) { catalogue.S.q = ""; $("q").value = ""; }
  setNav(VIEWS[key] ? key || "home" : "home");
  v.render(view, key === "catalogue" || key === "personnages" ? params : parts[1]);
  document.title = { "": "Animéthèque", catalogue: "Catalogue · Animéthèque", collection: "Ma collection · Animéthèque", listes: "Mes listes · Animéthèque", personnages: "Personnages · Animéthèque", calendrier: "Calendrier · Animéthèque", compte: "Mon compte · Animéthèque" }[key] || "Animéthèque";
}
function route() {
  if (!ready.catalogue) return;
  const { parts, params } = parse();
  if (parts[0] === "anime" || parts[0] === "personnage") {
    if (base === null) { base = parts[0] === "personnage" ? "#/personnages" : "#/"; renderPage(base === "#/" ? [] : ["personnages"], new URLSearchParams()); depth = 0; }
    closeAddMenu(); characters.closeCharDrawer(); catalogue.closeDrawer();
    const id = +parts[1];
    if (parts[0] === "anime") {
      closeCharacter();
      if (openDetail(id, closeFromDetail)) depth++; else history.replaceState(null, "", base);
    } else {
      closeDetail(); depth++;
      openCharacter(id, closeFromDetail).then(ok => { if (!ok) { depth--; history.replaceState(null, "", base); } });
    }
    return;
  }
  const key = location.hash || "#/";
  const fromDetail = isModalOpen();
  closeModals();
  if (fromDetail && key === base) { depth = 0; return; }   // retour depuis une fiche : on garde la page et sa position
  depth = 0; base = key;
  renderPage(parts, params);
  if (!fromDetail) scrollTo(0, 0);
}
function closeFromDetail() {
  if (depth > 0 && history.length > depth) history.go(-depth);
  else { closeModals(); history.replaceState(null, "", base || "#/"); depth = 0; }
}

// ---------- En-tête ----------
async function renderMe() {
  const u = ME.user;
  $("signIn").hidden = !!u || !supabase;
  const me = $("me"); me.hidden = !u;
  if (!u) return;
  const name = displayName(u, ME.profile);
  me.innerHTML = avatarHTML(null, name) + `<span>${esc(name)}</span>`;
  const url = await avatarUrl(u, ME.profile);
  if (url && ME.user && ME.user.id === u.id) me.innerHTML = avatarHTML(url, name) + `<span>${esc(name)}</span>`;
  $("bnAcc").innerHTML = ME.user ? avatarHTML(url, name, "bn-av") + "<span>Compte</span>" : `<span class="bn-i">◉</span><span>Compte</span>`;
}

// Recherche globale : suggestions (animés + personnages) ; Entrée → catalogue. Sur le catalogue, filtre directement.
let qt, sugIdx = -1;
const onCat = () => (location.hash || "#/").startsWith("#/catalogue") && !isModalOpen();
const sugBox = () => { let b = $("qsug"); if (!b) { b = document.createElement("div"); b.id = "qsug"; b.className = "qsug"; b.setAttribute("role", "listbox"); $("q").parentElement.appendChild(b); } return b; };
const hideSug = () => { const b = $("qsug"); if (b) b.hidden = true; sugIdx = -1; };
function goCatalogue(q) { catalogue.S.q = q; hideSug(); if (onCat()) catalogue.refresh(); else location.hash = "#/catalogue"; }
function showSug(q) {
  const words = norm(q).split(" ").filter(Boolean), b = sugBox();
  if (!words.length) { hideSug(); return; }
  const ok = !!(ME.profile && isAdultYear(ME.profile.birth_year));
  const hits = [], qn = words.join(" ");
  for (const a of A) { if (a.adult && !ok) continue; if (words.every(w => a.hay.includes(w))) hits.push(a); }
  // titre qui commence par la recherche > titre qui la contient > trouvé par un autre nom ; puis popularité
  const score = a => { const t = norm(titleOf(a)), r = norm(a.romaji || ""); return t.startsWith(qn) || r.startsWith(qn) ? 0 : t.includes(qn) || r.includes(qn) ? 1 : 2; };
  const an = hits.slice(0, 400).map(a => [score(a), a]).sort((x, y) => x[0] - y[0] || x[1].rank - y[1].rank).slice(0, 6).map(x => x[1]), total = { n: hits.length };
  const ch = chReady.loaded ? CH.filter(c => words.every(w => c.hay.includes(w)) && visibleApps(c, ok).length).slice(0, 4) : [];
  b.innerHTML = (an.length ? `<div class="qs-h">Animés</div>` + an.map(a => `<a role="option" href="#/anime/${a.id}" class="qs-it"><span class="cv mini" style="${coverStyle(a)}"></span><span><b>${esc(titleOf(a))}</b><small>${[a.year, a.format >= 0 ? tr("format", T.format[a.format]) : ""].filter(Boolean).join(" · ")}</small></span></a>`).join("") : "")
    + (ch.length ? `<div class="qs-h">Personnages</div>` + ch.map(c => `<a role="option" href="#/personnage/${c.id}" class="qs-it">${c.img ? `<img class="qs-face" src="${esc(imgUrl(c, "medium"))}" alt="" referrerpolicy="no-referrer">` : `<span class="qs-face cc-none">${esc((c.name || "?")[0])}</span>`}<span><b>${esc(c.name)}</b><small>${esc((mainAnime(c, ok) && titleOf(mainAnime(c, ok))) || "")}</small></span></a>`).join("") : "")
    + `<a role="option" href="#/catalogue" class="qs-all" data-all>${total.n ? `Voir les ${fmt(total.n)} animé${total.n > 1 ? "s" : ""} correspondant${total.n > 1 ? "s" : ""}` : "Aucun animé trouvé : chercher dans le catalogue"} <kbd>↵</kbd></a>`
    + (chReady.loaded ? `<a role="option" href="#/personnages?q=${encodeURIComponent(q)}" class="qs-all">Chercher « ${esc(q)} » dans les personnages</a>` : "");
  b.hidden = false; sugIdx = -1;
}
$("q").addEventListener("input", e => {
  clearTimeout(qt);
  const q = e.target.value;
  qt = setTimeout(() => {
    if (onCat()) { hideSug(); catalogue.S.q = q; catalogue.refresh(); return; }
    loadCharacters().then(() => { if ($("q").value === q && document.activeElement === $("q")) showSug(q); }).catch(() => {});
    showSug(q);
  }, 120);
});
$("q").addEventListener("keydown", e => {
  const b = $("qsug"), items = b && !b.hidden ? [...b.querySelectorAll("a")] : [];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!items.length) return; e.preventDefault();
    sugIdx = (sugIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((x, i) => x.classList.toggle("on", i === sugIdx));
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (sugIdx >= 0 && items[sugIdx] && !items[sugIdx].hasAttribute("data-all")) { location.hash = items[sugIdx].getAttribute("href"); hideSug(); $("q").blur(); }
    else goCatalogue($("q").value);
  } else if (e.key === "Escape") hideSug();
});
$("q").addEventListener("blur", () => setTimeout(hideSug, 180));
document.addEventListener("click", e => {
  const a = e.target.closest("#qsug a"); if (!a) return;
  if (a.hasAttribute("data-all")) { e.preventDefault(); goCatalogue($("q").value); }
  else { const q = $("q"); hideSug(); if (!a.getAttribute("href").startsWith("#/personnages")) { q.value = ""; } }
});
addEventListener("keydown", e => {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $("q").focus(); }
});

document.addEventListener("click", e => {
  if (e.target.closest("[data-need-auth]")) openAuth();
  const rnd = e.target.closest("[data-random]");
  if (rnd) { const a = pickRandom(rnd.dataset.random); if (a) location.hash = "#/anime/" + a.id; }
  const g = e.target.closest("[data-goto]");
  if (g) setTimeout(() => { const t = document.getElementById(g.dataset.goto); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); }, 350);
});
$("signIn").addEventListener("click", () => openAuth());

/**
 * « Je ne sais pas quoi regarder » : un titre de ta liste « à voir » si elle n'est pas vide,
 * sinon un titre populaire et bien noté, disponible en FR/EN, pas encore dans ta collection.
 */
function pickRandom(mode) {
  const plan = ME.ready ? [...ME.entries.entries()].filter(([, x]) => x.s === "plan").map(([id]) => byId.get(id)).filter(a => a && !a.adult) : [];
  let pool = plan.length && (mode === "plan" || Math.random() < 0.6) ? plan
    : A.filter(a => !a.adult && a.lang && a.score >= 75 && a.rank < 3000 && a.status !== UP && !(ME.entries.get(a.id) && ME.entries.get(a.id).s));
  if (!pool.length) pool = A.slice(0, 500).filter(a => !a.adult);
  const a = pool[Math.floor(Math.random() * pool.length)];
  if (a) toast(plan.includes(a) ? "🎲 Tiré au sort dans ta liste « à voir »" : "🎲 Une suggestion au hasard parmi les titres bien notés");
  return a;
}

// ---------- Session ----------
onChange((what, id) => {
  if (what === "need-auth") { openAuth(); return; }
  if (what === "entry") { refreshCards(id); return; }
  if (what === "session" || what === "profile" || what === "collection") renderMe();
  if (what === "collection" || what === "session") document.querySelectorAll(".pc").forEach(el => refreshCards(+el.dataset.id));
  if (what === "profile-loaded") {
    const p = ME.profile;
    if (p && (!p.username || !p.birth_year) && !isAuthOpen()) openAuth("profile", { needUsername: !p.username, needBirth: !p.birth_year });
  }
  if (what === "session" && !ME.user && ["#/collection", "#/listes", "#/compte"].some(k => (location.hash || "").startsWith(k))) renderPage(parse().parts, parse().params);
});

if (supabase) initAuth({ onCompleteProfile: async patch => { await updateProfile(patch); toast("Profil enregistré"); } });
else $("signIn").hidden = true;

// ---------- Démarrage ----------
view.innerHTML = `<div class="page"><div class="boot"><div class="spinner" aria-hidden="true"></div><p>Chargement du catalogue…</p></div></div>`;
// Lien direct vers les personnages : on télécharge leurs fichiers en même temps que le catalogue.
// (seulement le petit fichier : le gros complément attend l'affichage, pour ne pas ralentir le catalogue)
if (/^#\/personnage/.test(location.hash)) loadCharacters().catch(() => {});
loadCatalogue().then(() => {
  $("dbsize").textContent = fmt(A.length) + " animés";
  addEventListener("hashchange", route);
  route();
  initSession();
}).catch(() => {
  view.innerHTML = `<div class="page"><div class="empty"><p>Le catalogue n'a pas pu être chargé.</p><button class="btn" onclick="location.reload()">Recharger</button></div></div>`;
});

// Installation sur téléphone / démarrage rapide (uniquement en production).
if ("serviceWorker" in navigator && import.meta.env.PROD) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));

// Erreurs de connexion OAuth renvoyées dans l'URL.
const qp = new URLSearchParams(location.search);
if (qp.get("error_description")) { toast("Connexion impossible : " + qp.get("error_description"), 6000); history.replaceState(null, "", location.pathname + location.hash); }

export { signOut };
