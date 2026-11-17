// Vue « Fan arts » : galerie des créations des membres (validées par l'administrateur avant publication).
//   #/fanarts                 galerie (récents / les plus aimés)
//   #/fanarts/perso/<id>      fan arts d'un personnage ; #/fanarts/anime/<id> d'un animé
//   #/fanarts/mes             mes fan arts (avec leur statut de vérification)
//   #/fanarts/publier         publier un fan art
//   #/fanarts/<uuid>          un fan art
import { supabase } from "../supabase.js";
import { byId, titleOf } from "../data.js";
import { ME, requireUser, onChange, adultAllowed } from "../state.js";
import { $, esc, fmt } from "../ui.js";
import { toast } from "../toast.js";
import { charById, loadCharacters } from "../chars.js";
import { report, socialError } from "../social.js";
import { messageHTML, sharePicker, uploadFormHTML, bindUploadForm, checkUpload, uploadError, parseTags } from "../safety.js";
import { FA, SOURCE_RE, sourceName, tagsTop, listFanarts, getFanart, toggleLike, deleteFanart, publishFanart, updateFanart } from "../fanart-api.js";

let root = null, sort = "recent", route = [];
const isShown = () => !!(root && root.isConnected && root.dataset.view === "fanarts");
const STATUS = { pending: "⏳ En cours de vérification", approved: "✓ Publié", rejected: "✕ Refusé" };
const PAGE = 48;

const tabs = cur => `<nav class="tabs2" aria-label="Fan arts">
  <a href="#/fanarts" class="${cur === "all" ? "on" : ""}">🎨 Galerie</a>
  <a href="#/fanarts/mes" class="${cur === "mes" ? "on" : ""}">Mes fan arts</a>
  <a href="#/fanarts/publier" class="${cur === "publier" ? "on" : ""}">＋ Publier</a></nav>`;
const head = (sub, extra = "") => `<div class="cat-top"><div><h1>Fan arts</h1><div class="count">${sub}</div></div>${extra}</div>`;
const tile = f => `<a class="fa-t" href="#/fanarts/${f.id}" style="${f.width && f.height ? `aspect-ratio:${f.width}/${f.height}` : ""}">
  <img src="${esc(f.url)}" alt="${esc(f.title)}" loading="lazy" decoding="async">
  <span class="fa-o"><b>${esc(f.title)}</b><small>${f.credit ? `art : ${esc(f.credit)}` : `par ${esc(f.username)}`}${Number(f.likes) ? ` · ♥ ${fmt(Number(f.likes))}` : ""}</small></span>
  ${f.status !== "approved" ? `<span class="fa-st st-${f.status}">${STATUS[f.status]}</span>` : ""}${f.adult ? `<span class="fa-18" title="Contenu 18+">18+</span>` : ""}</a>`;
const tagUrl = t => `#/fanarts/tag/${encodeURIComponent(t)}`;
const tagsHTML = f => (f.adult || (f.tags && f.tags.length)) ? `<div class="fa-tags">${f.adult ? `<a class="tchip t18" href="${tagUrl("18+")}">🔞 18+</a>` : ""}${(f.tags || []).map(t => `<a class="tchip" href="${tagUrl(t)}">#${esc(t)}</a>`).join("")}</div>` : "";
const linkTokens = f => [f.character_id ? `[[perso:${f.character_id}]]` : "", f.anime_id ? `[[anime:${f.anime_id}]]` : ""].join("");

function unavailable(el) {
  el.innerHTML = `<div class="page">${head("Les créations des membres")}<div class="empty"><p>La galerie de fan arts arrive bientôt.</p><p class="hint">Elle s'active dès que la base de données est mise à jour (script SQL 20261116020000).</p></div></div>`;
}

