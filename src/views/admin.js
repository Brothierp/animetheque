// Vue « Admin » (#/admin) : liste des comptes, réservée aux administrateurs (contrôle fait par la base de données).
import { supabase } from "../supabase.js";
import { ME, onChange } from "../state.js";
import { $, esc, fmt } from "../ui.js";
import { toast } from "../toast.js";
import { SOC, onSocial, adminFeedback, feedbackReplies, replyFeedback, setFeedbackStatus, adminReports, setReportHandled, socialError } from "../social.js";
import { KIND, STATUS, threadHTML } from "../feedback.js";
import { deleteComment } from "../social.js";
import { adminFanarts, updateFanart, deleteFanart, adminPending } from "../fanart-api.js";
import { adminChatImages, adminPendingChatImages, reviewChatImage, deleteChatImage } from "../chat-images.js";
import { byId, titleOf } from "../data.js";
import { messageHTML, prepareTokens } from "../safety.js";
import { charById, loadCharacters } from "../chars.js";

let pendingFa = 0;
const CAT = { contournement: "contourne les contrôles", sexuel: "propos sexuels ou déplacés", photos_rdv: "demande de photos ou de rendez-vous", harcelement: "harcèlement / insultes", arnaque: "spam / arnaque", autre: "autre", secret: "secret demandé", photos: "demande de photo", rencontre: "rencontre / adresse", intime: "propos intimes", age: "question sur l'âge", cadeau: "cadeau / argent", avis: "avis", fanart: "fan art" };

let root = null, rows = null, q = "", sort = "created";
const isShown = () => !!(root && root.isConnected && root.dataset.view === "admin");   // page réellement affichée ?
const PROV = { google: "Google", email: "E-mail" };
const day = 86400000;
const date = d => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const ago = d => {
  if (!d) return "jamais";
  const n = Math.floor((Date.now() - Date.parse(d)) / day);
  return n <= 0 ? "aujourd'hui" : n === 1 ? "hier" : n < 31 ? `il y a ${n} j` : date(d);
};
// Avec la seule année, l'âge exact dépend du jour d'anniversaire : on affiche « 35-36 ans ».
const age = y => { if (!y) return "—"; const a = new Date().getFullYear() - y; return `${a - 1}-${a} ans`; };

async function load() {
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) throw error;
  rows = data;
}

function filtered() {
  const s = q.trim().toLowerCase();
  let L = rows.filter(r => !s || (r.email || "").toLowerCase().includes(s) || (r.username || "").toLowerCase().includes(s));
  const cmp = { created: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at), last: (a, b) => (Date.parse(b.last_sign_in_at) || 0) - (Date.parse(a.last_sign_in_at) || 0),
    pseudo: (a, b) => (a.username || "~").localeCompare(b.username || "~", "fr"), age: (a, b) => (b.birth_year || 0) - (a.birth_year || 0), titles: (a, b) => b.titles - a.titles }[sort];
  return L.sort(cmp);
}

