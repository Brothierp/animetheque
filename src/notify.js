// Cloche de notifications : demandes d'amis, fan arts validés, réponses de l'administrateur… (table notifications)
// et nouveaux épisodes des séries « En cours » de la collection (calendrier AniList, calculé dans le navigateur).
import { supabase } from "./supabase.js";
import { ME, onChange } from "./state.js";
import { byId, titleOf, hdUrl, loadCatalogue } from "./data.js";
import { esc } from "./ui.js";
import { person, loadPeople } from "./social.js";
import { pushState, enablePush, pushError } from "./push.js";
import { toast } from "./toast.js";

const EP_KEY = "animetheque:episodes";     // nouveaux épisodes déjà connus (par appareil)
let rows = [], episodes = [], open = false, timer = null, missing = false, pushOffer = false;

const ago = d => {
  const s = (Date.now() - Date.parse(d)) / 1000;
  if (s < 60) return "à l'instant"; if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};
const loadEp = () => { try { return JSON.parse(localStorage.getItem(EP_KEY + ":" + ME.user.id)) || { seen: 0, list: [] }; } catch { return { seen: 0, list: [] }; } };
const saveEp = v => { try { localStorage.setItem(EP_KEY + ":" + ME.user.id, JSON.stringify(v)); } catch {} };

function text(n) {
  const who = n.actor ? `<b>${esc(person(n.actor).username)}</b>` : "";
  switch (n.kind) {
    case "friend_request": return [`${who} t'a envoyé une demande d'ami`, "#/amis/amis", "👥"];
    case "friend_accepted": return [`${who} a accepté ta demande d'ami`, `#/amis/membre/${n.actor}`, "🎉"];
    case "fanart_approved": return ["Ton fan art a été publié dans la galerie", `#/fanarts/${n.ref}`, "🎨"];
    case "fanart_rejected": return ["Ton fan art n'a pas été accepté (motif dans « Mes fan arts »)", "#/fanarts/mes", "🎨"];
    case "feedback_reply": return ["L'administrateur a répondu à ta suggestion", "#/compte", "💡"];
    case "episode_reply": { const [aid, ep] = String(n.ref || "").split(":"); const a = byId.get(+aid);
      return [`${who} t'a répondu sur l'épisode ${esc(ep)}${a ? ` de <b>${esc(titleOf(a))}</b>` : ""}`, `#/anime/${aid}`, "💬"]; }
    case "episode": { const [aid, ep] = String(n.ref || "").split(":"); const a = byId.get(+aid);
      return [`<b>Épisode ${esc(ep)}</b> de ${esc(a ? titleOf(a) : n.title || "ta série")} est sorti`, `#/anime/${aid}`, "📺"]; }
    case "comment_like": { const a = byId.get(+n.ref);
      return [`${who} a trouvé utile ton avis${a ? ` sur <b>${esc(titleOf(a))}</b>` : ""}`, `#/anime/${n.ref}`, "👍"]; }
    case "age_flag": return ["L'équipe de modération a ajusté les accès de ton compte selon ton âge (détails dans « Mon compte »)", "#/compte", "🛡️"];
    case "age_flag_removed": return ["Les accès de ton compte ont été rétablis selon l'année de naissance indiquée", "#/compte", "🛡️"];
    case "test": return ["Notification de test : tout fonctionne 🔔", "#/compte", "🔔"];
    case "chat_image": return [`Une image envoyée par ${who} est maintenant visible`, `#/amis/chat/${n.actor}`, "🖼️"];
    default: return ["Nouvelle notification", "#/", "🔔"];
  }
}
const unread = () => rows.filter(n => !n.read_at).length + episodes.filter(e => !e.read).length;

