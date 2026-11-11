// Application : en-tête, navigation, routeur (#/…), session, recherche globale.
import "./style.css";
import { supabase } from "./supabase.js";
import { loadCatalogue, ready, A } from "./data.js";
import { ME, onChange, initSession, updateProfile } from "./state.js";
import { initAuth, openAuth, isAuthOpen, signOut } from "./auth.js";
import { displayName, avatarUrl, avatarHTML } from "./profile.js";
import { $, esc, fmt, refreshCards, closeAddMenu } from "./ui.js";
import { toast } from "./toast.js";
import * as home from "./views/home.js";
import * as catalogue from "./views/catalogue.js";
import * as collection from "./views/collection.js";
import * as lists from "./views/lists.js";
import * as account from "./views/account.js";
import { openDetail, closeDetail, isDetailOpen } from "./views/detail.js";

const VIEWS = { "": home, catalogue, collection, listes: lists, compte: account };
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
  closeAddMenu(); catalogue.closeDrawer();
  if (key !== "catalogue" && catalogue.S.q) { catalogue.S.q = ""; $("q").value = ""; }
  setNav(VIEWS[key] ? key || "home" : "home");
  v.render(view, key === "catalogue" ? params : parts[1]);
  document.title = { "": "Animéthèque", catalogue: "Catalogue · Animéthèque", collection: "Ma collection · Animéthèque", listes: "Mes listes · Animéthèque", compte: "Mon compte · Animéthèque" }[key] || "Animéthèque";
}
function route() {
  if (!ready.catalogue) return;
  const { parts, params } = parse();
  if (parts[0] === "anime") {
    if (base === null) { base = "#/"; renderPage([], new URLSearchParams()); depth = 0; }
    closeAddMenu();
    if (openDetail(+parts[1], closeFromDetail)) depth++;
    else history.replaceState(null, "", base);
    return;
  }
  const key = location.hash || "#/";
  const fromDetail = isDetailOpen();
  closeDetail();
  if (fromDetail && key === base) { depth = 0; return; }   // retour depuis une fiche : on garde la page et sa position
  depth = 0; base = key;
  renderPage(parts, params);
  if (!fromDetail) scrollTo(0, 0);
}
function closeFromDetail() {
  if (depth > 0 && history.length > depth) history.go(-depth);
  else { closeDetail(); history.replaceState(null, "", base || "#/"); depth = 0; }
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

// Recherche globale : bascule vers le catalogue.
let qt;
$("q").addEventListener("input", e => {
  clearTimeout(qt);
  qt = setTimeout(() => {
    catalogue.S.q = e.target.value;
    if ((location.hash || "#/").startsWith("#/catalogue") && !isDetailOpen()) catalogue.refresh();
    else location.hash = "#/catalogue";
  }, 160);
});
$("q").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (!(location.hash || "").startsWith("#/catalogue")) location.hash = "#/catalogue"; } });
addEventListener("keydown", e => {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $("q").focus(); }
});

document.addEventListener("click", e => { if (e.target.closest("[data-need-auth]")) openAuth(); });
$("signIn").addEventListener("click", () => openAuth());

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
loadCatalogue().then(() => {
  $("dbsize").textContent = fmt(A.length) + " animés";
  addEventListener("hashchange", route);
  route();
  initSession();
}).catch(() => {
  view.innerHTML = `<div class="page"><div class="empty"><p>Le catalogue n'a pas pu être chargé.</p><button class="btn" onclick="location.reload()">Recharger</button></div></div>`;
});

// Erreurs de connexion OAuth renvoyées dans l'URL.
const qp = new URLSearchParams(location.search);
if (qp.get("error_description")) { toast("Connexion impossible : " + qp.get("error_description"), 6000); history.replaceState(null, "", location.pathname + location.hash); }

export { signOut };
