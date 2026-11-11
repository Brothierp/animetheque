// Page « Mon compte » : profil (avatar, pseudo, infos), statistiques, listes (créer, renommer,
// supprimer, ajouter / retirer des animés) et suppression du compte.
import "./style.css";
import { supabase } from "./supabase.js";
import { initAuth, openAuth, isAuthOpen, signOut, frError } from "./auth.js";
import * as store from "./store.js";
import {
  loadProfile, saveProfile, displayName, avatarUrl, avatarHTML, isAdultYear, parseBirthYear,
  usernameFormatError, usernameProblem, prepareAvatar, uploadAvatar, removeAvatar, removeAllAvatars, USERNAME_HELP
} from "./profile.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const norm = s => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3000); }

const STATUSES = { watched: "Regardé", watching: "En cours", plan: "Je veux regarder", dropped: "Abandonné" };
const ME = { user: null, profile: null, entries: new Map(), lists: {} };
let CAT = null;          // id → { t: titre, adult, hay }
let catPromise = null;

function loadCatalogue() {
  if (!catPromise) catPromise = fetch("/data.json").then(r => r.json()).then(d => {
    CAT = new Map();
    for (const x of d.items) CAT.set(x[0], { t: x[3] || x[2], alt: x[2], adult: x[22] === 1, hay: norm([x[2], x[3], x[4], ...x[5]].join(" ")), rank: CAT.size });
    renderLists();
  }).catch(() => { catPromise = null; });
  return catPromise;
}
const titleOf = id => (CAT && CAT.get(id) ? CAT.get(id).t : "Animé n° " + id);

