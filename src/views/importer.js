// Import d'une liste existante : AniList (pseudo, liste publique) ou MyAnimeList (fichier d'export XML, .xml ou .xml.gz).
import { A, byId, titleOf } from "../data.js";
import { importEntries, ME } from "../state.js";
import { $, esc, fmt } from "../ui.js";
import { toast } from "../toast.js";

let pending = null;   // { source, items, unknown }
let byMal = null;
const malIndex = () => { if (!byMal) { byMal = new Map(); for (const a of A) if (a.mal) byMal.set(a.mal, a); } return byMal; };
const stars10 = s => s > 0 ? Math.max(1, Math.min(5, Math.round(s / 2))) : 0;

export function importHTML() {
  return `<section class="card2" id="import"><h2>Importer ma liste</h2>
    <p class="hint" style="margin-top:0">Tu as déjà une liste ailleurs ? Récupère tes statuts, notes et épisodes vus. Les titres déjà présents ici sont fusionnés (le statut importé l'emporte, tes avis et listes sont conservés).</p>
    <div class="imp-grid">
      <form id="impAni" class="imp-box"><b>Depuis AniList</b>
        <label class="hint">Ton pseudo AniList (liste publique)<input type="text" name="u" maxlength="40" autocomplete="off" spellcheck="false" placeholder="ex. Pierrot"></label>
        <button class="btn" type="submit">Analyser ma liste AniList</button></form>
      <div class="imp-box"><b>Depuis MyAnimeList</b>
        <span class="hint">Sur MyAnimeList : Profil → <i>Export Lists</i> → Anime, puis choisis le fichier téléchargé (.xml ou .xml.gz).</span>
        <label class="btn" for="impMal" style="cursor:pointer">Choisir le fichier d'export</label><input type="file" id="impMal" accept=".xml,.gz,application/xml,text/xml,application/gzip" hidden></div>
    </div>
    <div id="impResult"></div>
  </section>`;
}

function showPreview() {
  const p = pending, by = s => p.items.filter(x => x.s === s).length;
  $("impResult").innerHTML = `<div class="imp-prev">
    <p><b>${fmt(p.items.length)}</b> titre${p.items.length > 1 ? "s" : ""} reconnu${p.items.length > 1 ? "s" : ""} dans le catalogue${p.unknown ? ` · ${fmt(p.unknown)} absent${p.unknown > 1 ? "s" : ""} du catalogue (ignorés)` : ""}.</p>
    <p class="hint">En cours : ${by("watching")} · À voir : ${by("plan")} · Vu : ${by("watched")} · Abandonné : ${by("dropped")} · Notés : ${p.items.filter(x => x.r).length}</p>
    ${p.items.length ? `<p class="hint">Exemples : ${p.items.slice(0, 5).map(x => esc(titleOf(byId.get(x.id)))).join(", ")}…</p>
    <div class="imp-act"><button type="button" class="btn primary" id="impGo">Importer ${fmt(p.items.length)} titres</button><button type="button" class="btn" id="impCancel">Annuler</button></div>
    <div class="imp-bar" hidden><i></i></div>` : ""}</div>`;
  const go = $("impGo"); if (!go) return;
  $("impCancel").addEventListener("click", () => { pending = null; $("impResult").innerHTML = ""; });
  go.addEventListener("click", async () => {
    go.disabled = true; const bar = $("impResult").querySelector(".imp-bar"); bar.hidden = false;
    try {
      const n = await importEntries(p.items, done => { bar.firstElementChild.style.width = (done / p.items.length * 100) + "%"; });
      $("impResult").innerHTML = `<p class="imp-ok">✓ ${fmt(n)} titres importés depuis ${p.source}. <a href="#/collection/all">Voir ma collection →</a></p>`;
      pending = null; toast("Import terminé : " + fmt(n) + " titres");
    } catch (err) { console.error(err); toast("L'import a échoué. Réessaie dans un instant."); go.disabled = false; }
  });
}

