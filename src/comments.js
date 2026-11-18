// « Avis des membres » sous chaque animé : lisibles par tous, un avis par membre (modifiable),
// en français ou en anglais, spoilers masqués, signalement, suppression par l'administrateur.
import { supabase } from "./supabase.js";
import { ME, requireUser } from "./state.js";
import { esc } from "./ui.js";
import { toast } from "./toast.js";
import { tooYoungYear } from "./profile.js";
import { animeComments, saveComment, deleteComment, likeComment, report, socialError, isMissing } from "./social.js";

const MAX = 1500;
let cur = null;   // { box, aid, rows, editing }

const when = d => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const para = s => esc(s).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");

function formHTML(mine) {
  if (!ME.user) return `<div class="cm-cta"><p>Connecte-toi pour donner ton avis sur cet animé.</p><button type="button" class="btn sm primary" data-cm="login">Se connecter</button></div>`;
  if (tooYoungYear(ME.profile && ME.profile.birth_year)) return `<p class="hint">🔒 Publier un avis est réservé aux 15 ans et plus.</p>`;
  if (!(ME.profile && ME.profile.username)) return `<p class="hint">Choisis un pseudo dans <a href="#/compte">Mon compte</a> pour publier un avis.</p>`;
  const v = mine ? mine.body : "";
  return `<form class="cm-form" id="cmForm">
    <label for="cmBody" class="sr">Ton avis</label>
    <textarea id="cmBody" maxlength="${MAX}" rows="3" placeholder="Ton avis sur cet animé, visible par tous les membres (en français ou en anglais)…">${esc(v)}</textarea>
    <div class="cm-f"><label class="chk"><input type="checkbox" id="cmSp"${mine && mine.spoiler ? " checked" : ""}><span>Contient des spoilers</span></label>
      <span class="hint"><span id="cmN">${v.length}</span>/${MAX}</span>
      ${mine ? `<button type="button" class="linkbtn" data-cm="cancel">Annuler</button>` : ""}
      <button type="submit" class="btn sm primary">${mine ? "Enregistrer" : "Publier"}</button></div>
  </form>`;
}
function itemHTML(c) {
  const edited = Date.parse(c.updated_at) - Date.parse(c.created_at) > 60000;
  return `<li class="cm${c.mine ? " mine" : ""}${c.spoiler ? " sp" : ""}" data-id="${c.id}">
    <div class="cm-h"><b>${esc(c.username)}</b>${c.mine ? `<span class="cm-me">toi</span>` : ""}<time>${when(c.created_at)}${edited ? " · modifié" : ""}</time>
      <span class="cm-act">${c.mine ? `<button type="button" class="linkbtn" data-cm="edit">modifier</button><button type="button" class="linkbtn" data-cm="del">supprimer</button>`
        : ME.user ? `<button type="button" class="linkbtn" data-cm="report">signaler</button>${ME.isStaff ? `<button type="button" class="linkbtn danger" data-cm="adel">supprimer (modération)</button>` : ""}` : ""}</span></div>
    ${c.spoiler ? `<button type="button" class="cm-spb" data-cm="reveal">⚠️ Spoiler : cliquer pour afficher</button>` : ""}
    <div class="cm-b"><p>${para(c.body)}</p></div>
    ${c.likes != null ? `<div class="cm-like">${c.mine || !ME.user
      ? (+c.likes ? `<span class="hint">👍 ${c.likes} membre${c.likes > 1 ? "s ont" : " a"} trouvé cet avis utile</span>` : "")
      : `<button type="button" class="cm-lk${c.liked ? " on" : ""}" data-cm="like" aria-pressed="${!!c.liked}">👍 Utile${+c.likes ? ` · ${c.likes}` : ""}</button>`}</div>` : ""}</li>`;
}
function paint() {
  if (!cur || !cur.box.isConnected) return;
  const { rows } = cur, mine = rows.find(r => r.mine);
  const showForm = !mine || cur.editing;
  cur.box.innerHTML = `<h2>Avis des membres <small class="hint">${rows.length ? rows.length : ""}</small></h2>${rows.length > 1 ? `<p class="hint">Les avis jugés les plus utiles par les membres apparaissent en premier.</p>` : ""}
    ${showForm ? formHTML(cur.editing ? mine : null) : ""}
    ${rows.length ? `<ul class="cms">${rows.filter(r => !(r.mine && cur.editing)).map(itemHTML).join("")}</ul>` : `<p class="hint">Aucun avis pour l'instant${ME.user ? " : sois le premier ou la première !" : "."}</p>`}
    <p class="hint cm-rules">Avis publics, en français ou en anglais. Pas d'insulte, de propos haineux ni de spoiler non signalé.</p>`;
  const f = cur.box.querySelector("#cmForm");
  if (f) {
    const ta = f.querySelector("textarea");
    ta.addEventListener("input", () => { cur.box.querySelector("#cmN").textContent = ta.value.length; });
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const body = ta.value.trim();
      if (body.length < 2) { toast("Écris quelques mots 🙂"); return; }
      const b = f.querySelector("button[type=submit]"); b.disabled = true;
      try { await saveComment(cur.aid, body, f.querySelector("#cmSp").checked, cur.editing ? mine.id : null); cur.editing = false; toast("Avis publié"); await load(); }
      catch (err) { toast(err && /23505|duplicate/.test(err.code + err.message) ? "Tu as déjà publié un avis sur cet animé : modifie-le." : socialError(err), 5000); b.disabled = false; }
    });
    if (cur.editing) ta.focus();
  }
}
async function load() {
  const me = cur;
  try { const rows = await animeComments(me.aid); if (cur !== me) return; me.rows = rows || []; paint(); }
  catch (err) { if (cur === me) cur.box.innerHTML = isMissing(err) ? "" : `<h2>Avis des membres</h2><p class="hint">Les avis n'ont pas pu être chargés.</p>`; }
}

/** Monte la section dans `box` pour l'animé `aid`. */
export function mountComments(box, aid) {
  if (!supabase || !box) { if (box) box.remove(); return; }
  cur = { box, aid, rows: [], editing: false };
  box.innerHTML = `<h2>Avis des membres</h2><p class="hint">Chargement…</p>`;
  box.onclick = async e => {
    const b = e.target.closest("[data-cm]"); if (!b || !cur) return;
    const k = b.dataset.cm, li = b.closest(".cm"), c = li && cur.rows.find(r => r.id === li.dataset.id);
    try {
      if (k === "login") requireUser();
      else if (k === "reveal") { li.classList.remove("sp"); b.remove(); }
      else if (k === "like") {
        const on = !c.liked; c.liked = on; c.likes = +c.likes + (on ? 1 : -1); paint();
        try { await likeComment(c.id, on); } catch (err) { c.liked = !on; c.likes = +c.likes + (on ? -1 : 1); paint(); throw err; }
      }
      else if (k === "edit") { cur.editing = true; paint(); }
      else if (k === "cancel") { cur.editing = false; paint(); }
      else if (k === "del" || k === "adel") {
        if (!confirm(k === "del" ? "Supprimer ton avis ?" : `Supprimer l'avis de ${c.username} ?`)) return;
        await deleteComment(c.id); toast("Avis supprimé"); await load();
      } else if (k === "report") {
        const r = prompt("Pourquoi signales-tu cet avis ?", "Spoiler non signalé"); if (!r) return;
        await report({ commentId: c.id, reason: r }); toast("Merci, l'avis a été signalé.");
      }
    } catch (err) { toast(socialError(err)); }
  };
  load();
}
export const refreshComments = () => { if (cur && cur.box.isConnected && !cur.editing) load(); };