// ---------- Rendu ----------
async function renderIdentity() {
  const u = ME.user, p = ME.profile, name = displayName(u, p);
  $("whoName").textContent = name;
  $("whoMail").textContent = u.email || "";
  $("bigAvatar").innerHTML = avatarHTML(null, name, "big");
  $("me").innerHTML = avatarHTML(null, name) + `<span>${esc(name)}</span>`; $("me").hidden = false;
  $("avatarRemove").hidden = !p.avatar_path;
  const url = await avatarUrl(u, p);
  if (url && ME.user && ME.user.id === u.id) {
    $("bigAvatar").innerHTML = avatarHTML(url, name, "big");
    $("me").innerHTML = avatarHTML(url, name) + `<span>${esc(name)}</span>`;
  }
}
function renderInfo() {
  const u = ME.user, p = ME.profile;
  $("usernameForm").elements.username.value = p.username || "";
  $("fEmail").textContent = u.email || "—";
  const providers = (u.app_metadata && u.app_metadata.providers) || [u.app_metadata && u.app_metadata.provider].filter(Boolean);
  $("fProvider").textContent = providers.map(x => x === "google" ? "Google" : x === "email" ? "E-mail et mot de passe" : x).join(" · ") || "—";
  $("pwdField").hidden = !providers.includes("email");
  if (p.birth_year) {
    $("fBirth").textContent = p.birth_year + (isAdultYear(p.birth_year) ? " · accès au contenu 18+" : " · contenu 18+ non accessible");
    $("fBirth").hidden = false; $("birthForm").hidden = true;
  } else { $("fBirth").hidden = true; $("birthForm").hidden = false; }
  $("fSince").textContent = new Date(u.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
function renderStats() {
  const E = [...ME.entries.values()];
  const n = f => E.filter(f).length;
  const items = [
    ["any", E.filter(e => e.f || e.r || e.c || e.s || Object.keys(e.l).length).length, "titres dans ma collection"],
    ["fav", n(e => e.f), "coups de cœur"], ["rated", n(e => e.r), "notés"],
    ...Object.entries(STATUSES).map(([k, v]) => ["s:" + k, n(e => e.s === k), v.toLowerCase()])
  ];
  $("stats").innerHTML = items.map(([col, c, label]) => `<a class="stat" href="/?col=${encodeURIComponent(col)}"><b>${c}</b><span>${esc(label)}</span></a>`).join("");
}
const sortedLists = () => Object.entries(ME.lists).sort((a, b) => a[1].t - b[1].t);
const listItems = id => [...ME.entries.entries()].filter(([, e]) => e.l[id]).map(([aid]) => aid);
const openLists = new Set();

function renderLists() {
  const L = sortedLists();
  if (!L.length) { $("lists").innerHTML = `<p class="hint">Aucune liste pour l'instant. Crée ta première liste ci-dessus, puis ajoute-y des animés.</p>`; return; }
  $("lists").innerHTML = L.map(([id, l]) => {
    const items = listItems(id).sort((a, b) => titleOf(a).localeCompare(titleOf(b), "fr"));
    return `<details class="alist" data-id="${esc(id)}"${openLists.has(id) ? " open" : ""}>
      <summary><span class="ln">${esc(l.n)}</span><span class="n">${items.length} titre${items.length > 1 ? "s" : ""}</span></summary>
      <div class="acts">
        <a class="ib" href="/?col=${encodeURIComponent("l:" + id)}" style="text-decoration:none">Voir dans le catalogue</a>
        <button type="button" class="ib" data-act="rename">Renommer</button>
        <button type="button" class="ib" data-act="del">Supprimer la liste</button>
      </div>
      <form class="rename" data-act="renameForm" hidden><input type="text" name="n" maxlength="40" value="${esc(l.n)}"><button class="btn primary" type="submit">OK</button></form>
      <div class="rename addbox">
        <input type="search" name="q" placeholder="${CAT ? "Ajouter un animé : tape un titre…" : "Chargement du catalogue…"}" autocomplete="off"${CAT ? "" : " disabled"}>
      </div>
      <div class="sugg" hidden></div>
      ${items.length ? `<ol>${items.map(aid => `<li><a href="https://anilist.co/anime/${aid}" target="_blank" rel="noopener">${esc(titleOf(aid))}</a> <button type="button" class="linkbtn rm" data-act="rm" data-aid="${aid}" aria-label="Retirer ${esc(titleOf(aid))} de la liste">retirer</button></li>`).join("")}</ol>` : `<p class="hint" style="padding:0 12px 12px 32px;margin:0">Liste vide : utilise le champ ci-dessus pour ajouter des animés.</p>`}
    </details>`;
  }).join("");
}
function renderAll() { renderIdentity(); renderInfo(); renderStats(); renderLists(); }

// ---------- Recherche d'animés pour les listes ----------
function search(q) {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length || !CAT) return [];
  const adultOk = isAdultYear(ME.profile && ME.profile.birth_year), out = [];
  for (const [id, a] of CAT) {
    if (a.adult && !adultOk) continue;
    if (words.every(w => a.hay.includes(w))) { out.push(id); if (out.length >= 8) break; } // déjà triés par popularité
  }
  return out;
}
$("lists").addEventListener("input", e => {
  if (e.target.name !== "q") return;
  const box = e.target.closest(".alist"), sugg = box.querySelector(".sugg"), lid = box.dataset.id;
  const ids = search(e.target.value);
  sugg.hidden = !e.target.value.trim();
  sugg.innerHTML = ids.length
    ? ids.map(id => { const inList = ME.entries.get(id) && ME.entries.get(id).l[lid];
        return `<button type="button" data-act="add" data-aid="${id}"${inList ? " disabled" : ""}>${esc(titleOf(id))}${CAT.get(id).alt && CAT.get(id).alt !== titleOf(id) ? ` <small>${esc(CAT.get(id).alt)}</small>` : ""}${inList ? " <small>(déjà dans la liste)</small>" : ""}</button>`; }).join("")
    : `<p class="hint" style="margin:0;padding:6px 8px">Aucun titre trouvé.</p>`;
});
$("lists").addEventListener("toggle", e => {
  const d = e.target; if (!d.classList || !d.classList.contains("alist")) return;
  d.open ? openLists.add(d.dataset.id) : openLists.delete(d.dataset.id);
}, true);

function entry(aid) {
  if (!ME.entries.has(aid)) ME.entries.set(aid, { f: false, r: 0, c: "", s: "", t: 0, l: {} });
  return ME.entries.get(aid);
}
$("lists").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const box = b.closest(".alist"), lid = box.dataset.id, act = b.dataset.act;
  if (act === "add" || act === "rm") {
    const aid = +b.dataset.aid, add = act === "add";
    b.disabled = true;
    try {
      await store.saveListMembership(ME.user.id, aid, { [lid]: add });
      if (add) entry(aid).l[lid] = true; else delete entry(aid).l[lid];
      openLists.add(lid); renderLists(); renderStats();
      toast(add ? `« ${titleOf(aid)} » ajouté à « ${ME.lists[lid].n} »` : `« ${titleOf(aid)} » retiré de la liste`);
      if (add) { const inp = $("lists").querySelector(`.alist[data-id="${CSS.escape(lid)}"] input[name=q]`); if (inp) inp.focus(); }
    } catch (err) { console.error(err); toast(frError(err)); b.disabled = false; }
  } else if (act === "rename") {
    const f = box.querySelector("[data-act=renameForm]"); f.hidden = !f.hidden; if (!f.hidden) f.elements.n.select();
  } else if (act === "del") {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirmer la suppression ?"; setTimeout(() => { b.dataset.confirm = ""; b.textContent = "Supprimer la liste"; }, 3500); return; }
    try {
      await store.deleteList(lid);
      const name = ME.lists[lid].n; delete ME.lists[lid];
      for (const en of ME.entries.values()) delete en.l[lid];
      renderLists(); renderStats(); toast(`Liste « ${name} » supprimée`);
    } catch (err) { console.error(err); toast(frError(err)); }
  }
});
$("lists").addEventListener("submit", async e => {
  const f = e.target; if (f.dataset.act !== "renameForm") return; e.preventDefault();
  const lid = f.closest(".alist").dataset.id, n = f.elements.n.value.trim().slice(0, 40);
  if (!n) return;
  if (Object.entries(ME.lists).some(([k, v]) => k !== lid && v.n.toLowerCase() === n.toLowerCase())) return toast("Tu as déjà une liste de ce nom.");
  try { await store.renameList(lid, n); ME.lists[lid].n = n; openLists.add(lid); renderLists(); toast("Liste renommée"); }
  catch (err) { console.error(err); toast(err.code === "23505" ? "Tu as déjà une liste de ce nom." : frError(err)); }
});
$("newListForm").addEventListener("submit", async e => {
  e.preventDefault();
  const n = $("newList").value.trim().slice(0, 40); if (!n) return;
  if (Object.values(ME.lists).some(v => v.n.toLowerCase() === n.toLowerCase())) return toast("Tu as déjà une liste de ce nom.");
  if (Object.keys(ME.lists).length >= 50) return toast("50 listes maximum.");
  const btn = e.target.querySelector("button"); btn.disabled = true;
  try {
    const row = await store.createList(ME.user.id, n);
    ME.lists[row.id] = { n: row.name, t: Date.parse(row.created_at) };
    openLists.add(row.id); $("newList").value = ""; renderLists();
    toast(`Liste « ${n} » créée : ajoute-y des animés`);
    const inp = $("lists").querySelector(`.alist[data-id="${CSS.escape(row.id)}"] input[name=q]`); if (inp) inp.focus();
  } catch (err) { console.error(err); toast(/list_limit/.test(err.message || "") ? "50 listes maximum." : err.code === "23505" ? "Tu as déjà une liste de ce nom." : frError(err)); }
  finally { btn.disabled = false; }
});