async function fromAniList(user) {
  const q = `query($u:String){ MediaListCollection(userName:$u, type:ANIME){ lists{ entries{ mediaId status progress score(format:POINT_10_DECIMAL) } } } }`;
  const r = await fetch("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query: q, variables: { u: user } }) });
  const d = await r.json();
  if (d.errors) throw new Error(/private/i.test(JSON.stringify(d.errors)) ? "privée" : /not found/i.test(JSON.stringify(d.errors)) ? "introuvable" : "erreur");
  const M = { CURRENT: "watching", REPEATING: "watching", PAUSED: "watching", PLANNING: "plan", COMPLETED: "watched", DROPPED: "dropped" };
  const seen = new Set(), items = []; let unknown = 0;
  for (const l of d.data.MediaListCollection.lists) for (const e of l.entries) {
    if (seen.has(e.mediaId)) continue; seen.add(e.mediaId);
    if (!byId.has(e.mediaId)) { unknown++; continue; }
    items.push({ id: e.mediaId, s: M[e.status] || "", r: stars10(e.score), p: e.progress || 0 });
  }
  return { source: "AniList", items, unknown };
}

async function fromMalFile(file) {
  let text;
  if (/\.gz$/i.test(file.name) || file.type === "application/gzip") {
    if (!("DecompressionStream" in window)) throw new Error("gz");
    text = await new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  } else text = await file.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const nodes = [...doc.getElementsByTagName("anime")];
  if (!nodes.length) throw new Error("format");
  const M = { "watching": "watching", "completed": "watched", "on-hold": "watching", "dropped": "dropped", "plan to watch": "plan" };
  const val = (n, t) => { const x = n.getElementsByTagName(t)[0]; return x ? x.textContent.trim() : ""; };
  const idx = malIndex(), items = []; let unknown = 0;
  for (const n of nodes) {
    const a = idx.get(+val(n, "series_animedb_id"));
    if (!a) { unknown++; continue; }
    const st = val(n, "my_status").toLowerCase(), s = M[st] || M[{ "1": "watching", "2": "completed", "3": "on-hold", "4": "dropped", "6": "plan to watch" }[st]] || "";
    items.push({ id: a.id, s, r: stars10(+val(n, "my_score") || 0), p: +val(n, "my_watched_episodes") || 0 });
  }
  return { source: "MyAnimeList", items, unknown };
}

export function bindImport() {
  const f = $("impAni"); if (!f) return;
  f.addEventListener("submit", async e => {
    e.preventDefault(); const u = f.elements.u.value.trim(); if (!u) return;
    const b = f.querySelector("button"); b.disabled = true; $("impResult").innerHTML = `<p class="hint">Lecture de la liste AniList de ${esc(u)}…</p>`;
    try { pending = await fromAniList(u); showPreview(); }
    catch (err) { $("impResult").innerHTML = `<p class="imp-err">${err.message === "privée" ? "Cette liste AniList est privée. Rends-la publique le temps de l'import (Paramètres AniList → Listes)." : err.message === "introuvable" ? "Aucun compte AniList à ce nom." : "AniList ne répond pas. Réessaie dans un instant."}</p>`; }
    finally { b.disabled = false; }
  });
  $("impMal").addEventListener("change", async e => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    $("impResult").innerHTML = `<p class="hint">Lecture du fichier…</p>`;
    try { pending = await fromMalFile(file); showPreview(); }
    catch (err) { $("impResult").innerHTML = `<p class="imp-err">${err.message === "gz" ? "Ton navigateur ne sait pas ouvrir les fichiers .gz : décompresse-le d'abord (double-clic), puis choisis le fichier .xml." : "Ce fichier ne ressemble pas à un export MyAnimeList (fichier XML de la liste d'animés)."}</p>`; }
  });
}
export const canImport = () => !!(ME.user && ME.ready);
