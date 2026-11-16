// Suggestions : bouton flottant 💡 + fenêtre d'envoi ; section « Mes suggestions » (Mon compte).
import { ME, requireUser } from "./state.js";
import { SOC, onSocial, sendFeedback, myFeedback, replyFeedback, markFeedbackRead, socialError } from "./social.js";
import { esc } from "./ui.js";
import { toast } from "./toast.js";

const $ = id => document.getElementById(id);
export const KIND = { idee: "💡 Idée", bug: "🐞 Bug", autre: "💬 Autre" };
export const STATUS = { nouveau: "Envoyée", lu: "Lue", repondu: "Réponse reçue", clos: "Close" };
const date = d => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

function open() {
  if (!requireUser()) return;
  if (SOC.enabled === false) { toast("Les suggestions seront disponibles après la mise à jour de la base de données."); return; }
  const d = $("fbDlg"); d.querySelector("textarea").value = ""; $("fbMsg").hidden = true; d.showModal(); d.querySelector("textarea").focus();
}

export function initFeedback() {
  document.body.insertAdjacentHTML("beforeend", `
    <button type="button" class="fab" id="fab" aria-label="Proposer une amélioration" title="Une idée, un bug ? Écris-nous">💡<span>Suggestion</span></button>
    <dialog id="fbDlg" class="fb-dlg" aria-labelledby="fbTitle">
      <form method="dialog" class="auth-close"><button class="x" aria-label="Fermer">×</button></form>
      <h2 id="fbTitle">Une idée pour améliorer le site ?</h2>
      <p class="hint">Ton message arrive directement à l'administrateur. Tu verras sa réponse dans « Mon compte → Mes suggestions ».</p>
      <form id="fbForm" class="authform" novalidate>
        <div class="seg seg3" role="radiogroup" aria-label="Type">${Object.entries(KIND).map(([k, v], i) => `<label><input type="radio" name="kind" value="${k}"${i ? "" : " checked"}><span>${v}</span></label>`).join("")}</div>
        <label>Ton message <textarea name="body" maxlength="2000" rows="5" placeholder="Décris ton idée ou le problème rencontré (sur quelle page, ce qui s'est passé…)"></textarea>
          <small><span id="fbCount">0</span>/2000 · la page actuelle est jointe automatiquement</small></label>
        <button class="btn primary" type="submit">Envoyer</button>
      </form>
      <p class="authmsg" id="fbMsg" hidden></p>
    </dialog>`);
  $("fab").addEventListener("click", open);
  const d = $("fbDlg"), f = $("fbForm");
  d.addEventListener("click", e => { if (e.target === d) d.close(); });
  f.elements.body.addEventListener("input", e => { $("fbCount").textContent = e.target.value.length; });
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const body = f.elements.body.value.trim(), m = $("fbMsg");
    if (body.length < 3) { m.textContent = "Écris quelques mots 🙂"; m.className = "authmsg"; m.hidden = false; return; }
    const b = f.querySelector("button[type=submit]"); b.disabled = true;
    try { await sendFeedback(f.elements.kind.value, body); d.close(); toast("Merci ! Ta suggestion a bien été envoyée 💡", 4000); }
    catch (err) { m.textContent = socialError(err); m.className = "authmsg"; m.hidden = false; }
    finally { b.disabled = false; }
  });
}

// ---------- « Mes suggestions » (Mon compte) ----------
export function mySuggestionsHTML() {
  return `<section class="card2" id="suggestions"><h2>Mes suggestions${SOC.counters.feedback_replies ? ` <span class="nb">${SOC.counters.feedback_replies} réponse${SOC.counters.feedback_replies > 1 ? "s" : ""}</span>` : ""}</h2>
    <div id="myFb"><p class="hint">Chargement…</p></div>
    <button type="button" class="btn sm" id="fbNew">💡 Nouvelle suggestion</button></section>`;
}
export function threadHTML(f, replies, mine) {
  return `<div class="fb-thread">
    <div class="fb-msg ${mine ? "me" : "them"}"><div class="bub">${esc(f.body).replace(/\n/g, "<br>")}</div><small>${mine ? "Toi" : esc(f.username || "Membre")} · ${date(f.created_at)}</small></div>
    ${replies.map(r => `<div class="fb-msg ${r.from_admin === mine ? "them" : "me"}"><div class="bub">${esc(r.body).replace(/\n/g, "<br>")}</div><small>${r.from_admin ? "Administrateur" : mine ? "Toi" : esc(f.username || "Membre")} · ${date(r.created_at)}</small></div>`).join("")}
  </div>`;
}
export async function bindMySuggestions() {
  const box = $("myFb"); if (!box) return;
  $("fbNew").addEventListener("click", open);
  if (SOC.enabled === false) { box.innerHTML = `<p class="hint">Les suggestions arrivent bientôt (mise à jour de la base de données).</p>`; return; }
  try {
    const L = await myFeedback();
    box.innerHTML = L.length ? L.map(f => `<details class="fb-item"${f.user_unread ? " open" : ""}><summary><span class="fb-k">${KIND[f.kind]}</span><span class="fb-s">${esc(f.body.slice(0, 80))}${f.body.length > 80 ? "…" : ""}</span>
        <span class="fb-st st-${f.status}">${f.user_unread ? "Nouvelle réponse" : STATUS[f.status]}</span></summary>
        ${threadHTML(f, f.replies, true)}
        ${f.status !== "clos" ? `<form class="fb-reply" data-id="${f.id}"><textarea maxlength="2000" rows="2" placeholder="Répondre…"></textarea><button class="btn sm" type="submit">Envoyer</button></form>` : `<p class="hint">Cette suggestion est close.</p>`}</details>`).join("")
      : `<p class="hint">Tu n'as encore envoyé aucune suggestion. Le bouton 💡 en bas à droite est là pour ça !</p>`;
    if (L.some(f => f.user_unread)) markFeedbackRead().catch(() => {});
    box.addEventListener("submit", async e => {
      const fm = e.target.closest(".fb-reply"); if (!fm) return; e.preventDefault();
      const t = fm.querySelector("textarea").value.trim(); if (!t) return;
      try { await replyFeedback(fm.dataset.id, t); toast("Réponse envoyée"); bindMySuggestionsRefresh(); } catch (err) { toast(socialError(err)); }
    });
  } catch (err) { console.error(err); box.innerHTML = `<p class="hint">Tes suggestions n'ont pas pu être chargées.</p>`; }
}
function bindMySuggestionsRefresh() { const s = $("suggestions"); if (s) { s.outerHTML = mySuggestionsHTML(); bindMySuggestions(); } }
onSocial(what => { if (what === "enabled" && $("suggestions") && ME.user) bindMySuggestionsRefresh(); });
