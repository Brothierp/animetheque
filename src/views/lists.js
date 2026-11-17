// Vues « Mes listes » (cartes en mosaïque) et « Liste » (grille, ajout par recherche, renommer, supprimer).
import { shareUrl, shareLink } from "./public.js";
import { isAdultMe } from "../safety.js";
import { A, byId, norm, titleOf, coverStyle, hdUrl } from "../data.js";
import { ME, sortedLists, listItems, createList, renameList, deleteList, setInList, adultAllowed, onChange } from "../state.js";
import { $, esc, fmt, grid, cover } from "../ui.js";
import { toast } from "../toast.js";
import { gate } from "./collection.js";
import { SOC, friendsList, person, loadFriends, loadPeople, setListVisibility, listMembers, addListMember, removeListMember, socialError } from "../social.js";
import { avatarHTML } from "../profile.js";

let root = null, cur = null;
const isShown = () => !!(root && root.isConnected && root.dataset.view === "listes");   // page réellement affichée ?

function mosaic(ids) {
  const covers = ids.map(id => byId.get(id)).filter(a => a && (a.hd || a.cov >= 0) && (!a.adult || adultAllowed())).slice(0, 4);
  if (!covers.length) return `<div class="mosaic empty-m"><span>Liste vide</span></div>`;
  return `<div class="mosaic m${covers.length}">${covers.map(a => `<span style="${a.hd ? `background-image:url(${hdUrl(a, "medium")});background-size:cover;background-position:center` : coverStyle(a)}"></span>`).join("")}</div>`;
}