function paint() {
  if (!isShown() || !rows) return;
  const now = Date.now(), L = filtered();
  const stat = (n, label) => `<div class="st-n"><b>${fmt(n)}</b><span>${label}</span></div>`;
  $("admStats").innerHTML = stat(rows.length, "comptes")
    + stat(rows.filter(r => now - Date.parse(r.created_at) < 7 * day).length, "inscrits ces 7 derniers jours")
    + stat(rows.filter(r => r.last_sign_in_at && now - Date.parse(r.last_sign_in_at) < 30 * day).length, "actifs ces 30 derniers jours")
    + stat(rows.filter(r => r.birth_year && new Date().getFullYear() - r.birth_year < 18).length, "mineurs (année de naissance)");
  $("admCount").textContent = `${fmt(L.length)} compte${L.length > 1 ? "s" : ""}${q ? " trouvé" + (L.length > 1 ? "s" : "") : ""}`;
  $("admBody").innerHTML = L.length ? L.map(r => `<tr>
      <td>${r.username ? `<b>${esc(r.username)}</b>` : `<span class="hint">sans pseudo</span>`}${r.user_id === ME.user.id ? ` <span class="adm-me">toi</span>` : ""}</td>
      <td><a href="mailto:${esc(r.email || "")}">${esc(r.email || "—")}</a>${r.email_confirmed ? "" : ` <span class="adm-warn" title="Adresse pas encore confirmée">non confirmé</span>`}</td>
      <td>${age(r.birth_year)}${r.birth_year ? ` <span class="hint">(${r.birth_year})</span>` : ""}</td>
      <td>${esc((r.providers || "").split(", ").map(p => PROV[p] || p).join(", ") || "—")}</td>
      <td>${date(r.created_at)}</td>
      <td>${ago(r.last_sign_in_at)}</td>
      <td class="num">${fmt(r.titles)}</td></tr>`).join("")
    : `<tr><td colspan="7" class="hint">Aucun compte ne correspond.</td></tr>`;
}

function exportCsv() {
  const L = filtered(), cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Pseudo", "E-mail", "E-mail confirmé", "Année de naissance", "Connexion", "Inscription", "Dernière connexion", "Titres dans la collection"].map(cell).join(";")]
    .concat(L.map(r => [r.username, r.email, r.email_confirmed ? "oui" : "non", r.birth_year, r.providers, date(r.created_at), r.last_sign_in_at ? date(r.last_sign_in_at) : "", r.titles].map(cell).join(";")));
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = `animetheque-comptes-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Liste exportée (ouvrable dans Excel ou LibreOffice)");
}

let tab = "comptes";
const admTabs = () => {
  const c = SOC.counters;
  return `<nav class="tabs2" aria-label="Administration">
    ${ME.isAdmin ? `<a href="#/admin" class="${tab === "comptes" ? "on" : ""}">👤 Comptes</a>
    <a href="#/admin/suggestions" class="${tab === "suggestions" ? "on" : ""}">💡 Suggestions${c.admin_feedback ? ` <span class="nb">${c.admin_feedback}</span>` : ""}</a>` : ""}
    <a href="#/admin/signalements" class="${tab === "signalements" ? "on" : ""}">🚩 Signalements${c.admin_reports ? ` <span class="nb">${c.admin_reports}</span>` : ""}</a>
    <a href="#/admin/fanarts" class="${tab === "fanarts" ? "on" : ""}">🎨 Images${pendingFa + pendingChat ? ` <span class="nb">${pendingFa + pendingChat}</span>` : ""}</a></nav>`;
};

// ---------- Suggestions ----------
async function renderSuggestions(el) {
  el.innerHTML = `<div class="page"><div class="cat-top"><div><h1>Administration</h1><div class="count">Suggestions des membres : réponds-leur directement, ils verront ta réponse dans « Mon compte ».</div></div></div>${admTabs()}<div id="admFb"><p class="loading">Chargement…</p></div></div>`;
  if (SOC.enabled === false) { $("admFb").innerHTML = `<div class="empty"><p>Lance le script SQL 20261116000000 pour recevoir les suggestions.</p></div>`; return; }
  const L = await adminFeedback();
  const box = $("admFb");
  if (!L.length) { box.innerHTML = `<div class="empty"><p>Aucune suggestion pour l'instant.</p></div>`; return; }
  box.innerHTML = L.map(f => `<details class="fb-item adm-fb" data-id="${f.id}"${f.status === "nouveau" ? " open" : ""}>
    <summary><span class="fb-k">${KIND[f.kind]}</span><span class="fb-s"><b>${esc(f.username || "Membre")}</b> · ${esc(f.body.slice(0, 70))}${f.body.length > 70 ? "…" : ""}</span><span class="fb-st st-${f.status}">${f.status === "nouveau" ? "À traiter" : STATUS[f.status]}</span></summary>
    <p class="hint">${esc(f.email || "")} · page : ${esc(f.page || "—")} · ${new Date(f.created_at).toLocaleString("fr-FR")}</p>
    <div class="fb-th"><p class="hint">Chargement de l'échange…</p></div>
    <form class="fb-reply"><textarea maxlength="2000" rows="2" placeholder="Ta réponse à ${esc(f.username || "ce membre")}…"></textarea><button class="btn sm primary" type="submit">Répondre</button></form>
    <div class="fb-adm-act"><span class="hint">Statut :</span>${Object.entries(STATUS).map(([k, v]) => `<button type="button" class="btn sm${f.status === k ? " on-st" : ""}" data-st="${k}">${v}</button>`).join("")}</div>
  </details>`).join("");
  const loadTh = async d => { const f = L.find(x => x.id === d.dataset.id); d.querySelector(".fb-th").innerHTML = threadHTML(f, await feedbackReplies(f.id), false); d.dataset.loaded = "1"; };
  box.querySelectorAll("details[open]").forEach(loadTh);
  box.addEventListener("toggle", e => { const d = e.target; if (d.open && !d.dataset.loaded && d.classList.contains("adm-fb")) loadTh(d); }, true);
  box.addEventListener("submit", async e => {
    e.preventDefault(); const d = e.target.closest("details"), t = e.target.querySelector("textarea").value.trim(); if (!t) return;
    try { await replyFeedback(d.dataset.id, t); toast("Réponse envoyée au membre"); renderSuggestions(el); } catch (err) { toast(socialError(err)); }
  });
  box.addEventListener("click", async e => {
    const b = e.target.closest("[data-st]"); if (!b) return;
    try { await setFeedbackStatus(b.closest("details").dataset.id, b.dataset.st); renderSuggestions(el); } catch (err) { toast(socialError(err)); }
  });
}