function paintBell() {
  const b = document.getElementById("bell"); if (!b) return;
  b.hidden = !ME.user;
  const n = unread(), nb = b.querySelector(".nb");
  nb.hidden = !n; nb.textContent = n > 99 ? "99+" : n;
  b.setAttribute("aria-label", n ? `Notifications : ${n} nouvelle${n > 1 ? "s" : ""}` : "Notifications");
}
function paintPanel() {
  const p = document.getElementById("bellPanel"); if (!p) return;
  const items = [
    ...episodes.map(e => { const a = byId.get(e.id); return { t: e.at * 1000, read: e.read, html: `<a class="nt${e.read ? "" : " new"}" href="#/anime/${e.id}">${a && hdUrl(a, "medium") ? `<img src="${esc(hdUrl(a, "medium"))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<i>📺</i>`}<span><span><b>Épisode ${e.ep}</b> de ${esc(a ? titleOf(a) : e.title)} est sorti</span><small>${ago(e.at * 1000)}</small></span></a>` }; }),
    ...rows.map(n => { const [t, href, ico] = text(n); return { t: Date.parse(n.created_at), read: !!n.read_at, html: `<a class="nt${n.read_at ? "" : " new"}" href="${href}"><i>${ico}</i><span><span>${t}</span><small>${ago(n.created_at)}</small></span></a>` }; }),
  ].sort((x, y) => y.t - x.t);
  const offer = pushOffer ? `<button type="button" class="nt-push" data-nt="push">📲 <span><b>Recevoir ces notifications sur cet appareil</b><small>même quand le site est fermé</small></span></button>` : "";
  const acts = (items.some(i => !i.read) ? `<button type="button" class="linkbtn" data-nt="read">Tout marquer comme lu</button>` : "")
    + (items.some(i => i.read) ? `<button type="button" class="linkbtn danger" data-nt="clear">🗑 Supprimer les lues</button>` : "");
  p.innerHTML = `<div class="nt-h"><b>Notifications</b>${acts ? `<span class="nt-acts">${acts}</span>` : ""}</div>
    ${offer}${items.length ? `<div class="nt-l">${items.map(i => i.html).join("")}</div>` : `<p class="hint nt-empty">Rien de nouveau pour l'instant.${missing ? "" : " Tu seras prévenu·e des demandes d'amis, des fan arts validés et des nouveaux épisodes de tes séries en cours."}</p>`}`;
}

async function refresh() {
  if (!ME.user || !supabase) return;
  try {
    const { data, error } = await supabase.from("notifications").select("*").order("id", { ascending: false }).limit(40);
    if (error) { missing = true; rows = []; } else {
      if (data && data.some(n => n.kind === "episode")) {   // épisodes déjà signalés par le serveur : pas de doublon local
        const srv = new Set(data.filter(n => n.kind === "episode").map(n => n.ref));
        episodes = episodes.filter(e => !srv.has(e.id + ":" + e.ep));
      } rows = data || []; await loadPeople(rows.map(n => n.actor).filter(Boolean)).catch(() => {}); }
  } catch { rows = []; }
  await checkEpisodes().catch(() => {});
  paintBell(); if (open) paintPanel();
}

/** Nouveaux épisodes des séries « En cours » (statut AniList « en cours de diffusion »), depuis la dernière vérification. */
async function checkEpisodes() {
  if (!ME.ready) return;
  await loadCatalogue();
  const st = loadEp(), now = Math.floor(Date.now() / 1000);
  const ids = [...ME.entries.entries()].filter(([id, e]) => e.s === "watching" && byId.get(id)).map(([id]) => id).slice(0, 50);
  if (!ids.length) { episodes = st.list; return; }
  const since = st.seen || now - 3 * 86400;   // première fois : les 3 derniers jours
  if (now - (st.checked || 0) < 15 * 60) { episodes = st.list; return; }   // au plus tous les quarts d'heure
  const q = `query($ids:[Int],$s:Int,$e:Int){ Page(perPage:50){ airingSchedules(mediaId_in:$ids, airingAt_greater:$s, airingAt_lesser:$e, sort:TIME_DESC){ airingAt episode mediaId } } }`;
  const r = await fetch("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query: q, variables: { ids, s: since, e: now } }) });
  const d = await r.json();
  const fresh = ((d.data && d.data.Page.airingSchedules) || []).map(x => ({ id: x.mediaId, ep: x.episode, at: x.airingAt, read: false }));
  const known = new Set(st.list.map(e => e.id + ":" + e.ep));
  const list = [...fresh.filter(e => !known.has(e.id + ":" + e.ep)), ...st.list].slice(0, 30);
  saveEp({ seen: now, checked: now, list }); episodes = list;
}

async function markAllRead() {
  const ids = rows.filter(n => !n.read_at).map(n => n.id);
  rows.forEach(n => n.read_at = n.read_at || new Date().toISOString());
  episodes.forEach(e => e.read = true);
  const st = loadEp(); st.list = episodes; saveEp(st);
  paintBell(); paintPanel();
  if (ids.length) await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
}

/** Supprime les notifications déjà lues (base de données et épisodes gardés sur l'appareil). */
async function clearRead() {
  const ids = rows.filter(n => n.read_at).map(n => n.id);
  const keepRows = rows, keepEp = episodes;
  rows = rows.filter(n => !n.read_at);
  episodes = episodes.filter(e => !e.read);
  const n = ids.length + keepEp.length - episodes.length;
  const st = loadEp(); st.list = episodes; saveEp(st);
  paintBell(); paintPanel();
  const done = () => toast(`${n} notification${n > 1 ? "s" : ""} supprimée${n > 1 ? "s" : ""}`);
  if (!ids.length) return done();
  const { error } = await supabase.from("notifications").delete().in("id", ids);
  if (error) { rows = keepRows; episodes = keepEp; paintPanel(); toast("La suppression a échoué. Réessaie dans un instant."); }
  else done();
}

export function initNotifications() {
  const wrap = document.createElement("div"); wrap.className = "bell-w";
  wrap.innerHTML = `<button type="button" class="bell" id="bell" hidden aria-haspopup="true" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><span class="nb" hidden></span></button>
    <div class="bell-p" id="bellPanel" hidden></div>`;
  document.querySelector("header .account").before(wrap);
  const b = wrap.querySelector("#bell"), p = wrap.querySelector("#bellPanel");
  const toggle = v => { open = v; p.hidden = !v; b.setAttribute("aria-expanded", v); if (v) { paintPanel(); if (!missing) pushState().then(st => { const o = st === "off"; if (o !== pushOffer) { pushOffer = o; if (open) paintPanel(); } }).catch(() => {}); } };
  b.addEventListener("click", e => { e.stopPropagation(); toggle(!open); });
  p.addEventListener("click", async e => {
    if (e.target.closest("[data-nt=push]")) { e.stopPropagation(); try { await enablePush(); pushOffer = false; paintPanel(); toast("🔔 Notifications activées sur cet appareil"); } catch (err) { toast(pushError(err), 6000); } return; }
  });
  p.addEventListener("click", e => { if (e.target.closest("[data-nt=read]")) { e.stopPropagation(); markAllRead(); } else if (e.target.closest("[data-nt=clear]")) { e.stopPropagation(); clearRead(); } else if (e.target.closest("a")) { toggle(false); markAllRead(); } });
  document.addEventListener("click", e => { if (open && !wrap.contains(e.target)) toggle(false); });
  addEventListener("keydown", e => { if (e.key === "Escape" && open) toggle(false); });
  addEventListener("focus", () => refresh());
  onChange(what => { if (what === "session") { rows = []; episodes = []; paintBell(); } if (what === "collection" || what === "session") refresh(); });
  clearInterval(timer); timer = setInterval(refresh, 120000);
}