// ---------- Galerie ----------
async function renderGallery(el, filter) {
  let title = "Les créations des membres, vérifiées avant publication";
  if (filter.character) { await loadCharacters().catch(() => {}); const c = charById.get(filter.character); title = `Fan arts de <b>${esc(c ? c.name : "ce personnage")}</b> · <a href="#/fanarts">tout voir</a>`; }
  if (filter.anime) { const a = byId.get(filter.anime); title = `Fan arts de <b>${esc(a ? titleOf(a) : "cet animé")}</b> · <a href="#/fanarts">tout voir</a>`; }
  if (filter.tag) title = `Étiquette <b>${filter.tag === "18+" ? "🔞 18+" : "#" + esc(filter.tag)}</b> · <a href="#/fanarts">tout voir</a>`;
  el.innerHTML = `<div class="page fa-page">${head(title, `<div class="cat-tools"><label class="sortsel"><span class="sr">Trier par</span><select id="faSort"><option value="recent">Les plus récents</option><option value="top">Les plus aimés</option></select></label></div>`)}
    ${tabs(filter.character || filter.anime || filter.tag ? "" : "all")}
    <div class="fa-tagbar" id="faTagbar"></div>
    <div class="fa-grid" id="faGrid"><p class="loading">Chargement…</p></div>
    <p class="center"><button type="button" class="btn" id="faMore" hidden>Voir plus</button></p></div>`;
  $("faSort").value = sort;
  $("faSort").addEventListener("change", e => { sort = e.target.value; renderGallery(el, filter); });
  let offset = 0;
  const more = async () => {
    const rows = await listFanarts({ sort, ...filter, limit: PAGE, offset });
    if (!isShown()) return;
    const g = $("faGrid"); if (!offset) g.innerHTML = "";
    g.insertAdjacentHTML("beforeend", rows.map(tile).join(""));
    offset += rows.length; $("faMore").hidden = rows.length < PAGE;
    if (!offset) g.innerHTML = `<div class="empty"><p>Aucun fan art ${filter.character || filter.anime ? "ici " : ""}pour l'instant.</p><a class="btn primary" href="#/fanarts/publier">Publier le premier</a></div>`;
  };
  $("faMore").addEventListener("click", () => more().catch(err => toast(socialError(err))));
  tagsTop().then(T => {
    const b = isShown() && $("faTagbar"); if (!b) return;
    const L = (adultAllowed() ? [["18+", "🔞 18+"]] : []).concat(T.map(x => [x.tag, "#" + x.tag]));
    b.innerHTML = L.length ? L.map(([t, l]) => `<a class="tchip${filter.tag === t ? " on" : ""}${t === "18+" ? " t18" : ""}" href="${filter.tag === t ? "#/fanarts" : tagUrl(t)}">${esc(l)}</a>`).join("") : "";
  });
  try { await more(); } catch (e) { if (FA.missing) unavailable(el); else $("faGrid").innerHTML = `<div class="empty"><p>La galerie n'a pas pu être chargée.</p></div>`; }
}

// ---------- Mes fan arts ----------
async function renderMine(el) {
  if (!ME.user) { el.innerHTML = `<div class="page">${head("Tes créations")}${tabs("mes")}<div class="gate2"><p>Connecte-toi pour publier et retrouver tes fan arts.</p><button type="button" class="btn primary" data-need-auth>Se connecter ou créer un compte</button></div></div>`; return; }
  el.innerHTML = `<div class="page fa-page">${head("Tes créations et leur vérification")}${tabs("mes")}<div class="fa-grid" id="faGrid"><p class="loading">Chargement…</p></div></div>`;
  try {
    const rows = await listFanarts({ user: ME.user.id, limit: 100 });
    if (!isShown()) return;
    $("faGrid").innerHTML = rows.length ? rows.map(tile).join("") : `<div class="empty"><p>Tu n'as encore rien publié.</p><a class="btn primary" href="#/fanarts/publier">Publier un fan art</a></div>`;
  } catch { if (FA.missing) unavailable(el); }
}