// ---------- Signalements ----------
async function renderReports(el) {
  el.innerHTML = `<div class="page"><div class="cat-top"><div><h1>Administration</h1><div class="count">Signalements : tu ne vois que le message signalé, jamais la conversation.</div></div></div>${admTabs()}<div id="admRep"><p class="loading">Chargement…</p></div></div>`;
  if (SOC.enabled === false) { $("admRep").innerHTML = `<div class="empty"><p>Lance le script SQL 20261116000000 pour recevoir les signalements.</p></div>`; return; }
  const L = await adminReports();
  await prepareTokens(L.map(r => r.excerpt || ""));
  $("admRep").innerHTML = L.length ? `<div class="rep-list">${L.map(r => `<article class="rep${r.handled ? " done" : ""}${r.auto ? " auto" : ""}${r.urgent && !r.handled ? " urgent" : ""}" data-id="${r.id}" data-c="${r.comment_id || ""}">
      ${r.auto ? `<p><span class="rep-auto">🛡️ Détection automatique</span> <b>${esc(CAT[r.category] || r.category || "")}</b> · message de <b>${esc(r.target_name || "Membre")}</b> ${r.target_email ? `<span class="hint">(${esc(r.target_email)})</span>` : ""} dans une conversation majeur / mineur · <span class="hint">${new Date(r.created_at).toLocaleString("fr-FR")}</span></p>`
        : `<p><b>${esc(r.reporter_name || "Membre")}</b> ${r.reporter_email ? `<span class="hint">(${esc(r.reporter_email)})</span>` : ""} signale ${r.comment_id ? "l'avis de" : r.fanart_id ? "le fan art de" : ""} <b>${esc(r.target_name || "Membre")}</b> ${r.target_email ? `<span class="hint">(${esc(r.target_email)})</span>` : ""} · <span class="hint">${new Date(r.created_at).toLocaleString("fr-FR")}</span></p>
      <p>${r.urgent ? `<span class="rep-urg">⚠️ Mineur concerné</span> ` : ""}${r.category && CAT[r.category] && !r.auto ? `<b>${esc(CAT[r.category])}</b> · ` : ""}Motif : ${esc(r.reason)}</p>`}${r.excerpt ? `<blockquote${r.with_context ? ` class="rep-ctx"` : ""}>${r.with_context ? `<small class="hint">Conversation jointe par la personne qui signale :</small><br>` : ""}${messageHTML(r.excerpt)}</blockquote>` : ""}
      <div class="rep-act"><button type="button" class="btn sm" data-h="${r.handled ? 0 : 1}">${r.handled ? "Rouvrir" : "Marquer comme traité"}</button>
      ${r.comment_id ? `<button type="button" class="btn sm danger-o" data-delc>Supprimer l'avis</button>` : ""}
      ${r.fanart_id ? `<a class="btn sm" href="#/fanarts/${r.fanart_id}">Voir le fan art</a>` : ""}</div></article>`).join("")}</div>
      <p class="hint">Les détections automatiques concernent uniquement les conversations entre un majeur et un mineur (secret, photo, rendez-vous, propos intimes, âge, cadeaux). Les coordonnées et les liens y sont bloqués avant l'envoi. Pour sanctionner un compte : supprime-le dans Supabase (Authentication → Users), ou ajoute le mot en cause à la table banned_words. En cas de danger pour un mineur : signalement sur internet-signalement.gouv.fr (PHAROS).</p>`
    : `<div class="empty"><p>Aucun signalement 👍</p></div>`;
  $("admRep").addEventListener("click", async e => {
    const d = e.target.closest("[data-delc]");
    if (d) { if (!confirm("Supprimer définitivement cet avis ?")) return; const r = d.closest(".rep"); try { await deleteComment(r.dataset.c); await setReportHandled(r.dataset.id, true); toast("Avis supprimé"); renderReports(el); } catch (err) { toast(socialError(err)); } return; }
    const b = e.target.closest("[data-h]"); if (!b) return;
    try { await setReportHandled(b.closest(".rep").dataset.id, b.dataset.h === "1"); renderReports(el); } catch (err) { toast(socialError(err)); }
  });
}

