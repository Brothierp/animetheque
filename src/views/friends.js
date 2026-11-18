// Vue « Amis » : messages, amis (ajout par pseudo, demandes, blocages), listes partagées,
// conversation, page d'un membre, page d'une liste partagée ou commune.
import { byId, A, norm, titleOf, coverStyle, hdUrl } from "../data.js";
import { ME, adultAllowed, requireUser } from "../state.js";
import { $, esc, fmt, grid, cover } from "../ui.js";
import { avatarHTML, tooYoungYear } from "../profile.js";
import { toast } from "../toast.js";
import { gate } from "./collection.js";
import {
  SOC, onSocial, onMessage, person, loadPeople, loadFriends, friendsList, isFriend, findMember, sendRequest, acceptRequest,
  removeFriend, blockUser, listBlocks, unblock, loadConversations, loadThread, sendMessage, markRead, deleteMessage, clearConversation, report,
  sharedLists, listItemsOf, refreshCounters, friendsActivity, addToSharedList, removeFromSharedList, listMembers, socialError
} from "../social.js";
import { preventionDialog, mixedBanner, messageHTML, prepareTokens, tokenPreview, sharePicker, reportDialog, isAdultMe } from "../safety.js";
import { fanartPickerSource, SOURCE_RE } from "../fanart-api.js";
import { uploadChatImage } from "../chat-images.js";

let root = null, route = [], chatUid = null, offMsg = null, thread = [], curTab = "", poll = null;
const isShown = () => !!(root && root.isConnected && root.dataset.view === "amis");   // page réellement affichée ?
const ago = d => {
  const t = Date.parse(d), s = (Date.now() - t) / 1000;
  if (s < 60) return "à l'instant"; if (s < 3600) return `${Math.floor(s / 60)} min`;
  const dd = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  if (t >= today.getTime()) return dd.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (t >= today.getTime() - 86400000) return "hier";
  return dd.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};
const av = (uid, cls = "") => avatarHTML(person(uid).avatar, person(uid).username, cls);
const tabsHTML = cur => {
  const c = SOC.counters;
  return `<nav class="tabs2" aria-label="Amis">
    <a href="#/amis" class="${cur === "messages" ? "on" : ""}">💬 Messages${c.messages ? ` <span class="nb">${c.messages}</span>` : ""}</a>
    <a href="#/amis/amis" class="${cur === "amis" ? "on" : ""}">👥 Amis${c.friend_requests ? ` <span class="nb">${c.friend_requests}</span>` : ""}</a>
    <a href="#/amis/activite" class="${cur === "activite" ? "on" : ""}">📰 Activité</a>
    <a href="#/amis/listes" class="${cur === "listes" ? "on" : ""}">📋 Listes partagées</a></nav>`;
};
const page = (cur, body) => (curTab = cur, `<div class="page soc"><div class="cat-top"><div><h1>Amis</h1><div class="count">Messagerie et listes entre amis · privé</div></div></div>${tabsHTML(cur)}${body}</div>`);

// ---------- Messages ----------
async function renderConvos(el) {
  el.innerHTML = page("messages", `<div id="convos"><p class="loading">Chargement…</p></div>`);
  const L = await loadConversations();
  const fr = friendsList();
  $("convos").innerHTML = (fr.length ? `<div class="soc-new"><label class="sortsel">Nouveau message à <select id="newChat"><option value="">choisir un ami…</option>${fr.map(f => `<option value="${f.uid}">${esc(person(f.uid).username)}</option>`).join("")}</select></label></div>` : "")
    + (L.length ? `<ul class="convos">${L.map(c => `<li><a class="convo${c.unread ? " unread" : ""}" href="#/amis/chat/${c.uid}">${av(c.uid)}
        <span class="cv-t"><b>${esc(person(c.uid).username)}</b><span>${c.last.sender === ME.user.id ? "Toi : " : ""}${esc(tokenPreview(c.last.body).slice(0, 90))}</span></span>
        <span class="cv-m"><time>${ago(c.last.created_at)}</time>${c.unread ? `<span class="nb">${c.unread}</span>` : ""}</span></a>
        <button type="button" class="cv-del" data-clear="${c.uid}" title="Supprimer la conversation" aria-label="Supprimer la conversation avec ${esc(person(c.uid).username)}">🗑</button></li>`).join("")}</ul>`
      : `<div class="empty"><p>Aucune conversation pour l'instant.</p><p class="hint">${fr.length ? "Choisis un ami ci-dessus pour lui écrire." : "Ajoute d'abord des amis (onglet « Amis ») : la messagerie est réservée aux amis."}</p>${fr.length ? "" : `<a class="btn primary" href="#/amis/amis">Ajouter un ami</a>`}</div>`);
  const s = $("newChat"); if (s) s.addEventListener("change", () => { if (s.value) location.hash = "#/amis/chat/" + s.value; });
  $("convos").onclick = async e => {
    const b = e.target.closest("[data-clear]"); if (!b) return;
    if (await askClear(b.dataset.clear)) renderConvos(el);
  };
}
/** Confirmation puis suppression de la conversation (de ton côté uniquement). */
async function askClear(uid) {
  const name = person(uid).username;
  if (!confirm(`Supprimer la conversation avec ${name} ?\n\nElle disparaît de ta messagerie uniquement : ${name} garde sa copie. Si quelque chose ne va pas avec cette personne, signale-la avant de supprimer.`)) return false;
  try { await clearConversation(uid); toast("Conversation supprimée"); return true; }
  catch (err) { toast(/clear_conversation|PGRST202|42883/.test((err && (err.message + err.code)) || "") ? "Cette fonction sera disponible après la mise à jour de la base de données." : socialError(err)); return false; }
}

