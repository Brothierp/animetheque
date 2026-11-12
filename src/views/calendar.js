// Vue « Calendrier » : épisodes diffusés cette semaine (données en direct d'AniList), par jour, à l'heure locale.
import { byId, titleOf, coverStyle } from "../data.js";
import { ME, ent, adultAllowed, STATUS_SHORT, onChange, requireUser } from "../state.js";
import { $, esc, cover } from "../ui.js";

let root = null, data = null, loading = null, day = null;
const F = { mine: false, lang: true };
const DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

function weekStart() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
async function fetchWeek() {
  const start = Math.floor(weekStart().getTime() / 1000), end = start + 7 * 86400, out = [];
  const Q = `query($s:Int,$e:Int,$p:Int){ Page(page:$p, perPage:50){ pageInfo{ hasNextPage } airingSchedules(airingAt_greater:$s, airingAt_lesser:$e, sort:TIME){ airingAt episode media{ id isAdult episodes title{ romaji english } coverImage{ medium } } } } }`;
  for (let p = 1; p <= 12; p++) {
    const r = await fetch("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query: Q, variables: { s: start - 1, e: end, p } }) });
    if (!r.ok) throw new Error(r.status);
    const d = (await r.json()).data.Page;
    out.push(...d.airingSchedules);
    if (!d.pageInfo.hasNextPage) break;
  }
  return out;
}

function itemHTML(x) {
  const a = byId.get(x.media.id), e = a ? ent(a.id) : null;
  const t = a ? titleOf(a) : x.media.title.english || x.media.title.romaji;
  const time = new Date(x.airingAt * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const tot = x.media.episodes || (a && a.eps) || 0;
  const href = a ? `#/anime/${a.id}` : `https://anilist.co/anime/${x.media.id}`;
  const cov = a && (a.cov >= 0 || a.hd) ? cover(a, "", "52px") : x.media.coverImage && x.media.coverImage.medium ? `<img class="cv" src="${esc(x.media.coverImage.medium)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="cv none">?</span>`;
  const past = x.airingAt * 1000 < Date.now();
  return `<li class="cal-it${past ? " past" : ""}${e && e.s ? " mine" : ""}">
    <time>${time}</time>
    <a class="cal-cv" href="${href}"${a ? "" : ' target="_blank" rel="noopener"'}>${cov}</a>
    <div class="cal-txt"><a href="${href}"${a ? "" : ' target="_blank" rel="noopener"'}>${esc(t)}</a>
      <span>Épisode ${x.episode}${tot ? " / " + tot : ""}${x.episode === tot ? " · <b>final</b>" : x.episode === 1 ? " · <b>nouveau</b>" : ""}</span>
      <span class="cal-b">${a && a.lang ? [...a.lang].map(l => `<i class="lg ${l}">${l === "F" ? "FR" : "EN"}</i>`).join("") : ""}${e && e.s ? `<i class="b-status s-${e.s}">${STATUS_SHORT[e.s]}</i>` : ""}</span></div>
    ${a ? `<button type="button" class="btn sm" data-quick-add="${a.id}" aria-label="Ajouter « ${esc(t)} » à ma collection">+</button>` : ""}
  </li>`;
}

function paint() {
  if (!root || !root.isConnected || !data) return;
  const ok = adultAllowed(), start = weekStart();
  const visible = data.filter(x => {
    if (x.media.isAdult && !ok) return false;
    const a = byId.get(x.media.id);
    if (a && a.adult && !ok) return false;
    if (F.mine && !(a && ent(a.id).s)) return false;
    if (F.lang && !(a && a.lang)) return false;
    return true;
  });
  const byDay = Array.from({ length: 7 }, () => []);
  for (const x of visible) { const k = Math.floor((x.airingAt * 1000 - start.getTime()) / 86400000); if (k >= 0 && k < 7) byDay[k].push(x); }
  if (day == null) day = 0;
  $("calDays").innerHTML = byDay.map((L, k) => { const d = new Date(start.getTime() + k * 86400000);
    return `<button type="button" class="${k === day ? "on" : ""}" data-day="${k}"><b>${k === 0 ? "Aujourd'hui" : k === 1 ? "Demain" : DAYS[d.getDay()]}</b><small>${d.getDate()}/${d.getMonth() + 1} · ${L.length}</small></button>`; }).join("");
  const L = byDay[day];
  $("calList").innerHTML = L.length ? `<ol class="cal">${L.map(itemHTML).join("")}</ol>`
    : `<div class="empty"><p>${F.mine ? "Aucun épisode de ta collection ce jour-là." : "Aucun épisode ce jour-là avec ces filtres."}</p></div>`;
}

export function render(el) {
  root = el;
  el.innerHTML = `<div class="page">
    <div class="cat-top"><div><h1>Calendrier</h1><div class="count">Les épisodes de la semaine, à ton heure locale (horaire de diffusion au Japon : la version FR/EN arrive en général le jour même ou peu après)</div></div>
      <div class="cat-tools">
        <label class="tgl"><input type="checkbox" id="calMine"${F.mine ? " checked" : ""}> Seulement ma collection</label>
        <label class="tgl"><input type="checkbox" id="calLang"${F.lang ? " checked" : ""}> Dispo en FR ou EN</label>
      </div></div>
    <div class="cal-days" id="calDays"></div>
    <div id="calList"><div class="boot"><div class="spinner" aria-hidden="true"></div><p>Chargement du calendrier…</p></div></div>
  </div>`;
  $("calMine").addEventListener("change", e => { if (e.target.checked && !ME.user) { e.target.checked = false; requireUser(); return; } F.mine = e.target.checked; paint(); });
  $("calLang").addEventListener("change", e => { F.lang = e.target.checked; paint(); });
  $("calDays").addEventListener("click", e => { const b = e.target.closest("[data-day]"); if (b) { day = +b.dataset.day; paint(); } });
  if (!data) {
    if (!loading) loading = fetchWeek().then(d => { data = d; }).finally(() => { loading = null; });
    loading.then(paint).catch(() => { if ($("calList")) $("calList").innerHTML = `<div class="empty"><p>Le calendrier n'a pas pu être chargé (AniList ne répond pas).</p><button class="btn" onclick="location.reload()">Réessayer</button></div>`; });
  } else paint();
}
onChange(what => { if (root && root.isConnected && ["collection", "session", "entry"].includes(what)) paint(); });
