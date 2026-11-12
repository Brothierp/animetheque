// Vue « Admin » (#/admin) : liste des comptes, réservée aux administrateurs (contrôle fait par la base de données).
import { supabase } from "../supabase.js";
import { ME, onChange } from "../state.js";
import { $, esc, fmt } from "../ui.js";
import { toast } from "../toast.js";

let root = null, rows = null, q = "", sort = "created";
const PROV = { google: "Google", email: "E-mail" };
const day = 86400000;
const date = d => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const ago = d => {
  if (!d) return "jamais";
  const n = Math.floor((Date.now() - Date.parse(d)) / day);
  return n <= 0 ? "aujourd'hui" : n === 1 ? "hier" : n < 31 ? `il y a ${n} j` : date(d);
};
// Avec la seule année, l'âge exact dépend du jour d'anniversaire : on affiche « 35-36 ans ».
const age = y => { if (!y) return "—"; const a = new Date().getFullYear() - y; return `${a - 1}-${a} ans`; };

async function load() {
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) throw error;
  rows = data;
}

function filtered() {
  const s = q.trim().toLowerCase();
  let L = rows.filter(r => !s || (r.email || "").toLowerCase().includes(s) || (r.username || "").toLowerCase().includes(s));
  const cmp = { created: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at), last: (a, b) => (Date.parse(b.last_sign_in_at) || 0) - (Date.parse(a.last_sign_in_at) || 0),
    pseudo: (a, b) => (a.username || "~").localeCompare(b.username || "~", "fr"), age: (a, b) => (b.birth_year || 0) - (a.birth_year || 0), titles: (a, b) => b.titles - a.titles }[sort];
  return L.sort(cmp);
}

function paint() {
  if (!root || !root.isConnected || !rows) return;
  const now = Date.now(), L = filtered();
  const stat = (n, label) => `<div class="st-n"><b>${fmt(n)}</b><span>${label}</span></div>`;
  $("admStats").innerHTML = stat(rows.length, "comptes")
    + stat(rows.filter(r => now - Date.parse(r.created_at) < 7 * day).length, "inscrits ces 7 derniers jours")
    + stat(rows.filter(r => r.last_sign_in_at && now - Date.parse(r.last_sign_in_at) < 30 * day).length, "actifs ces 30 derniers jours")
    + stat(rows.filter(r => r.birth_year && new Date().getFullYear() - r.birth_year < 18).length, "mineurs (année de naissance)");
  $("admCount").textContent = `${fmt(L.length)} compte${L.length > 1 ? "s" : ""}${q ? " trouvé" + (L.length > 1 ? "s" : "") : ""}`;
  $("admBody").innerHTML = L.length ? L.map(r => `<tr>
      <td>${r.username ? `<b>${esc(r.username)}</b>` : `<span class="hint">sans pseudo</span>`}${r.user_id === ME.user.id ? ` <span class="adm-me">toi</span>` : ""}</td>
      <td><a href="mailto:${esc(r.email || "")}">${esc(r.email || "—")}</a>${r.email_confirmed ? "" : ` <span class="adm-warn" title="Adresse pas encore confirmée">non confirmé</span>`}</td>
      <td>${age(r.birth_year)}${r.birth_year ? ` <span class="hint">(${r.birth_year})</span>` : ""}</td>
      <td>${esc((r.providers || "").split(", ").map(p => PROV[p] || p).join(", ") || "—")}</td>
      <td>${date(r.created_at)}</td>
      <td>${ago(r.last_sign_in_at)}</td>
      <td class="num">${fmt(r.titles)}</td></tr>`).join("")
    : `<tr><td colspan="7" class="hint">Aucun compte ne correspond.</td></tr>`;
}

function exportCsv() {
  const L = filtered(), cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Pseudo", "E-mail", "E-mail confirmé", "Année de naissance", "Connexion", "Inscription", "Dernière connexion", "Titres dans la collection"].map(cell).join(";")]
    .concat(L.map(r => [r.username, r.email, r.email_confirmed ? "oui" : "non", r.birth_year, r.providers, date(r.created_at), r.last_sign_in_at ? date(r.last_sign_in_at) : "", r.titles].map(cell).join(";")));
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = `animetheque-comptes-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Liste exportée (ouvrable dans Excel ou LibreOffice)");
}

export function render(el) {
  root = el;
  if (!ME.user || !ME.ready) { el.innerHTML = `<div class="page"><p class="loading">Chargement…</p></div>`; return; }
  if (!ME.isAdmin) { el.innerHTML = `<div class="page"><div class="empty"><p>Cette page est réservée à l'administrateur du site.</p><a class="btn" href="#/">Retour à l'accueil</a></div></div>`; return; }
  el.innerHTML = `<div class="page">
    <div class="cat-top"><div><h1>Administration</h1><div class="count">Comptes inscrits. Les collections restent privées : seules ces informations sont visibles.</div></div>
      <div class="cat-tools"><button type="button" class="btn" id="admReload">Actualiser</button><button type="button" class="btn primary" id="admCsv">Exporter (tableur)</button></div></div>
    <section class="stats2" id="admStats"></section>
    <div class="adm-tools">
      <input type="search" id="admQ" placeholder="Rechercher un pseudo ou un e-mail…" value="${esc(q)}" autocomplete="off" aria-label="Rechercher un compte">
      <label class="sortsel"><span class="sr">Trier par</span><select id="admSort">
        <option value="created">Inscription (récentes d'abord)</option><option value="last">Dernière connexion</option>
        <option value="pseudo">Pseudo A → Z</option><option value="age">Âge (plus jeunes d'abord)</option><option value="titles">Titres dans la collection</option></select></label>
      <span class="hint" id="admCount"></span>
    </div>
    <div class="adm-wrap"><table class="adm">
      <thead><tr><th>Pseudo</th><th>E-mail</th><th>Âge</th><th>Connexion</th><th>Inscription</th><th>Dernière connexion</th><th class="num">Titres</th></tr></thead>
      <tbody id="admBody"><tr><td colspan="7" class="hint">Chargement des comptes…</td></tr></tbody>
    </table></div>
  </div>`;
  $("admSort").value = sort;
  $("admSort").addEventListener("change", e => { sort = e.target.value; paint(); });
  $("admQ").addEventListener("input", e => { q = e.target.value; paint(); });
  $("admCsv").addEventListener("click", () => rows && exportCsv());
  $("admReload").addEventListener("click", () => { rows = null; render(el); });
  if (rows) paint();
  else load().then(paint).catch(err => { console.error(err); if ($("admBody")) $("admBody").innerHTML = `<tr><td colspan="7" class="imp-err">La liste n'a pas pu être chargée${/not_admin/.test(err.message || "") ? " : accès refusé" : ""}.</td></tr>`; });
}
onChange(what => { if (root && root.isConnected && (what === "session" || what === "collection")) { if (what === "session") rows = null; render(root); } });