function bubble(m) {
  const mine = m.sender === ME.user.id;
  return `<div class="msg${mine ? " mine" : ""}" data-id="${m.id}"><div class="bub">${messageHTML(m.body)}</div>
    <div class="msg-m"><time title="${new Date(m.created_at).toLocaleString("fr-FR")}">${ago(m.created_at)}</time>${mine ? (m.read_at ? " · vu" : "") : ""}
    <button type="button" class="linkbtn" data-msg="${mine ? "del" : "report"}">${mine ? "supprimer" : "signaler"}</button></div></div>`;
}
function paintThread(scroll = true) {
  const box = $("thread"); if (!box) return;
  let lastDay = "", h = "";
  for (const m of thread) {
    const d = new Date(m.created_at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    if (d !== lastDay) { h += `<div class="day">${d}</div>`; lastDay = d; }
    h += bubble(m);
  }
  box.innerHTML = (thread.length >= 60 ? `<button type="button" class="linkbtn more-old" id="older">Messages plus anciens</button>` : "") + (h || `<p class="hint center">Écris le premier message 👋</p>`);
  if (scroll) box.scrollTop = box.scrollHeight;
}
async function renderChat(el, uid) {
  chatUid = uid;
  await loadFriends().catch(() => {});
  await loadPeople([uid]);
  const friend = isFriend(uid);
  el.innerHTML = `<div class="page soc chat-page">
    <div class="chat-h"><a class="back" href="#/amis">←</a>${av(uid)}<a class="chat-name" href="#/amis/membre/${uid}">${esc(person(uid).username)}</a><button type="button" class="btn sm danger-o chat-rep" id="chatReport" title="Signaler ${esc(person(uid).username)}">🚩 Signaler</button><button type="button" class="btn sm" id="chatClear" title="Supprimer la conversation" aria-label="Supprimer la conversation">🗑</button></div>
    ${person(uid).mixed ? mixedBanner() : ""}
    <div class="thread" id="thread"><p class="loading">Chargement…</p></div>
    ${friend ? `<form class="composer" id="composer"><button type="button" class="btn icon" id="shareBtn" title="Partager un animé, un personnage ou un fan art" aria-label="Partager une image">🖼️</button><textarea id="msgIn" rows="1" maxlength="2000" placeholder="Écrire un message…" aria-label="Message"></textarea><button class="btn primary" type="submit">Envoyer</button></form>
      <p class="hint center">Entrée pour envoyer · Maj + Entrée pour aller à la ligne</p>`
      : `<div class="empty"><p>Vous n'êtes pas (ou plus) amis : la conversation est en lecture seule.</p></div>`}
  </div>`;
  thread = await loadThread(uid);
  await prepareTokens(thread.map(m => m.body));
  paintThread();
  markRead(uid).catch(() => {});
  $("chatReport").addEventListener("click", () => reportFlow(uid, {}));
  $("chatClear").addEventListener("click", async () => { if (await askClear(uid)) location.hash = "#/amis"; });
  const box = $("thread");
  box.addEventListener("click", async e => {
    if (e.target.id === "older") { const more = await loadThread(uid, thread[0].created_at); thread = more.concat(thread); paintThread(false); return; }
    const b = e.target.closest("[data-msg]"); if (!b) return;
    const id = +b.closest(".msg").dataset.id, m = thread.find(x => x.id === id);
    if (b.dataset.msg === "del") { if (!confirm("Supprimer ce message (pour vous deux) ?")) return; try { await deleteMessage(id); thread = thread.filter(x => x.id !== id); paintThread(false); } catch (err) { toast(socialError(err)); } }
    else await reportFlow(uid, { messageId: id });
  });
  const f = $("composer");
  if (f) {
    const ta = $("msgIn");
    const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; };
    ta.addEventListener("input", grow);
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } });
    f.addEventListener("submit", async e => {
      e.preventDefault(); const t = ta.value.trim(); if (!t) return;
      const b = f.querySelector("button"); b.disabled = true;
      try { const m = await sendMessage(uid, t); thread.push(m); ta.value = ""; grow(); paintThread(); }
      catch (err) { toast(socialError(err)); } finally { b.disabled = false; ta.focus(); }
    });
    $("shareBtn").addEventListener("click", async () => {
      const tok = await sharePicker(fanartPickerSource, {
        sourceRe: SOURCE_RE, error: socialError,
        send: v => uploadChatImage(v.file, uid, { minor: person(uid).mixed || !isAdultMe() })
      }); if (!tok) return;
      try { const m = await sendMessage(uid, tok); await prepareTokens([tok]); thread.push(m); paintThread(); }
      catch (err) { toast(socialError(err)); }
    });
    ta.focus();
  }
  // secours si le direct n'est pas disponible : on regarde toutes les 15 s
  clearInterval(poll);
  poll = setInterval(async () => {
    if (chatUid !== uid || !$("thread")) { clearInterval(poll); return; }
    const fresh = await loadThread(uid).catch(() => null);
    if (fresh && fresh.length && (!thread.length || fresh[fresh.length - 1].id !== thread[thread.length - 1].id)) { thread = fresh; paintThread(); markRead(uid).catch(() => {}); }
  }, 15000);
  if (offMsg) offMsg();
  offMsg = onMessage(async m => {
    if (chatUid === uid && m.sender === uid && $("thread")) { await prepareTokens([m.body]); thread.push(m); paintThread(); markRead(uid).catch(() => {}); }
    else if (m.sender !== uid) toast(`💬 Nouveau message de ${person(m.sender).username}`);
  });
}

/** Signaler un message ou un membre, avec motif, contexte facultatif et blocage. */
async function reportFlow(uid, { messageId }) {
  const name = person(uid).username;
  const r = await reportDialog({ name, message: !!messageId, canContext: true });
  if (!r) return;
  try {
    await report({ messageId, targetUser: uid, reason: r.reason, category: r.category, context: r.context });
    if (r.block) { await blockUser(uid); toast(`Signalement envoyé et ${name} bloqué·e. Merci 🙏`, 4500); location.hash = "#/amis"; }
    else toast("Merci, le signalement a été transmis à l'administrateur 🙏", 4500);
  } catch (err) { toast(socialError(err)); }
}

// ---------- Activité des amis ----------
const ACT = { episode_post: "a discuté d'un épisode de", status_watched: "a terminé", status_watching: "a commencé", rating: "a noté", favorite: "a eu un coup de cœur pour", fanart: "a publié un fan art", comment: "a donné son avis sur" };
async function renderActivity(el) {
  el.innerHTML = page("activite", `<div id="act"><p class="loading">Chargement…</p></div>`);
  let L;
  try { L = await friendsActivity(); } catch { $("act").innerHTML = `<div class="empty"><p>Le fil d'activité arrive bientôt.</p><p class="hint">Il s'active dès que la base de données est mise à jour (script SQL 20261117080000).</p></div>`; return; }
  const ok = adultAllowed();
  L = L.filter(x => !x.anime_id || !byId.get(x.anime_id) || !byId.get(x.anime_id).adult || ok);
  await loadPeople(L.map(x => x.user_id)).catch(() => {});
  const share = ME.profile && ME.profile.share_activity;
  const tip = `<p class="hint act-tip">${share ? "✓ Tes amis voient aussi ton activité." : "Ton activité n'est pas partagée."} <a href="#/compte">Régler dans Mon compte</a></p>`;
  if (!L.length) { $("act").innerHTML = tip + `<div class="empty"><p>Rien pour l'instant.</p><p class="hint">Quand tes amis activent le partage d'activité, tu vois ici ce qu'ils commencent, terminent, notent ou publient.</p></div>`; return; }
  $("act").innerHTML = tip + `<ul class="acts">${L.map(x => {
    const a = x.anime_id ? byId.get(x.anime_id) : null;
    const what = x.kind === "rating" ? `${ACT.rating} ${"★".repeat(x.value || 0)}` : ACT[x.kind] || "";
    const href = x.kind === "fanart" ? `#/fanarts/${x.ref}` : a ? `#/anime/${a.id}` : "#/amis";
    return `<li><a class="act" href="${href}">${av(x.user_id)}<span><span><b>${esc(person(x.user_id).username)}</b> ${what}${a ? ` <b>${esc(titleOf(a))}</b>` : ""}</span><small>${ago(x.created_at)}</small></span>${a && hdUrl(a, "medium") ? `<img src="${esc(hdUrl(a, "medium"))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</a></li>`;
  }).join("")}</ul>`;
}

// ---------- Amis ----------
async function renderFriends(el) {
  el.innerHTML = page("amis", `<div id="fr"><p class="loading">Chargement…</p></div>`);
  await loadFriends();
  const all = [...SOC.friends.values()], rec = all.filter(f => f.status === "received"), sent = all.filter(f => f.status === "sent"), fr = friendsList();
  const blocks = await listBlocks().catch(() => []);
  await loadPeople(blocks.map(b => b.blocked)).catch(() => {});
  const noYear = !(ME.profile && ME.profile.birth_year);
  $("fr").innerHTML = `
    <section class="card2"><h2>Ajouter un ami</h2>
      ${noYear ? `<p class="imp-err" style="margin-top:0">Indique ton année de naissance dans « Mon compte » pour pouvoir ajouter des amis.</p>` : ""}
      <form class="newlist" id="addF"><input type="text" maxlength="20" placeholder="Pseudo exact de ton ami" autocomplete="off" spellcheck="false" aria-label="Pseudo"><button class="btn primary" type="submit">Chercher</button></form>
      <div id="addRes"></div>
      <p class="hint">Pour protéger la vie privée, il n'y a pas d'annuaire : demande son pseudo à ton ami. Mineurs et majeurs peuvent être amis : un message de prévention s'affiche alors, et leurs conversations sont protégées (coordonnées bloquées, analyse automatique).</p></section>
    ${rec.length ? `<section><h2 class="soc-h">Demandes reçues <span class="nb">${rec.length}</span></h2><ul class="people">${rec.map(f => `<li>${av(f.uid)}<b>${esc(person(f.uid).username)}</b><span class="act"><button type="button" class="btn sm primary" data-f="accept" data-u="${f.uid}">Accepter</button><button type="button" class="btn sm" data-f="decline" data-u="${f.uid}">Refuser</button><button type="button" class="linkbtn" data-f="block" data-u="${f.uid}">bloquer</button></span></li>`).join("")}</ul></section>` : ""}
    <section><h2 class="soc-h">Mes amis <span class="hint">${fr.length}</span></h2>
      ${fr.length ? `<ul class="people">${fr.map(f => `<li><a class="pl" href="#/amis/membre/${f.uid}">${av(f.uid)}<b>${esc(person(f.uid).username)}</b></a><span class="act"><a class="btn sm" href="#/amis/chat/${f.uid}">💬 Écrire</a><a class="btn sm" href="#/amis/membre/${f.uid}">Profil</a></span></li>`).join("")}</ul>`
        : `<p class="hint">Pas encore d'amis. Ajoute quelqu'un avec son pseudo ci-dessus.</p>`}</section>
    ${sent.length ? `<section><h2 class="soc-h">Demandes envoyées</h2><ul class="people">${sent.map(f => `<li>${av(f.uid)}<b>${esc(person(f.uid).username)}</b><span class="act"><span class="hint">en attente</span><button type="button" class="linkbtn" data-f="cancel" data-u="${f.uid}">annuler</button></span></li>`).join("")}</ul></section>` : ""}
    ${blocks.length ? `<details class="o-extra"><summary>Personnes bloquées (${blocks.length})</summary><ul class="people">${blocks.map(b => `<li>${av(b.blocked)}<b>${esc(person(b.blocked).username)}</b><span class="act"><button type="button" class="btn sm" data-f="unblock" data-u="${b.blocked}">Débloquer</button></span></li>`).join("")}</ul></details>` : ""}`;
  $("addF").addEventListener("submit", async e => {
    e.preventDefault(); const name = e.target.querySelector("input").value.trim(); if (!name) return;
    const out = $("addRes"); out.innerHTML = `<p class="hint">Recherche…</p>`;
    try {
      const r = await findMember(name);
      if (!r) { out.innerHTML = `<p class="hint">Aucun membre avec ce pseudo exact.</p>`; return; }
      const rel = { friend: "Vous êtes déjà amis", sent: "Demande déjà envoyée", received: "Il ou elle t'a déjà envoyé une demande" }[r.relation];
      out.innerHTML = `<ul class="people"><li>${av(r.user_id)}<b>${esc(r.username)}</b><span class="act">${rel ? `<span class="hint">${rel}</span>` : ""}
        ${r.relation === "none" ? (r.allowed ? `<button type="button" class="btn sm primary" data-f="request" data-u="${r.user_id}">Envoyer une demande d'ami</button>` : `<span class="hint">Impossible d'ajouter cette personne.</span>`) : ""}
        ${r.relation === "received" ? `<button type="button" class="btn sm primary" data-f="accept" data-u="${r.user_id}">Accepter</button>` : ""}</span></li></ul>`;
    } catch (err) { out.innerHTML = `<p class="imp-err">${esc(socialError(err))}</p>`; }
  });
  $("fr").addEventListener("click", async e => {
    const b = e.target.closest("[data-f]"); if (!b) return;
    const uid = b.dataset.u, k = b.dataset.f, name = person(uid).username;
    if ((k === "request" || k === "accept") && person(uid).mixed && !(await preventionDialog(name))) return;
    try {
      if (k === "request") { const s = await sendRequest(uid); toast(s === "accepted" ? `Vous êtes maintenant amis avec ${name} 🎉` : "Demande envoyée"); }
      else if (k === "accept") { await acceptRequest(uid); toast(`Vous êtes maintenant amis avec ${name} 🎉`); }
      else if (k === "decline" || k === "cancel") { await removeFriend(uid); toast(k === "decline" ? "Demande refusée" : "Demande annulée"); }
      else if (k === "block") { if (!confirm(`Bloquer ${name} ? Il ou elle ne pourra plus te contacter.`)) return; await blockUser(uid); toast(`${name} est bloqué·e`); }
      else if (k === "unblock") { await unblock(uid); toast(`${name} est débloqué·e`); }
      renderFriends(el);
    } catch (err) { toast(socialError(err)); }
  });
}

// ---------- Listes partagées ----------
function mosaicOf(ids) {
  const cs = ids.map(id => byId.get(id)).filter(a => a && (!a.adult || adultAllowed())).slice(0, 4);
  return cs.length ? `<div class="mosaic m${cs.length}">${cs.map(a => `<span style="${a.hd ? `background-image:url(${hdUrl(a, "medium")});background-size:cover;background-position:center` : coverStyle(a)}"></span>`).join("")}</div>` : `<div class="mosaic empty-m"><span>Liste vide</span></div>`;
}
async function listCards(lists) {
  const items = await Promise.all(lists.map(l => listItemsOf(l.id).catch(() => [])));
  return `<div class="lgrid">${lists.map((l, i) => `<a class="lcard" href="#/amis/liste/${l.id}">${mosaicOf(items[i].map(x => x.anime_id))}<b>${esc(l.name)}</b>
    <small>${esc(person(l.user_id).username)} · ${items[i].length} titre${items[i].length > 1 ? "s" : ""}${l.member ? " · <span class=\"tag-c\">commune</span>" : ""}</small></a>`).join("")}</div>`;
}
async function renderShared(el) {
  el.innerHTML = page("listes", `<div id="shl"><p class="loading">Chargement…</p></div>`);
  const L = await sharedLists();
  const common = L.filter(l => l.member), seen = L.filter(l => !l.member);
  $("shl").innerHTML = (common.length ? `<h2 class="soc-h">Listes communes <span class="hint">tu peux y ajouter des animés</span></h2>${await listCards(common)}` : "")
    + (seen.length ? `<h2 class="soc-h">Partagées par mes amis</h2>${await listCards(seen)}` : "")
    + (!L.length ? `<div class="empty"><p>Aucune liste partagée avec toi pour l'instant.</p><p class="hint">Pour partager une des tiennes : ouvre-la dans « Mes listes », puis « Partage ».</p><a class="btn" href="#/listes">Mes listes</a></div>`
      : `<p class="hint">Pour partager une de tes listes ou en faire une liste commune : ouvre-la dans <a href="#/listes">Mes listes</a>, puis « Partage ».</p>`);
}

