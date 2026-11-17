// Pages publiques, partageables par lien : profil (#/u/<pseudo>) et liste (#/l/<id>).
// Le lien à partager est https://animetheque.vercel.app/u/<pseudo> (ou /l/<id>) : il affiche un aperçu sur
// Discord, WhatsApp, Instagram… (fonction Vercel api/share.js) puis ouvre la page.
import { supabase } from "../supabase.js";
import { byId } from "../data.js";
import { adultAllowed } from "../state.js";
import { esc, fmt, grid, row } from "../ui.js";
import { toast } from "../toast.js";

let root = null;
const isShown = () => !!(root && root.isConnected && (root.dataset.view === "u" || root.dataset.view === "l"));
export const shareUrl = (kind, id) => `${location.origin}/${kind}/${encodeURIComponent(id)}`;
const visible = ids => (ids || []).map(id => byId.get(id)).filter(a => a && (!a.adult || adultAllowed()));

/** Partager un lien : feuille de partage du téléphone, sinon copie dans le presse-papiers. */
export async function shareLink(url, title) {
  if (navigator.share) { try { await navigator.share({ url, title }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(url); toast("Lien copié : colle-le où tu veux 📋"); }
  catch { prompt("Copie ce lien :", url); }
}

const notFound = (el, what) => { el.innerHTML = `<div class="page"><div class="empty"><p>${what} n'existe pas ou n'est pas public.</p><a class="btn" href="#/">Retour à l'accueil</a></div></div>`; };

async function renderProfile(el, name) {
  el.innerHTML = `<div class="page"><p class="loading">Chargement du profil…</p></div>`;
  if (!supabase) return notFound(el, "Ce profil");
  const { data: p } = await supabase.rpc("public_profile", { name });
  if (!isShown()) return;
  if (!p) return notFound(el, "Ce profil");
  const c = p.counts || {}, since = p.since ? new Date(p.since).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "";
  el.innerHTML = `<div class="page pub">
    <div class="pub-h"><div class="pub-av">${esc((p.username || "?")[0].toUpperCase())}</div>
      <div><h1>${esc(p.username)}</h1><p class="hint">Membre de l'Animéthèque${since ? ` depuis ${since}` : ""}</p></div>
      <button type="button" class="btn" data-share>📤 Partager</button></div>
    <section class="stats2">
      <div class="st-n"><b>${fmt(c.watched || 0)}</b><span>vus</span></div><div class="st-n"><b>${fmt(c.watching || 0)}</b><span>en cours</span></div>
      <div class="st-n"><b>${fmt(c.favorites || 0)}</b><span>coups de cœur</span></div><div class="st-n"><b>${fmt(c.plan || 0)}</b><span>à voir</span></div></section>
    ${row("Coups de cœur", visible(p.favorites))}
    ${row("Notés ★★★★★", visible(p.top_rated))}
    ${row("En train de regarder", visible(p.watching))}
    ${(p.lists || []).length ? `<section class="row"><div class="row-h"><h2>Listes</h2></div><div class="pub-lists">${p.lists.map(l => `<a class="lcard" href="#/l/${l.id}"><b>${esc(l.name)}</b><small>${l.count} titre${l.count > 1 ? "s" : ""}</small></a>`).join("")}</div></section>` : ""}
    <p class="hint center">Envie de partager tes goûts toi aussi ? Active ton profil public dans <a href="#/compte">Mon compte</a>.</p>
  </div>`;
  el.querySelector("[data-share]").onclick = () => shareLink(shareUrl("u", p.username), `Le profil anime de ${p.username}`);
}

async function renderList(el, id) {
  el.innerHTML = `<div class="page"><p class="loading">Chargement de la liste…</p></div>`;
  if (!supabase || !/^[0-9a-f-]{36}$/.test(id)) return notFound(el, "Cette liste");
  const { data: l } = await supabase.rpc("public_list", { lid: id });
  if (!isShown()) return;
  if (!l) return notFound(el, "Cette liste");
  const items = visible(l.items);
  el.innerHTML = `<div class="page pub">
    <div class="cat-top"><div><h1>${esc(l.name)}</h1><div class="count"><b>${items.length}</b> titre${items.length > 1 ? "s" : ""} · liste de ${l.owner_public ? `<a href="#/u/${encodeURIComponent(l.owner)}">${esc(l.owner)}</a>` : esc(l.owner)}</div></div>
      <div class="cat-tools"><button type="button" class="btn" data-share>📤 Partager</button></div></div>
    ${items.length ? `<div class="grid">${grid(items)}</div>` : `<div class="empty"><p>Cette liste est vide pour l'instant.</p></div>`}
  </div>`;
  el.querySelector("[data-share]").onclick = () => shareLink(shareUrl("l", l.id), `${l.name} · liste de ${l.owner}`);
}

export function render(el, sub) {
  root = el;
  const kind = el.dataset.view, id = decodeURIComponent(sub || "");
  return kind === "u" ? renderProfile(el, id) : renderList(el, id);
}