// ---------- Publier ----------
function renderPublish(el) {
  if (!ME.user) { el.innerHTML = `<div class="page">${head("Partage tes dessins")}${tabs("publier")}<div class="gate2"><p>Connecte-toi pour publier un fan art.</p><button type="button" class="btn primary" data-need-auth>Se connecter ou créer un compte</button></div></div>`; return; }
  if (!(ME.profile && ME.profile.username)) { el.innerHTML = `<div class="page">${head("Partage tes dessins")}${tabs("publier")}<div class="empty"><p>Choisis d'abord un pseudo dans <a href="#/compte">Mon compte</a> : il s'affichera sous tes créations.</p></div></div>`; return; }
  let link = { character_id: null, anime_id: null };
  el.innerHTML = `<div class="page fa-page">${head("Partage tes dessins et tes fan arts préférés avec la communauté")}${tabs("publier")}
    <div class="card2 fa-pub">${uploadFormHTML("faForm")}
      <p class="imp-err" id="faErr" hidden></p>
      <p class="fa-send"><button class="btn primary" type="button" id="faSend">Envoyer pour vérification</button></p></div></div>`;
  // champs propres à la galerie : personnage / animé représenté, description
  el.querySelector(".up-note").insertAdjacentHTML("beforebegin", `
    <div><span class="lbl">Personnage ou animé représenté <small class="hint">(facultatif)</small></span><div id="faLink" class="fa-link"></div>
      <button type="button" class="btn sm" id="faPick">Choisir…</button></div>
    <label><span>Description <small class="hint">(facultatif)</small></span><textarea id="faDesc" maxlength="500" rows="3" placeholder="Technique, inspiration… (en français ou en anglais)"></textarea></label>`);
  const read = bindUploadForm($("faForm"));
  const paintLink = () => { $("faLink").innerHTML = link.character_id || link.anime_id ? messageHTML(linkTokens(link)) + `<button type="button" class="linkbtn" id="faUnlink">retirer</button>` : `<span class="hint">Aucun</span>`; };
  paintLink();
  $("faPick").addEventListener("click", async () => {
    const t = await sharePicker(); if (!t) return;
    const m = t.match(/\[\[(anime|perso):(\d+)\]\]/); if (!m) return;
    link = m[1] === "perso" ? { character_id: +m[2], anime_id: null } : { character_id: null, anime_id: +m[2] };
    paintLink();
  });
  $("faLink").addEventListener("click", e => { if (e.target.id === "faUnlink") { link = { character_id: null, anime_id: null }; paintLink(); } else if (e.target.closest("a")) e.preventDefault(); });
  $("faSend").addEventListener("click", async () => {
    const v = read(), bad = checkUpload(v, SOURCE_RE), errBox = $("faErr");
    if (bad) { errBox.textContent = bad; errBox.hidden = false; return; }
    errBox.hidden = true;
    const b = $("faSend"); b.disabled = true; b.textContent = "Envoi…";
    try { await publishFanart(v.file, { title: v.title, description: $("faDesc").value.trim(), credit: v.credit, source_url: v.source_url, tags: v.tags, adult: v.adult, ...link }); toast("Merci ! Ton fan art sera visible après vérification 🎨", 4500); location.hash = "#/fanarts/mes"; }
    catch (err) {
      errBox.textContent = uploadError(err) || (/row-level|42501/.test((err.message || "") + err.code) ? "Envoi refusé : vérifie ton pseudo et réessaie." : socialError(err));
      errBox.hidden = false; b.disabled = false; b.textContent = "Envoyer pour vérification";
    }
  });
}

