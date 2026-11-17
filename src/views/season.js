// Vue « Saison » (#/saison, #/saison/prochaine) : les animés de la saison en cours et de la suivante,
// ce que regardent tes amis, et un lien vers le calendrier des épisodes de la semaine.
import { A, T, tr, FRANCHISE } from "../data.js";
import { ME, adultAllowed, inCollection } from "../state.js";
import { esc, grid, row } from "../ui.js";
import { friendsActivity } from "../social.js";
import { supabase } from "../supabase.js";

let root = null;
const isShown = () => !!(root && root.isConnected && root.dataset.view === "saison");
const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];

/** Saison en cours (hiver = janvier-mars…) et la suivante. */
export function currentSeason(d = new Date()) {
  const i = Math.floor(d.getMonth() / 3), y = d.getFullYear();
  return { cur: { s: SEASONS[i], y }, next: { s: SEASONS[(i + 1) % 4], y: i === 3 ? y + 1 : y } };
}
export const seasonLabel = ({ s, y }) => `${tr("season", s)} ${y}`;
export function seasonTitles({ s, y }, adultOk = adultAllowed()) {
  const si = T.season.indexOf(s);
  return A.filter(a => a.season === si && a.year === y && (!a.adult || adultOk));
}

export const tabsHTML = cur => `<nav class="tabs2" aria-label="Saison et calendrier">
  <a href="#/saison" class="${cur === "cur" ? "on" : ""}">🌸 Saison en cours</a>
  <a href="#/saison/prochaine" class="${cur === "next" ? "on" : ""}">⏭ Saison prochaine</a>
  <a href="#/calendrier" class="${cur === "cal" ? "on" : ""}">📅 Épisodes de la semaine</a></nav>`;

export function render(el, sub) {
  root = el;
  const { cur, next } = currentSeason(), which = sub === "prochaine" ? next : cur;
  const L = seasonTitles(which);
  const fmt = i => T.format[i];
  const series = L.filter(a => ["TV", "TV_SHORT", "ONA"].includes(fmt(a.format)));
  const films = L.filter(a => ["MOVIE", "SPECIAL", "OVA"].includes(fmt(a.format)));
  const isNext = which === next;
  // « le retour de… » : la franchise contient une œuvre plus ancienne (ou le titre l'indique)
  const older = a => { const f = FRANCHISE.get(a.id); return !!f && f.list.some(x => x.a !== a && x.a.year && x.a.year < a.year); };
  const sequels = series.filter(a => older(a) || /season|saison|\b(2nd|3rd|\d+th)\b|part\s*\d|第.期|\b[2-9]\b\s*$/i.test((a.english || "") + " " + a.romaji));
  const fresh = series.filter(a => !sequels.includes(a));
  el.innerHTML = `<div class="page season-page">
    <div class="cat-top"><div><h1>${esc(seasonLabel(which))}</h1>
      <div class="count"><b>${L.length}</b> titres ${isNext ? "annoncés" : "cette saison"} · ${series.length} séries, ${films.length} films et spéciaux</div></div></div>
    ${tabsHTML(isNext ? "next" : "cur")}
    <div id="seasonFriends"></div>
    ${row(isNext ? "Les plus attendus" : "Les plus populaires de la saison", series.slice(0, 20), `#/catalogue?season=${which.s}&year=${which.y}`, isNext ? "D'après le nombre de fans qui les suivent déjà sur AniList" : "")}
    ${row("Nouvelles séries", fresh.slice(0, 20), "", "Des histoires qui commencent : idéal pour découvrir")}
    ${row("Le retour de…", sequels.slice(0, 20), "", "Nouvelles saisons de séries déjà connues")}
    ${films.length ? row("Films et spéciaux", films.slice(0, 20)) : ""}
    <section class="row"><div class="row-h"><h2>Toute la saison</h2><span class="row-sub">Par popularité</span></div>
      <div class="grid">${grid(series.slice(0, 120))}</div></section>
  </div>`;
  if (ME.user && supabase) friendsWatching(which);
}

async function friendsWatching(which) {
  let acts;
  try { acts = await friendsActivity(); } catch { return; }
  const ids = new Set(seasonTitles(which).map(a => a.id));
  const counts = new Map();
  for (const x of acts) if (x.kind === "status_watching" && ids.has(x.anime_id)) {
    const c = counts.get(x.anime_id) || new Set(); c.add(x.username); counts.set(x.anime_id, c);
  }
  const box = isShown() && root.querySelector("#seasonFriends"); if (!box || !counts.size) return;
  const list = [...counts.entries()].sort((a, b) => b[1].size - a[1].size).map(([id]) => A.find(a => a.id === id)).filter(Boolean);
  const names = [...new Set([...counts.values()].flatMap(s => [...s]))];
  box.innerHTML = row("Tes amis regardent", list.slice(0, 20), "#/amis/activite", esc(names.slice(0, 3).join(", ") + (names.length > 3 ? " et d'autres" : "")));
}
