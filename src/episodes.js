// « Discussions par épisode » sous la fiche d'un animé : un fil par épisode, lisible par tous.
// Anti-spoiler : un épisode n'est déverrouillé que si tu l'as vu (compteur d'épisodes) ou si le titre est « Vu ».
import { supabase } from "./supabase.js";
import { ME, ent, requireUser, setProgress, FEATURES } from "./state.js";
import { byId, T } from "./data.js";
import { esc } from "./ui.js";
import { toast } from "./toast.js";
import { tooYoungYear } from "./profile.js";
import { report, socialError } from "./social.js";

let cur = null;   // { box, aid, counts, open, posts, replyTo }
const call = async q => { const r = await q; if (r.error) throw r.error; return r.data; };
const ago = d => {
  const s = (Date.now() - Date.parse(d)) / 1000;
  if (s < 60) return "à l'instant"; if (s < 3600) return `${Math.floor(s / 60)} min`; if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};

/** Dernier épisode vu : compteur d'épisodes, ou tous si le titre est « Vu ». */
function seenUpTo(a) {
  if (!ME.user) return 0;
  const e = ent(a.id);
  if (e.s === "watched") return Infinity;
  return e.p || 0;
}
/** Nombre d'épisodes à afficher : sortis (séries en cours : d'après la diffusion), sinon tous. */
function episodeCount(a, live) {
  if (live && live.nextAiringEpisode) return Math.max(1, live.nextAiringEpisode.episode - 1);
  return a.eps || Math.max(12, ...Object.keys(cur.counts).map(Number));
}