function renderIndex(el) {
  const L = sortedLists();
  el.innerHTML = `<div class="page">
    <div class="cat-top"><div><h1>Mes listes</h1><div class="count"><b>${L.length}</b> liste${L.length > 1 ? "s" : ""}</div></div></div>
    <form class="newlist big" id="nl"><input type="text" maxlength="40" placeholder="Nom de la nouvelle liste (ex. À revoir, Classiques, Avec les enfants…)" aria-label="Nom de la nouvelle liste"><button class="btn primary" type="submit">Créer la liste</button></form>
    ${L.length ? `<div class="lgrid">${L.map(([id, l]) => { const ids = listItems(id); return `<a class="lcard" href="#/listes/${encodeURIComponent(id)}">${mosaic(ids)}<b>${esc(l.n)}</b><small>${ids.length} titre${ids.length > 1 ? "s" : ""}${l.v === "friends" ? " · 👥 visible par mes amis" : ""}</small></a>`; }).join("")}</div>`
      : `<div class="empty"><p>Pas encore de liste.</p><p class="hint">Crée une liste ci-dessus, ou depuis le bouton + de n'importe quelle affiche.</p></div>`}
  </div>`;
  $("nl").addEventListener("submit", async e => {
    e.preventDefault(); const i = e.target.querySelector("input");
    const id = await createList(i.value);
    if (id) { toast("Liste créée : ajoute-y des animés"); location.hash = "#/listes/" + encodeURIComponent(id); }
  });
}

function search(q, lid) {
  const words = norm(q).split(" ").filter(Boolean); if (!words.length) return [];
  const ok = adultAllowed(), out = [];
  for (const a of A) { if (a.adult && !ok) continue; if (words.every(w => a.hay.includes(w))) { out.push(a); if (out.length >= 8) break; } }
  return out;
}

/** Panneau « Partage » : visibilité pour les amis, liste commune (amis invités qui peuvent ajouter / retirer). */
async function renderShare(lid) {
  const p = $("lShare"), l = ME.lists[lid]; if (!p || !l) return;
  p.innerHTML = `<h2>Partage</h2><p class="hint">Chargement…</p>`;
  try {
    await loadFriends();
    const members = await listMembers(lid); await loadPeople(members.map(m => m.user_id));
    const fr = friendsList().filter(f => !members.some(m => m.user_id === f.uid));
    p.innerHTML = `<h2>Partage</h2>
      <div class="share-row"><span class="lbl">Qui peut voir cette liste ?</span>
        <div class="seg seg3b"><button type="button" data-vis="private" class="${l.v !== "friends" && l.v !== "public" ? "on" : ""}">🔒 Moi seul${members.length ? " + membres" : ""}</button><button type="button" data-vis="friends" class="${l.v === "friends" ? "on" : ""}">👥 Mes amis</button>${isAdultMe() ? `<button type="button" data-vis="public" class="${l.v === "public" ? "on" : ""}">🌍 Public (lien)</button>` : ""}</div>
        ${l.v === "public" ? `<p class="pub-link"><span>Toute personne qui a le lien peut voir cette liste :</span> <code>${esc(shareUrl("l", lid))}</code> <button type="button" class="btn sm primary" data-pubshare>📤 Partager</button></p>` : ""}</div>
      <div class="share-row"><span class="lbl">Liste commune <span class="hint">· ces amis peuvent ajouter et retirer des animés</span></span>
        <ul class="people">${members.map(m => `<li>${avatarHTML(person(m.user_id).avatar, person(m.user_id).username)}<b>${esc(person(m.user_id).username)}</b><span class="act"><button type="button" class="linkbtn" data-unmember="${m.user_id}">retirer</button></span></li>`).join("") || `<li class="hint">Personne pour l'instant.</li>`}</ul>
        ${fr.length ? `<div class="newlist"><select id="addMember" aria-label="Ami à inviter"><option value="">Inviter un ami…</option>${fr.map(f => `<option value="${f.uid}">${esc(person(f.uid).username)}</option>`).join("")}</select><button type="button" class="btn sm primary" id="addMemberBtn">Inviter</button></div>`
          : `<p class="hint">${members.length ? "Tous tes amis sont déjà membres." : `Ajoute d'abord des amis dans <a href="#/amis/amis">Amis</a>.`}</p>`}</div>`;
    p.onclick = async e => {
      const v = e.target.closest("[data-vis]"), u = e.target.closest("[data-unmember]");
      try {
        if (e.target.closest("[data-pubshare]")) return shareLink(shareUrl("l", lid), l.n);
        if (v) { await setListVisibility(lid, v.dataset.vis); l.v = v.dataset.vis; toast(v.dataset.vis === "friends" ? "Liste visible par tous tes amis" : v.dataset.vis === "public" ? "Liste publique : partage son lien 🌍" : "Liste privée"); renderShare(lid); const b = $("lShareBtn"); if (b) b.textContent = "👥 Partage" + (l.v === "friends" ? " · visible" : ""); }
        else if (u) { await removeListMember(lid, u.dataset.unmember); toast("Membre retiré"); renderShare(lid); }
        else if (e.target.id === "addMemberBtn") { const id = $("addMember").value; if (!id) return; await addListMember(lid, id); toast(`${person(id).username} peut maintenant modifier cette liste`); renderShare(lid); }
      } catch (err) { toast(socialError(err)); }
    };
  } catch (err) { console.error(err); p.innerHTML = `<h2>Partage</h2><p class="imp-err">${esc(socialError(err))}</p>`; }
}