async function renderSharedList(el, lid) {
  el.innerHTML = `<div class="page soc"><p class="loading">Chargement…</p></div>`;
  const L = await sharedLists(), l = L.find(x => x.id === lid);
  if (!l) { el.innerHTML = page("listes", `<div class="empty"><p>Cette liste n'est pas (ou plus) partagée avec toi.</p></div>`); return; }
  const items = await listItemsOf(lid), members = await listMembers(lid).catch(() => []);
  await loadPeople(members.map(m => m.user_id).concat(items.map(i => i.added_by).filter(Boolean)));
  const ok = adultAllowed(), anime = items.map(i => byId.get(i.anime_id)).filter(a => a && (!a.adult || ok));
  el.innerHTML = `<div class="page soc">
    <a class="back" href="#/amis/listes">← Listes partagées</a>
    <div class="cat-top"><div><h1>${esc(l.name)}</h1><div class="count">Liste de <a href="#/amis/membre/${l.user_id}">${esc(person(l.user_id).username)}</a> · <b>${anime.length}</b> titre${anime.length > 1 ? "s" : ""}${l.member ? ` · liste commune avec ${members.map(m => esc(m.user_id === ME.user.id ? "toi" : person(m.user_id).username)).join(", ")}` : ""}</div></div>
      ${l.member ? `<div class="cat-tools"><button type="button" class="btn danger-o" id="leave">Quitter cette liste commune</button></div>` : ""}</div>
    ${l.member ? `<div class="addsearch"><input type="search" id="slq" placeholder="＋ Ajouter un animé à cette liste commune…" autocomplete="off"><div class="sugg2" id="slsugg" hidden></div></div>` : ""}
    ${anime.length ? `<div class="grid">${grid(anime, { remove: l.member })}</div>` : `<div class="empty"><p>Liste vide.</p></div>`}
  </div>`;
  if (!l.member) return;
  $("leave").addEventListener("click", async () => {
    if (!confirm("Quitter cette liste commune ? Tu ne pourras plus la modifier.")) return;
    try { const { removeListMember } = await import("../social.js"); await removeListMember(lid, ME.user.id); toast("Tu as quitté la liste"); location.hash = "#/amis/listes"; } catch (err) { toast(socialError(err)); }
  });
  const q = $("slq"), sugg = $("slsugg");
  q.addEventListener("input", () => {
    const w = norm(q.value).split(" ").filter(Boolean); sugg.hidden = !w.length; if (!w.length) return;
    const res = []; for (const a of A) { if (a.adult && !ok) continue; if (w.every(x => a.hay.includes(x))) { res.push(a); if (res.length >= 8) break; } }
    sugg.innerHTML = res.map(a => `<button type="button" data-add="${a.id}">${cover(a, "mini", "34px")}<span><b>${esc(titleOf(a))}</b><small>${a.year || ""}</small></span></button>`).join("") || `<p class="hint">Aucun titre trouvé.</p>`;
  });
  sugg.addEventListener("click", async e => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    try { await addToSharedList(lid, l.user_id, +b.dataset.add); toast("Ajouté à la liste commune"); renderSharedList(el, lid); } catch (err) { toast(socialError(err)); }
  });
  el.querySelector(".page").addEventListener("click", async e => {
    const b = e.target.closest(".pc-rm"); if (!b) return; e.preventDefault(); e.stopPropagation();
    try { await removeFromSharedList(lid, +b.closest(".pc").dataset.id); toast("Retiré de la liste commune"); renderSharedList(el, lid); } catch (err) { toast(socialError(err)); }
  }, true);
}

