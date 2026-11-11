// Vues « Mes listes » (cartes en mosaïque) et « Liste » (grille, ajout par recherche, renommer, supprimer).
import { A, byId, norm, titleOf, coverStyle } from "../data.js";
import { ME, sortedLists, listItems, createList, renameList, deleteList, setInList, adultAllowed, onChange } from "../state.js";
import { $, esc, fmt, grid } from "../ui.js";
import { toast } from "../toast.js";
import { gate } from "./collection.js";

let root = null, cur = null;

function mosaic(ids) {
  const covers = ids.map(id => byId.get(id)).filter(a => a && a.cov >= 0 && (!a.adult || adultAllowed())).slice(0, 4);
  if (!covers.length) return `<div class="mosaic empty-m"><span>Liste vide</span></div>`;
  return `<div class="mosaic m${covers.length}">${covers.map(a => `<span style="${coverStyle(a)}"></span>`).join("")}</div>`;
}

function renderIndex(el) {
  const L = sortedLists();
  el.innerHTML = `<div class="page">
    <div class="cat-top"><div><h1>Mes listes</h1><div class="count"><b>${L.length}</b> liste${L.length > 1 ? "s" : ""}</div></div></div>
    <form class="newlist big" id="nl"><input type="text" maxlength="40" placeholder="Nom de la nouvelle liste (ex. À revoir, Classiques, Avec les enfants…)" aria-label="Nom de la nouvelle liste"><button class="btn primary" type="submit">Créer la liste</button></form>
    ${L.length ? `<div class="lgrid">${L.map(([id, l]) => { const ids = listItems(id); return `<a class="lcard" href="#/listes/${encodeURIComponent(id)}">${mosaic(ids)}<b>${esc(l.n)}</b><small>${ids.length} titre${ids.length > 1 ? "s" : ""}</small></a>`; }).join("")}</div>`
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

function renderList(el, lid) {
  const l = ME.lists[lid];
  if (!l) { el.innerHTML = `<div class="page"><div class="empty"><p>Cette liste n'existe pas ou a été supprimée.</p><a class="btn" href="#/listes">Mes listes</a></div></div>`; return; }
  const ids = listItems(lid).filter(id => { const a = byId.get(id); return a && (!a.adult || adultAllowed()); });
  el.innerHTML = `<div class="page">
    <a class="back" href="#/listes">← Mes listes</a>
    <div class="cat-top"><div><h1 id="lName">${esc(l.n)}</h1><div class="count"><b>${ids.length}</b> titre${ids.length > 1 ? "s" : ""}</div></div>
      <div class="cat-tools"><button type="button" class="btn" id="lRename">Renommer</button><button type="button" class="btn danger-o" id="lDel">Supprimer</button></div></div>
    <form class="rename2" id="lRenameForm" hidden><input type="text" maxlength="40" value="${esc(l.n)}" aria-label="Nouveau nom"><button class="btn primary" type="submit">Enregistrer</button><button class="btn" type="button" id="lRenameCancel">Annuler</button></form>
    <div class="addsearch"><input type="search" id="lq" placeholder="＋ Ajouter un animé : tape un titre…" autocomplete="off" aria-label="Ajouter un animé à la liste"><div class="sugg2" id="lsugg" hidden></div></div>
    ${ids.length ? `<div class="grid">${grid(ids.map(id => byId.get(id)), { remove: true })}</div>` : `<div class="empty"><p>Liste vide.</p><p class="hint">Utilise le champ ci-dessus, ou le bouton + sur n'importe quelle affiche du site.</p></div>`}
  </div>`;
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
      return `<button type="button" data-add="${a.id}"${inL ? " disabled" : ""}><span class="cv mini" style="${coverStyle(a)}"></span><span><b>${esc(titleOf(a))}</b><small>${a.year || ""}${inL ? " · déjà dans la liste" : ""}</small></span></button>`; }).join("")
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
  if (!root || !root.isConnected) return;
  if (["collection", "session", "lists", "entry", "profile"].includes(what)) {
    const q = $("lq"), keep = q && document.activeElement === q ? q.value : null;
    render(root, cur && cur.lid);
    if (keep != null && $("lq")) { $("lq").value = keep; $("lq").focus(); $("lq").dispatchEvent(new Event("input")); }
  }
});