function renderList(el, lid) {
  const l = ME.lists[lid];
  if (!l) { el.innerHTML = `<div class="page"><div class="empty"><p>Cette liste n'existe pas ou a été supprimée.</p><a class="btn" href="#/listes">Mes listes</a></div></div>`; return; }
  const ids = listItems(lid).filter(id => { const a = byId.get(id); return a && (!a.adult || adultAllowed()); });
  el.innerHTML = `<div class="page">
    <a class="back" href="#/listes">← Mes listes</a>
    <div class="cat-top"><div><h1 id="lName">${esc(l.n)}</h1><div class="count"><b>${ids.length}</b> titre${ids.length > 1 ? "s" : ""}</div></div>
      <div class="cat-tools">${SOC.enabled ? `<button type="button" class="btn" id="lShareBtn">👥 Partage${l.v === "friends" ? " · visible" : ""}</button>` : ""}<button type="button" class="btn" id="lRename">Renommer</button><button type="button" class="btn danger-o" id="lDel">Supprimer</button></div></div>
    <section class="card2 share" id="lShare" hidden></section>
    <form class="rename2" id="lRenameForm" hidden><input type="text" maxlength="40" value="${esc(l.n)}" aria-label="Nouveau nom"><button class="btn primary" type="submit">Enregistrer</button><button class="btn" type="button" id="lRenameCancel">Annuler</button></form>
    <div class="addsearch"><input type="search" id="lq" placeholder="＋ Ajouter un animé : tape un titre…" autocomplete="off" aria-label="Ajouter un animé à la liste"><div class="sugg2" id="lsugg" hidden></div></div>
    ${ids.length ? `<div class="grid">${grid(ids.map(id => byId.get(id)), { remove: true })}</div>` : `<div class="empty"><p>Liste vide.</p><p class="hint">Utilise le champ ci-dessus, ou le bouton + sur n'importe quelle affiche du site.</p></div>`}
  </div>`;
  const sb = $("lShareBtn");
  if (sb) sb.addEventListener("click", () => { const p = $("lShare"); p.hidden = !p.hidden; if (!p.hidden) renderShare(lid); });
  $("lRename").addEventListener("click", () => { $("lRenameForm").hidden = false; $("lRenameForm").querySelector("input").select(); });
  $("lRenameCancel").addEventListener("click", () => { $("lRenameForm").hidden = true; });
  $("lRenameForm").addEventListener("submit", async e => { e.preventDefault(); if (await renameList(lid, e.target.querySelector("input").value)) toast("Liste renommée"); });
  $("lDel").addEventListener("click", async () => {
    if (!confirm(`Supprimer la liste « ${l.n} » ? Les animés restent dans ta collection.`)) return;
    if (await deleteList(lid)) { toast("Liste supprimée"); location.hash = "#/listes"; }
  });
  const sugg = $("lsugg");
  $("lq").addEventListener("input", e => {
    const res = search(e.target.value, lid);
    sugg.hidden = !e.target.value.trim();
    sugg.innerHTML = res.length ? res.map(a => { const inL = ME.entries.get(a.id) && ME.entries.get(a.id).l[lid];
      return `<button type="button" data-add="${a.id}"${inL ? " disabled" : ""}>${cover(a, "mini", "34px")}<span><b>${esc(titleOf(a))}</b><small>${a.year || ""}${inL ? " · déjà dans la liste" : ""}</small></span></button>`; }).join("")
      : `<p class="hint">Aucun titre trouvé.</p>`;
  });
  sugg.addEventListener("click", e => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    const id = +b.dataset.add; setInList(id, lid, true); toast(`« ${titleOf(byId.get(id))} » ajouté`);
    cur = { lid, focus: true };
  });
  el.querySelector(".page").addEventListener("click", e => {
    const b = e.target.closest(".pc-rm"); if (!b) return; e.preventDefault(); e.stopPropagation();
    const id = +b.closest(".pc").dataset.id; setInList(id, lid, false); toast("Retiré de la liste");
  }, true);
  if (cur && cur.lid === lid && cur.focus) { $("lq").focus(); cur.focus = false; }
}

export function render(el, sub) {
  root = el; cur = cur && cur.lid === sub ? cur : { lid: sub };
  if (!ME.user) { el.innerHTML = gate("Mes listes", "Crée tes propres listes (À revoir, Classiques, À montrer aux amis…) et ranges-y tes animés."); return; }
  if (!ME.ready) { el.innerHTML = `<div class="page"><p class="loading">Chargement de tes listes…</p></div>`; return; }
  sub ? renderList(el, decodeURIComponent(sub)) : renderIndex(el);
}
onChange(what => {
  if (!isShown()) return;
  if (["collection", "session", "lists", "entry", "profile"].includes(what)) {
    const q = $("lq"), keep = q && document.activeElement === q ? q.value : null;
    render(root, cur && cur.lid);
    if (keep != null && $("lq")) { $("lq").value = keep; $("lq").focus(); $("lq").dispatchEvent(new Event("input")); }
  }
});