// ---------- Profil ----------
let ut, useq = 0;
$("usernameForm").elements.username.addEventListener("input", e => {
  clearTimeout(ut); const v = e.target.value.trim(), my = ++useq, st = $("usernameState");
  st.className = "ustate";
  if (!v || v === ME.profile.username) { st.textContent = USERNAME_HELP; return; }
  const local = usernameFormatError(v);
  if (local) { st.textContent = local; st.classList.add("bad"); return; }
  st.textContent = "Vérification…";
  ut = setTimeout(async () => {
    try { const p = await usernameProblem(v); if (my !== useq) return; st.textContent = p || "Pseudo disponible ✓"; st.classList.add(p ? "bad" : "good"); }
    catch { if (my === useq) st.textContent = USERNAME_HELP; }
  }, 400);
});
$("usernameForm").addEventListener("submit", async e => {
  e.preventDefault();
  const u = e.target.elements.username.value.trim(); if (u === ME.profile.username) return;
  clearTimeout(ut); useq++;
  const btn = e.target.querySelector("button"); btn.disabled = true;
  try {
    const p = await usernameProblem(u); if (p) { toast(p); return; }
    await saveProfile(ME.user.id, { username: u }, !ME.profile.missing);
    ME.profile = { ...ME.profile, username: u, missing: false };
    $("usernameState").textContent = "Pseudo enregistré ✓"; $("usernameState").className = "ustate good";
    renderIdentity(); toast("Pseudo enregistré");
  } catch (err) { console.error(err); toast(frError(err)); }
  finally { btn.disabled = false; }
});
$("birthForm").addEventListener("submit", async e => {
  e.preventDefault();
  const y = parseBirthYear(e.target.elements.birth.value);
  if (!y) return toast("Indique une année valide (4 chiffres, ex. 1998).");
  if (!confirm(`Confirmer l'année ${y} ? Elle ne pourra plus être modifiée.`)) return;
  try {
    await saveProfile(ME.user.id, { birth_year: y }, !ME.profile.missing);
    ME.profile = { ...ME.profile, birth_year: y, missing: false }; renderInfo(); toast("Année enregistrée");
  } catch (err) { console.error(err); toast(frError(err)); }
});
$("pwdForm").addEventListener("submit", async e => {
  e.preventDefault();
  const pw = e.target.elements.password.value;
  if (pw.length < 8) return toast("Le mot de passe doit contenir au moins 8 caractères.");
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return toast(frError(error));
  e.target.reset(); toast("Mot de passe modifié");
});
$("avatarFile").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = ""; if (!file) return;
  toast("Envoi de l'avatar…");
  try {
    const blob = await prepareAvatar(file);
    const path = await uploadAvatar(ME.user.id, blob, ME.profile.avatar_path, !ME.profile.missing);
    ME.profile = { ...ME.profile, avatar_path: path, missing: false };
    await renderIdentity(); toast("Avatar mis à jour");
  } catch (err) {
    console.error(err);
    toast(err.message === "format" ? "Format non pris en charge : choisis une image JPG, PNG ou WebP."
      : err.message === "trop_lourd" ? "Image trop lourde (15 Mo maximum)." : "L'envoi de l'avatar a échoué. Réessaie.");
  }
});
$("avatarRemove").addEventListener("click", async () => {
  try { await removeAvatar(ME.user.id, ME.profile.avatar_path); ME.profile = { ...ME.profile, avatar_path: null }; await renderIdentity(); toast("Avatar retiré"); }
  catch (err) { console.error(err); toast(frError(err)); }
});
$("deleteForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.elements.confirm.value.trim().toUpperCase() !== "SUPPRIMER") return toast("Tape SUPPRIMER (en majuscules) pour confirmer.");
  const btn = e.target.querySelector("button"); btn.disabled = true;
  try {
    await removeAllAvatars(ME.user.id).catch(() => {});
    const { error } = await supabase.rpc("delete_my_account");
    if (error) throw error;
    await supabase.auth.signOut({ scope: "local" });
    location.href = "/?compte=supprime";
  } catch (err) { console.error(err); toast("La suppression a échoué. Réessaie dans un instant."); btn.disabled = false; }
});