// ---------- Images des conversations avec un mineur ----------
let pendingChat = 0;
async function renderChatImages(el) {
  let L;
  try { L = await adminChatImages("pending"); } catch { $("admFa").innerHTML = `<div class="empty"><p>Lance le script SQL 20261117030000 pour activer les images dans les conversations.</p></div>`; return; }
  $("admFa").innerHTML = `<p class="hint">Images envoyées dans une conversation où participe un mineur. Elles restent privées : seul le destinataire les verra si tu les valides. Entre deux majeurs, les images s'affichent sans vérification.</p>`
    + (L.length ? `<div class="adm-fa">${L.map(r => `<article class="afa" data-id="${r.id}">
      <a href="${esc(r.url)}" target="_blank" rel="noopener"><img src="${esc(r.url)}" alt="" loading="lazy"></a>
      <div><p>${r.ai_score != null ? `<span class="ai-sc${r.ai_score >= 0.5 ? " hi" : ""}" title="Analyse automatique avant l'envoi">🤖 ${Math.round(r.ai_score * 100)} % suspect</span>` : ""} <b>${esc(r.sender_name || "Membre")}</b> <span class="hint">(${r.sender_adult ? "majeur" : "mineur"})</span> → <b>${esc(r.recipient_name || "Membre")}</b> <span class="hint">(${r.recipient_adult ? "majeur" : "mineur"})</span></p>
        <p class="hint">${new Date(r.created_at).toLocaleString("fr-FR")}</p>
        <div class="rep-act"><button type="button" class="btn sm primary" data-ci="approved">✓ Afficher au destinataire</button><button type="button" class="btn sm" data-ci="rejected">Refuser</button><button type="button" class="btn sm danger-o" data-ci="del">Supprimer</button></div></div></article>`).join("")}</div>`
      : `<div class="empty"><p>Aucune image en attente 👍</p></div>`);
  $("admFa").onclick = async e => {
    const b = e.target.closest("[data-ci]"); if (!b) return;
    const r = L.find(x => x.id === b.closest(".afa").dataset.id);
    try {
      if (b.dataset.ci === "del") { if (!confirm("Supprimer définitivement cette image ?")) return; await deleteChatImage(r); toast("Image supprimée"); }
      else { await reviewChatImage(r.id, b.dataset.ci); toast(b.dataset.ci === "approved" ? "Image affichée au destinataire" : "Image refusée"); }
      pendingChat = await adminPendingChatImages(); renderFanarts(el);
    } catch (err) { toast(socialError(err)); }
  };
}