function gridHTML(a, live) {
  const n = Math.min(episodeCount(a, live), 300), seen = seenUpTo(a), c = cur.counts;
  const items = [];
  for (let i = 1; i <= n; i++) {
    const locked = i > seen, k = c[i] || 0;
    items.push(`<button type="button" class="ep${locked ? " locked" : ""}${cur.open === i ? " on" : ""}${k ? " has" : ""}" data-ep="${i}" title="${locked ? "Épisode pas encore vu : discussion masquée pour éviter les spoilers" : `Épisode ${i}`}">
      <b>${i}</b>${locked ? `<small>🔒</small>` : k ? `<small>💬 ${k}</small>` : ""}</button>`);
  }
  return items.join("");
}
function threadHTML(a) {
  const ep = cur.open, posts = cur.posts || [];
  const byIdP = new Map(posts.map(p => [p.id, p]));
  const canWrite = ME.user && ME.profile && ME.profile.username && !tooYoungYear(ME.profile.birth_year);
  return `<div class="ep-th">
    <div class="ep-th-h"><b>Épisode ${ep}</b><span class="hint">${posts.length} message${posts.length > 1 ? "s" : ""}</span><button type="button" class="x" data-epx="close" aria-label="Fermer">×</button></div>
    ${posts.length ? `<ul class="ep-posts">${posts.map(p => {
      const r = p.reply_to && byIdP.get(p.reply_to);
      return `<li class="ep-post${p.mine ? " mine" : ""}" data-id="${p.id}">
        <div class="ep-meta"><b>${esc(p.username)}</b><time>${ago(p.created_at)}</time>
          <span class="ep-act">${canWrite ? `<button type="button" class="linkbtn" data-epx="reply">répondre</button>` : ""}
          ${p.mine || ME.isStaff ? `<button type="button" class="linkbtn" data-epx="del">supprimer</button>` : ME.user ? `<button type="button" class="linkbtn" data-epx="report">signaler</button>` : ""}</span></div>
        ${r ? `<blockquote class="ep-q">↪ <b>${esc(r.username)}</b> : ${esc(r.body.slice(0, 120))}${r.body.length > 120 ? "…" : ""}</blockquote>` : ""}
        <p>${esc(p.body).replace(/\n/g, "<br>")}</p></li>`;
    }).join("")}</ul>` : `<p class="hint">Personne n'a encore parlé de cet épisode. Lance la discussion !</p>`}
    ${canWrite ? `<form class="ep-form">${cur.replyTo ? `<p class="ep-rep">↪ Réponse à <b>${esc((byIdP.get(cur.replyTo) || {}).username || "")}</b> <button type="button" class="linkbtn" data-epx="noreply">annuler</button></p>` : ""}
        <textarea maxlength="1000" rows="2" placeholder="Ton avis sur l'épisode ${ep} (français ou anglais)…"></textarea><button class="btn sm primary" type="submit">Publier</button></form>`
      : ME.user ? `<p class="hint">${tooYoungYear(ME.profile && ME.profile.birth_year) ? "🔒 Discussions réservées aux 15 ans et plus." : `Choisis un pseudo dans <a href="#/compte">Mon compte</a> pour participer.`}</p>`
      : `<p class="hint"><button type="button" class="linkbtn" data-epx="login">Connecte-toi</button> pour participer.</p>`}
  </div>`;
}

async function paint(a, live) {
  const box = cur.box;
  box.innerHTML = `<h2>Discussions par épisode</h2>
    <p class="hint">Un fil par épisode. ${ME.user ? "Les épisodes que tu n'as pas encore vus restent verrouillés 🔒 : mets ton compteur à jour pour les ouvrir." : "Connecte-toi : les épisodes que tu n'as pas vus resteront verrouillés pour éviter les spoilers."}</p>
    <div class="ep-grid">${gridHTML(a, live)}</div>
    ${cur.open ? threadHTML(a) : ""}`;
}
async function openEp(a, live, ep) {
  cur.open = ep; cur.replyTo = null; cur.posts = null;
  await paint(a, live);
  try { cur.posts = await call(supabase.rpc("episode_thread", { aid: a.id, ep })); } catch { cur.posts = []; }
  if (cur.open === ep && cur.box.isConnected) { await paint(a, live); const t = cur.box.querySelector(".ep-th"); if (t) t.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
}

/** Monte la section dans `box` pour l'animé `aid` ; `liveP` : promesse des infos AniList en direct (prochain épisode). */
export async function mountEpisodes(box, aid, liveP) {
  const a = byId.get(aid);
  if (!supabase || !box || !a || ["MOVIE", "MUSIC"].includes(T.format[a.format])) { if (box) box.remove(); return; }
  cur = { box, aid, counts: {}, open: null, posts: null, replyTo: null };
  const me = cur;
  const [counts, live] = await Promise.all([call(supabase.rpc("episode_counts", { aid })).catch(e => (/PGRST202|function/.test(e.message + e.code) ? null : [])), liveP.catch(() => null)]);
  if (cur !== me || !box.isConnected) return;
  if (counts === null) { box.remove(); return; }   // script SQL pas encore lancé
  for (const c of counts) me.counts[c.episode] = Number(c.posts);
  me.live = live;
  await paint(a, live);
  box.onclick = async e => {
    const b = e.target.closest("[data-ep],[data-epx]"); if (!b || cur !== me) return;
    if (b.dataset.ep) {
      const ep = +b.dataset.ep;
      if (ep > seenUpTo(a)) {
        if (!ME.user) return requireUser();
        if (!FEATURES.progress) return toast("Marque le titre comme « Vu » pour ouvrir toutes les discussions.");
        if (confirm(`Tu n'as pas encore vu l'épisode ${ep} d'après ton compteur.\n\nMarquer les épisodes 1 à ${ep} comme vus et ouvrir la discussion ?`)) {
          setProgress(a.id, ep, a.eps || 0); toast(`Compteur : ${ep} épisode${ep > 1 ? "s" : ""} vu${ep > 1 ? "s" : ""}`); openEp(a, live, ep);
        }
        return;
      }
      return cur.open === ep ? (cur.open = null, paint(a, live)) : openEp(a, live, ep);
    }
    const k = b.dataset.epx, li = b.closest(".ep-post"), post = li && (cur.posts || []).find(p => p.id === li.dataset.id);
    try {
      if (k === "close") { cur.open = null; paint(a, live); }
      else if (k === "login") requireUser();
      else if (k === "reply") { cur.replyTo = post.id; await paint(a, live); const t = box.querySelector(".ep-form textarea"); if (t) t.focus(); }
      else if (k === "noreply") { cur.replyTo = null; paint(a, live); }
      else if (k === "del") { if (!confirm("Supprimer ce message ?")) return; await call(supabase.from("episode_posts").delete().eq("id", post.id)); me.counts[cur.open] = Math.max(0, (me.counts[cur.open] || 1) - 1); openEp(a, live, cur.open); }
      else if (k === "report") { const r = prompt("Pourquoi signales-tu ce message ?", "Spoiler d'un épisode suivant"); if (!r) return; await report({ postId: post.id, reason: r }); toast("Merci, le message a été signalé."); }
    } catch (err) { toast(socialError(err)); }
  };
  box.onsubmit = async e => {
    e.preventDefault(); if (cur !== me) return;
    const t = e.target.querySelector("textarea"), body = t.value.trim(); if (!body) return;
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      await call(supabase.from("episode_posts").insert({ anime_id: a.id, episode: cur.open, body, ...(cur.replyTo ? { reply_to: cur.replyTo } : {}) }));
      me.counts[cur.open] = (me.counts[cur.open] || 0) + 1; openEp(a, live, cur.open);
    } catch (err) { toast(socialError(err)); btn.disabled = false; }
  };
}
/** La collection a changé (compteur d'épisodes) : on redessine la grille pour déverrouiller les épisodes vus. */
export const refreshEpisodes = () => { if (cur && cur.box.isConnected && !cur.box.querySelector(".ep-form textarea:focus")) { const a = byId.get(cur.aid); if (a) paint(a, cur.live); } };