// ---------- Session ----------
async function onCompleteProfile(patch) {
  await saveProfile(ME.user.id, patch, !ME.profile.missing);
  ME.profile = { ...ME.profile, ...patch, missing: false }; renderAll(); toast("Profil enregistré");
}
async function onSession(session) {
  const user = session ? session.user : null;
  if (user && ME.user && ME.user.id === user.id) { ME.user = user; return; }
  ME.user = user;
  if (!user) {
    $("content").hidden = true; $("loading").hidden = true; $("gate").hidden = false;
    $("me").hidden = true; $("signOut").hidden = true; return;
  }
  $("gate").hidden = true; $("loading").hidden = false; $("signOut").hidden = false;
  try {
    const [col, profile] = await Promise.all([store.loadCollection(), loadProfile()]);
    if (!ME.user || ME.user.id !== user.id) return; // déconnecté entre-temps
    ME.profile = profile; ME.entries = col.entries; ME.lists = col.lists;
    $("loading").hidden = true; $("content").hidden = false;
    renderAll(); loadCatalogue();
    if ((!profile.username || !profile.birth_year) && !isAuthOpen())
      openAuth("profile", { needUsername: !profile.username, needBirth: !profile.birth_year });
  } catch (err) {
    console.error(err); $("loading").textContent = "Ton compte n'a pas pu être chargé. Recharge la page.";
  }
}

if (!supabase) {
  $("loading").hidden = true; $("gate").hidden = false; $("gateSignIn").hidden = true;
  $("gateMsg").textContent = "Le site n'est pas relié à sa base de données (variables VITE_SUPABASE_* manquantes).";
} else {
  initAuth({ onCompleteProfile });
  $("gateSignIn").addEventListener("click", () => openAuth());
  $("signOut").addEventListener("click", async () => { await signOut(); location.href = "/"; });
  supabase.auth.onAuthStateChange((event, session) => { setTimeout(() => onSession(session), 0); });
}