// ---------- Un fan art ----------
async function renderOne(el, id) {
  el.innerHTML = `<div class="page fa-page"><p class="loading">Chargement…</p></div>`;
  let f;
  try { f = await getFanart(id); } catch { if (FA.missing) return unavailable(el); }
  if (!isShown()) return;
  if (!f) { el.innerHTML = `<div class="page"><div class="empty"><p>Ce fan art n'existe pas ou n'est pas (encore) publié.</p><a class="btn" href="#/fanarts">Voir la galerie</a></div></div>`; return; }
  if (f.character_id) await loadCharacters().catch(() => {});
  const draw = () => {
    el.innerHTML = `<div class="page fa-page fa-one">
      <a class="back" href="#/fanarts">← Galerie</a>
      <figure class="fa-big"><img src="${esc(f.url)}" alt="${esc(f.title)}"></figure>
      <div class="fa-info">
        <h1>${esc(f.title)}</h1>
        ${f.credit || f.source_url ? `<p class="fa-credit">${f.credit ? `🎨 Artiste : <b>${esc(f.credit)}</b>` : ""}${f.credit && f.source_url ? " · " : ""}${f.source_url ? `<a href="${esc(f.source_url)}" target="_blank" rel="noopener noreferrer nofollow">Source : ${esc(sourceName(f.source_url))} ↗</a>` : ""}</p>` : ""}
        <p class="hint">${f.credit ? "publié par" : "par"} <b>${esc(f.username)}</b> · ${new Date(f.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>
        ${f.status !== "approved" ? `<p class="fa-st st-${f.status} inline">${STATUS[f.status]}${f.reject_reason ? ` : ${esc(f.reject_reason)}` : ""}</p>` : ""}
        ${linkTokens(f) ? `<div class="fa-link">${messageHTML(linkTokens(f))}</div>` : ""}
        ${f.description ? `<p class="fa-desc">${esc(f.description).replace(/\n/g, "<br>")}</p>` : ""}
        ${tagsHTML(f)}
        <div class="rep-act">
          ${f.status === "approved" ? `<button type="button" class="btn${f.liked ? " fav on" : ""}" data-x="like">${f.liked ? "♥" : "♡"} ${fmt(Number(f.likes || 0))}</button>` : ""}
          ${f.character_id ? `<a class="btn sm" href="#/fanarts/perso/${f.character_id}">Autres fan arts de ce personnage</a>` : ""}
          ${f.mine && f.tags !== undefined ? `<button type="button" class="btn sm" data-x="tags">Étiquettes</button>` : ""}
          ${f.mine && f.adult !== undefined && (f.adult || adultAllowed()) ? `<button type="button" class="btn sm" data-x="adult">${f.adult ? "Retirer 18+" : "🔞 Marquer 18+"}</button>` : ""}
          ${f.mine ? `<button type="button" class="btn sm" data-x="edit">Modifier</button><button type="button" class="btn sm danger-o" data-x="del">Supprimer</button>`
            : ME.user && f.status === "approved" ? `<button type="button" class="linkbtn" data-x="report">signaler</button>` : ""}
          ${ME.isAdmin && !f.mine ? `<button type="button" class="btn sm danger-o" data-x="del">Supprimer (admin)</button>` : ""}
        </div>
        ${f.status === "approved" ? `<p class="hint">Pour le montrer à un ami : bouton 🖼️ dans la conversation, onglet « Fan art ».</p>` : ""}
      </div></div>`;
  };
  draw();
  el.onclick = async e => {
    const b = e.target.closest("[data-x]"); if (!b) return;
    try {
      if (b.dataset.x === "like") { if (!ME.user) return requireUser(); await toggleLike(f); draw(); }
      else if (b.dataset.x === "del") { if (!confirm("Supprimer définitivement ce fan art ?")) return; await deleteFanart(f); toast("Fan art supprimé"); location.hash = f.mine ? "#/fanarts/mes" : "#/fanarts"; }
      else if (b.dataset.x === "report") { const r = prompt("Pourquoi signales-tu ce fan art ?", "Ce n'est pas l'œuvre de ce membre"); if (!r) return; await report({ fanartId: f.id, reason: r }); toast("Merci, le fan art a été signalé."); }
      else if (b.dataset.x === "tags") {
        const t = prompt("Étiquettes (jusqu'à 8, séparées par des virgules) :", (f.tags || []).join(", ")); if (t === null) return;
        await updateFanart(f.id, { tags: parseTags(t) }); toast("Étiquettes enregistrées"); FA.cache.delete(f.id); renderOne(el, id);
      }
      else if (b.dataset.x === "adult") {
        if (!f.adult && !confirm("Marquer ce fan art 18+ ? Il ne sera plus visible par les mineurs ni par les visiteurs.")) return;
        if (f.adult && !confirm("Retirer l'étiquette 18+ ? Le fan art repassera en vérification.")) return;
        await updateFanart(f.id, { adult: !f.adult }); toast(f.adult ? "18+ retiré : en vérification" : "Marqué 18+"); FA.cache.delete(f.id); renderOne(el, id);
      }
      else if (b.dataset.x === "edit") {
        const t = prompt("Titre :", f.title); if (t === null) return;
        const d = prompt("Description :", f.description || ""); if (d === null) return;
        const cr = f.credit !== undefined ? prompt("Artiste (laisser vide si c'est ton dessin) :", f.credit || "") : null;
        const fields = { title: t.trim().slice(0, 80), description: d.trim().slice(0, 500) || null };
        if (cr !== null) fields.credit = cr.trim().slice(0, 80) || null;
        await updateFanart(f.id, fields);
        toast(t.trim() !== f.title || (d.trim() || null) !== (f.description || null) || (cr !== null && (cr.trim() || null) !== (f.credit || null)) ? "Modifié : le fan art repasse en vérification" : "Enregistré");
        FA.cache.delete(f.id); renderOne(el, id);
      }
    } catch (err) { toast(socialError(err)); }
  };
}

export function render(el, sub, rest = []) {
  root = el; route = [sub, ...rest]; el.onclick = null;
  if (!supabase) { unavailable(el); return; }
  if (!sub) return renderGallery(el, {});
  if (sub === "mes") return renderMine(el);
  if (sub === "publier") return renderPublish(el);
  if (sub === "perso" && +rest[0]) return renderGallery(el, { character: +rest[0] });
  if (sub === "anime" && +rest[0]) return renderGallery(el, { anime: +rest[0] });
  if (sub === "tag" && rest[0]) { let t = rest[0]; try { t = decodeURIComponent(t); } catch {} return renderGallery(el, { tag: t.toLowerCase() }); }
  if (/^[0-9a-f-]{36}$/.test(sub)) return renderOne(el, sub);
  return renderGallery(el, {});
}
onChange(what => { if (isShown() && what === "session") render(root, ...route.slice(0, 1), route.slice(1)); });