// ---------- Fan arts à valider ----------
let faStatus = "pending";
async function renderFanarts(el) {
  el.innerHTML = `<div class="page"><div class="cat-top"><div><h1>Administration</h1><div class="count">Fan arts : rien n'est publié sans ta validation.</div></div></div>${admTabs()}
    <div class="sp-tabs adm-fst">${[["pending", "À vérifier"], ["approved", "Publiés"], ["rejected", "Refusés"], ["chat", `Images du chat${pendingChat ? ` (${pendingChat})` : ""}`]].map(([k, v]) => `<button type="button" data-fs="${k}" class="${faStatus === k ? "on" : ""}">${v}</button>`).join("")}</div>
    <div id="admFa"><p class="loading">Chargement…</p></div></div>`;
  el.querySelector(".adm-fst").addEventListener("click", e => { const b = e.target.closest("[data-fs]"); if (b) { faStatus = b.dataset.fs; renderFanarts(el); } });
  if (faStatus === "chat") return renderChatImages(el);
  let L;
  try { L = await adminFanarts(faStatus); } catch { $("admFa").innerHTML = `<div class="empty"><p>Lance le script SQL 20261116020000 pour activer les fan arts.</p></div>`; return; }
  if (L.some(f => f.character_id && !charById.has(f.character_id))) await loadCharacters().catch(() => {});
  const what = f => [f.character_id && charById.get(f.character_id) ? "🧑 " + (charById.get(f.character_id).name) : "", f.anime_id && byId.get(f.anime_id) ? "🎬 " + titleOf(byId.get(f.anime_id)) : ""].filter(Boolean).join(" · ");
  $("admFa").innerHTML = L.length ? `<div class="adm-fa">${L.map(f => `<article class="afa" data-id="${f.id}">
      <a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="" loading="lazy"></a>
      <div><b>${esc(f.title)}</b> ${f.ai_score != null ? `<span class="ai-sc${f.ai_score >= 0.5 ? " hi" : ""}" title="Analyse automatique avant l'envoi">🤖 ${Math.round(f.ai_score * 100)} % suspect</span>` : ""}<p class="hint">par <b>${esc(f.username || "Membre")}</b> (${esc(f.email || "")}) · ${new Date(f.created_at).toLocaleString("fr-FR")}</p>
        ${f.adult ? `<p><span class="fa-18 inline">18+</span> marqué 18+ par l'auteur : visible seulement par les majeurs connectés</p>` : ""}${f.tags && f.tags.length ? `<p class="hint">${f.tags.map(t => "#" + esc(t)).join(" ")}</p>` : ""}${f.credit ? `<p>🎨 Artiste crédité : <b>${esc(f.credit)}</b></p>` : ""}${f.source_url ? `<p>Source : <a href="${esc(f.source_url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(f.source_url)}</a></p>` : ""}${what(f) ? `<p>${esc(what(f))}</p>` : ""}${f.description ? `<p>${esc(f.description)}</p>` : ""}${f.reject_reason ? `<p class="hint">Motif du refus : ${esc(f.reject_reason)}</p>` : ""}
        <div class="rep-act">${f.status !== "approved" ? `<button type="button" class="btn sm primary" data-fa="ok">✓ Publier</button>` : ""}
          ${f.status !== "rejected" ? `<button type="button" class="btn sm" data-fa="no">Refuser…</button>` : ""}
          ${f.adult !== undefined ? `<button type="button" class="btn sm" data-fa="adult">${f.adult ? "Retirer 18+" : "🔞 Marquer 18+"}</button>` : ""}
          <button type="button" class="btn sm danger-o" data-fa="del">Supprimer</button></div></div></article>`).join("")}</div>`
    : `<div class="empty"><p>${faStatus === "pending" ? "Aucun fan art en attente 👍" : "Rien ici."}</p></div>`;
  $("admFa").addEventListener("click", async e => {
    const b = e.target.closest("[data-fa]"); if (!b) return;
    const f = L.find(x => x.id === b.closest(".afa").dataset.id);
    try {
      if (b.dataset.fa === "adult") { await updateFanart(f.id, { adult: !f.adult }); toast(f.adult ? "Étiquette 18+ retirée" : "Marqué 18+ : caché aux mineurs et aux visiteurs"); }
      else if (b.dataset.fa === "ok") { await updateFanart(f.id, { status: "approved" }); toast("Fan art publié 🎨"); }
      else if (b.dataset.fa === "no") { const r = prompt("Motif du refus (visible par l'auteur) :", "Image sans rapport avec les animés"); if (r === null) return; await updateFanart(f.id, { status: "rejected", reject_reason: r.slice(0, 300) || null }); toast("Fan art refusé"); }
      else { if (!confirm("Supprimer définitivement ce fan art (et son image) ?")) return; await deleteFanart(f); toast("Fan art supprimé"); }
      pendingFa = await adminPending(); renderFanarts(el);
    } catch (err) { toast(socialError(err)); }
  });
}