// ---------- Membre ----------
async function renderMember(el, uid) {
  el.innerHTML = `<div class="page soc"><p class="loading">Chargement…</p></div>`;
  await loadFriends().catch(() => {}); await loadPeople([uid]);
  const rel = SOC.friends.get(uid), friend = rel && rel.status === "friend";
  const L = friend ? (await sharedLists()).filter(l => l.user_id === uid) : [];
  el.innerHTML = `<div class="page soc">
    <a class="back" href="#/amis/amis">← Amis</a>
    <section class="card2 idcard">${av(uid, "big")}<div class="who"><b>${esc(person(uid).username)}</b>
      <span class="hint">${friend ? `Ami·e depuis le ${new Date(rel.since).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}` : rel ? "Demande d'ami en cours" : "Vous n'êtes pas amis"}</span>
      <div class="avbtns">${friend ? `<a class="btn sm primary" href="#/amis/chat/${uid}">💬 Écrire</a><button type="button" class="btn sm" data-m="remove">Retirer des amis</button>` : ""}
        <button type="button" class="btn sm" data-m="block">Bloquer</button><button type="button" class="btn sm danger-o" data-m="report">Signaler</button></div></div></section>
    ${friend ? `<h2 class="soc-h">Ses listes partagées</h2>${L.length ? await listCards(L) : `<p class="hint">${esc(person(uid).username)} ne partage aucune liste pour l'instant.</p>`}` : ""}
  </div>`;
  el.querySelector(".idcard").addEventListener("click", async e => {
    const b = e.target.closest("[data-m]"); if (!b) return; const name = person(uid).username;
    try {
      if (b.dataset.m === "remove") { if (!confirm(`Retirer ${name} de tes amis ? Vos listes communes ne seront plus partagées.`)) return; await removeFriend(uid); toast("Retiré de tes amis"); location.hash = "#/amis/amis"; }
      else if (b.dataset.m === "block") { if (!confirm(`Bloquer ${name} ? Il ou elle ne pourra plus te contacter ni te retrouver.`)) return; await blockUser(uid); toast(`${name} est bloqué·e`); location.hash = "#/amis/amis"; }
      else await reportFlow(uid, {});
    } catch (err) { toast(socialError(err)); }
  });
}

