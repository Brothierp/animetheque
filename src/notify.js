// Cloche de notifications : demandes d'amis, fan arts validés, réponses de l'administrateur… (table notifications)
// et nouveaux épisodes des séries « En cours » de la collection (calendrier AniList, calculé dans le navigateur).
import { supabase } from "./supabase.js";
import { ME, onChange } from "./state.js";
import { byId, titleOf, hdUrl, loadCatalogue } from "./data.js";
import { esc } from "./ui.js";
import { person, loadPeople } from "./social.js";

const EP_KEY = "animetheque:episodes";     // nouveaux épisodes déjà connus (par appareil)
let rows = [], episodes = [], open = false, timer = null, missing = false;

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
  p.innerHTML = `<div class="nt-h"><b>Notifications</b>${items.some(i => !i.read) ? `<button type="button" class="linkbtn" data-nt="read">Tout marquer comme lu</button>` : ""}</div>
    ${items.length ? `<div class="nt-l">${items.map(i => i.html).join("")}</div>` : `<p class="hint nt-empty">Rien de nouveau pour l'instant.${missing ? "" : " Tu seras prévenu·e des demandes d'amis, des fan arts validés et des nouveaux épisodes de tes séries en cours."}</p>`}`;
}

async function refresh() {
  if (!ME.user || !supabase) return;
  try {
    const { data, error } = await supabase.from("notifications").select("id, kind, actor, ref, created_at, read_at").order("id", { ascending: false }).limit(40);
    if (error) { missing = true; rows = []; } else { rows = data || []; await loadPeople(rows.map(n => n.actor).filter(Boolean)).catch(() => {}); }
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

export function initNotifications() {
  const wrap = document.createElement("div"); wrap.className = "bell-w";
  wrap.innerHTML = `<button type="button" class="bell" id="bell" hidden aria-haspopup="true" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><span class="nb" hidden></span></button>
    <div class="bell-p" id="bellPanel" hidden></div>`;
  document.querySelector("header .account").before(wrap);
  const b = wrap.querySelector("#bell"), p = wrap.querySelector("#bellPanel");
  const toggle = v => { open = v; p.hidden = !v; b.setAttribute("aria-expanded", v); if (v) paintPanel(); };
  b.addEventListener("click", e => { e.stopPropagation(); toggle(!open); });
  p.addEventListener("click", e => { if (e.target.closest("[data-nt=read]")) { e.stopPropagation(); markAllRead(); } else if (e.target.closest("a")) { toggle(false); markAllRead(); } });
  document.addEventListener("click", e => { if (open && !wrap.contains(e.target)) toggle(false); });
  addEventListener("keydown", e => { if (e.key === "Escape" && open) toggle(false); });
  addEventListener("focus", () => refresh());
  onChange(what => { if (what === "session") { rows = []; episodes = []; paintBell(); } if (what === "collection" || what === "session") refresh(); });
  clearInterval(timer); timer = setInterval(refresh, 120000);
}