// ---------- Modérateurs ----------
const setModerator = async (name, enable) => { const { data, error } = await supabase.rpc("admin_set_moderator", { name, enable }); if (error) throw error; return data; };
const modError = err => { const m = (err && err.message) || ""; return /not_found/.test(m) ? "Aucun membre avec ce pseudo." : /moderator_minor/.test(m) ? "Un modérateur doit être majeur." : /PGRST202|function/.test(m) ? "Lance d'abord le script SQL 20261117060000 (modérateurs)." : "L'action a échoué."; };
async function paintMods() {
  const box = $("admMods"); if (!box) return;
  const { data, error } = await supabase.rpc("admin_moderators");
  if (error) { box.innerHTML = `<p class="hint">${esc(modError(error))}</p>`; return; }
  box.innerHTML = data.length ? `<ul class="people">${data.map(m => `<li><b>${esc(m.username || "Membre")}</b><span class="hint">depuis le ${date(m.added_at)}</span><span class="act"><button type="button" class="btn sm" data-unmod="${esc(m.username || "")}">Retirer</button></span></li>`).join("")}</ul>` : `<p class="hint">Aucun modérateur pour l'instant.</p>`;
}

export function render(el, sub) {
  root = el;
  if (!ME.user || !ME.ready) { el.innerHTML = `<div class="page"><p class="loading">Chargement…</p></div>`; return; }
  if (!ME.isStaff) { el.innerHTML = `<div class="page"><div class="empty"><p>Cette page est réservée à l'équipe de modération du site.</p><a class="btn" href="#/">Retour à l'accueil</a></div></div>`; return; }
  tab = ["suggestions", "signalements", "fanarts"].includes(sub) ? sub : "comptes";
  if (!ME.isAdmin && (tab === "comptes" || tab === "suggestions")) tab = "signalements";   // modérateur
  Promise.all([adminPending(), adminPendingChatImages()]).then(([n, c]) => { if (n !== pendingFa || c !== pendingChat) { pendingFa = n; pendingChat = c; const t = isShown() && root.querySelector(".tabs2"); if (t) t.outerHTML = admTabs(); } });
  if (tab !== "comptes") { ({ suggestions: renderSuggestions, signalements: renderReports, fanarts: renderFanarts })[tab](el).catch(err => { console.error(err); toast(socialError(err)); }); return; }
  el.innerHTML = `<div class="page">
    <div class="cat-top"><div><h1>Administration</h1><div class="count">Comptes inscrits. Les collections restent privées : seules ces informations sont visibles.</div></div>
      <div class="cat-tools"><button type="button" class="btn" id="admReload">Actualiser</button><button type="button" class="btn primary" id="admCsv">Exporter (tableur)</button></div></div>
    ${admTabs()}
    <section class="card2 adm-mods"><h2>Modérateurs</h2>
      <p class="hint">Des membres majeurs de confiance qui t'aident : vérification des images et fan arts, signalements, suppression d'avis. Ils ne voient ni les e-mails, ni cette liste de comptes, ni les suggestions.</p>
      <div id="admMods"><p class="hint">Chargement…</p></div>
      <form class="newlist" id="admModAdd"><input type="text" maxlength="20" placeholder="Pseudo du membre" autocomplete="off" aria-label="Pseudo du futur modérateur"><button class="btn primary" type="submit">Nommer modérateur</button></form></section>
    <section class="stats2" id="admStats"></section>
    <div class="adm-tools">
      <input type="search" id="admQ" placeholder="Rechercher un pseudo ou un e-mail…" value="${esc(q)}" autocomplete="off" aria-label="Rechercher un compte">
      <label class="sortsel"><span class="sr">Trier par</span><select id="admSort">
        <option value="created">Inscription (récentes d'abord)</option><option value="last">Dernière connexion</option>
        <option value="pseudo">Pseudo A → Z</option><option value="age">Âge (plus jeunes d'abord)</option><option value="titles">Titres dans la collection</option></select></label>
      <span class="hint" id="admCount"></span>
    </div>
    <div class="adm-wrap"><table class="adm">
      <thead><tr><th>Pseudo</th><th>E-mail</th><th>Âge</th><th>Connexion</th><th>Inscription</th><th>Dernière connexion</th><th class="num">Titres</th></tr></thead>
      <tbody id="admBody"><tr><td colspan="7" class="hint">Chargement des comptes…</td></tr></tbody>
    </table></div>
  </div>`;
  paintMods();
  $("admModAdd").addEventListener("submit", async e => {
    e.preventDefault(); const name = e.target.querySelector("input").value.trim(); if (!name) return;
    try { const n = await setModerator(name, true); toast(`${n} est maintenant modérateur·rice`); e.target.reset(); paintMods(); } catch (err) { toast(modError(err)); }
  });
  $("admMods").addEventListener("click", async e => {
    const b = e.target.closest("[data-unmod]"); if (!b) return;
    if (!confirm(`Retirer ${b.dataset.unmod} de l'équipe de modération ?`)) return;
    try { await setModerator(b.dataset.unmod, false); toast("Modérateur retiré"); paintMods(); } catch (err) { toast(modError(err)); }
  });
  $("admSort").value = sort;
  $("admSort").addEventListener("change", e => { sort = e.target.value; paint(); });
  $("admQ").addEventListener("input", e => { q = e.target.value; paint(); });
  $("admCsv").addEventListener("click", () => rows && exportCsv());
  $("admReload").addEventListener("click", () => { rows = null; render(el); });
  if (rows) paint();
  else load().then(paint).catch(err => { console.error(err); if ($("admBody")) $("admBody").innerHTML = `<tr><td colspan="7" class="imp-err">La liste n'a pas pu être chargée${/not_admin/.test(err.message || "") ? " : accès refusé" : ""}.</td></tr>`; });
}
onChange(what => { if (isShown() && (what === "session" || what === "collection")) { if (what === "session") rows = null; render(root, tab === "comptes" ? "" : tab); } });
onSocial(what => { if (isShown() && what === "counters") { const t = root.querySelector(".tabs2"); if (t) t.outerHTML = admTabs(); } });