// ---------- Entrée ----------
export function render(el, sub, rest) {
  root = el; route = [sub, ...(rest || [])]; chatUid = null; clearInterval(poll); if (offMsg) { offMsg(); offMsg = null; }
  if (!ME.user) { el.innerHTML = gate("Amis", "Ajoute tes amis, discute avec eux et partage tes listes d'animés."); return; }
  if (!ME.ready || SOC.enabled === null) { el.innerHTML = `<div class="page"><p class="loading">Chargement…</p></div>`; return; }
  if (tooYoungYear(ME.profile && ME.profile.birth_year)) { el.innerHTML = page("", `<div class="empty"><p>🔒 Fonction réservée aux 15 ans et plus.</p><p class="hint">En France, avant 15 ans, il faut l'accord d'un parent pour échanger avec d'autres membres. Ta collection, tes listes et tout le catalogue restent accessibles.</p></div>`); return; }
  if (SOC.enabled === false) { el.innerHTML = page("", `<div class="empty"><p>Les amis et la messagerie arrivent très bientôt.</p><p class="hint">Cette fonction s'active dès que la base de données est mise à jour (script SQL 20261116000000).</p><button type="button" class="btn" id="socRetry">Réessayer</button></div>`);
    $("socRetry").addEventListener("click", () => refreshCounters());
    refreshCounters(); return; }
  if (!ME.profile || !ME.profile.username) { el.innerHTML = page("", `<div class="empty"><p>Choisis d'abord un pseudo : c'est grâce à lui que tes amis te trouvent.</p><a class="btn primary" href="#/compte">Choisir mon pseudo</a></div>`); return; }
  const go = { messages: renderConvos, amis: renderFriends, listes: renderShared, activite: renderActivity }[sub || "messages"];
  const p = go ? go(el) : sub === "chat" ? renderChat(el, rest[0]) : sub === "membre" ? renderMember(el, rest[0]) : sub === "liste" ? renderSharedList(el, rest[0]) : renderConvos(el);
  Promise.resolve(p).catch(err => { console.error(err); el.innerHTML = page("", `<div class="empty"><p>${esc(socialError(err))}</p></div>`); });
}
onSocial(what => {
  if (!isShown()) return;
  if (what === "enabled") render(root, route[0], route.slice(1));
  if (what === "counters") { const t = root.querySelector(".tabs2"); if (t) t.outerHTML = tabsHTML(curTab); }
});
