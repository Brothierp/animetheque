// Fiche d'un personnage, ouverte dans une fenêtre (#/personnage/<id>).
import { titleOf } from "../data.js";
import { charById, TAGS, CATS, loadCharacters, loadAllCharacters, imgUrl, visibleApps, similarChars, fetchCharacter, descHTML, ROLE_FR, GENDER_FR, MONTHS } from "../chars.js";
import { adultAllowed } from "../state.js";
import { $, esc, fmt, card } from "../ui.js";
import { charCard } from "./characters.js";

let el = null, curId = null, onCloseCb = null;

function shell() {
  el = document.createElement("div"); el.className = "dmodal cmodal"; el.id = "charModal";
  el.innerHTML = `<div class="d-back" data-c="close"></div><div class="d-panel" role="dialog" aria-modal="true" aria-labelledby="cTitle" tabindex="-1"></div>`;
  document.body.appendChild(el);
  el.addEventListener("click", e => {
    const s = e.target.closest(".spoil"); if (s) { s.classList.add("shown"); return; }
    if (e.target.closest("[data-c=close]")) { if (onCloseCb) onCloseCb(); else closeCharacter(); return; }
    if (e.target.closest("a[href^='#/']")) closeCharacter();
  });
  el.addEventListener("keydown", e => { const s = e.target.closest(".spoil"); if (s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); s.classList.add("shown"); } });
  addEventListener("keydown", e => { if (e.key === "Escape" && isCharacterOpen() && !document.querySelector(".pop")) { if (onCloseCb) onCloseCb(); else closeCharacter(); } });
}

function html(c) {
  const ok = adultAllowed(), apps = visibleApps(c, ok), src = imgUrl(c);
  const groups = CATS.map((cat, ci) => [cat, c.tags.filter(t => TAGS[t].cat === ci)]).filter(([, ts]) => ts.length);
  return `<div class="c-banner">${src ? `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer">` : ""}</div>
  <button type="button" class="d-close x" data-c="close" aria-label="Fermer">×</button>
  <div class="c-head">
    <span class="c-portrait">${src ? `<img src="${esc(src)}" alt="Portrait de ${esc(c.name)}" referrerpolicy="no-referrer">` : `<span class="cc-none">${esc((c.name || "?")[0])}</span>`}</span>
    <div class="c-title">
      <span class="kicker">Personnage</span>
      <h1 id="cTitle">${esc(c.name || c.native)}</h1>
      ${c.native ? `<p class="d-alt">${esc(c.native)}${c.alt.length ? " · " + esc(c.alt.join(" · ")) : ""}</p>` : ""}
      <div class="c-facts" id="cFacts">${c.fav ? `<span class="fact"><b>♥ ${fmt(c.fav)}</b> fans sur AniList</span>` : ""}</div>
    </div>
  </div>
  <div class="c-body">
    <div class="c-main">
      ${groups.length ? `<section><h2>Étiquettes</h2><div class="ctags">${groups.map(([cat, ts]) => `<div class="ctag-row"><span>${esc(cat)}</span><div class="tags">${ts.map(t => `<a class="g" href="#/personnages?tag=${encodeURIComponent(TAGS[t].label)}">${esc(TAGS[t].label)}</a>`).join("")}</div></div>`).join("")}</div></section>` : ""}
      <section><h2>Description</h2><div class="cdesc" id="cDesc"><p class="hint">Chargement depuis AniList…</p></div></section>
      <section><h2>Apparaît dans <small class="hint">${apps.length} animé${apps.length > 1 ? "s" : ""}</small></h2>
        <div class="grid apps">${apps.slice(0, 40).map(({ a, role }) => `<div class="app-w">${card(a)}<span class="role r-${role}">${ROLE_FR[role]}</span></div>`).join("")}</div></section>
    </div>
  </div>
  <div class="d-sim" id="cSim"></div>`;
}

function facts(d, c) {
  const L = [];
  if (c.fav) L.push(`<span class="fact"><b>♥ ${fmt(c.fav)}</b> fans</span>`);
  if (d.gender) L.push(`<span class="fact">${esc(GENDER_FR(d.gender))}</span>`);
  if (d.age) L.push(`<span class="fact">${esc(d.age)} ans</span>`);
  const b = d.dateOfBirth || {};
  if (b.day && b.month) L.push(`<span class="fact">Né·e le ${b.day} ${MONTHS[b.month - 1]}${b.year ? " " + b.year : ""}</span>`);
  if (d.bloodType) L.push(`<span class="fact">Groupe ${esc(d.bloodType)}</span>`);
  return L.join("");
}

export async function openCharacter(id, onClose) {
  await loadCharacters().catch(() => {});
  if (!charById.has(id)) await loadAllCharacters().catch(() => {});   // personnage moins connu : second fichier
  const c = charById.get(id);
  if (!c) return false;
  if (!visibleApps(c, adultAllowed()).length) return false;
  curId = id; onCloseCb = onClose;
  if (!el) shell();
  const panel = el.querySelector(".d-panel");
  panel.innerHTML = html(c); panel.scrollTop = 0;
  el.classList.add("open"); document.body.classList.add("noscroll");
  panel.focus({ preventScroll: true });
  setTimeout(() => {
    if (curId !== id) return;
    const sim = similarChars(c, 14, adultAllowed());
    $("cSim").innerHTML = sim.length ? `<section class="row"><div class="row-h"><h2>Personnages similaires</h2><span class="row-sub">Mêmes étiquettes</span></div><div class="row-s crow">${sim.map(x => charCard(x)).join("")}</div></section>` : "";
  }, 30);
  fetchCharacter(id).then(d => {
    if (curId !== id) return;
    $("cFacts").innerHTML = facts(d, c);
    $("cDesc").innerHTML = d.description ? descHTML(d.description) + `<p class="hint src">Description en anglais, issue d'<a href="https://anilist.co/character/${id}" target="_blank" rel="noopener">AniList ↗</a>. Les passages flous sont des spoilers : clique pour les révéler.</p>`
      : `<p class="hint">Pas de description sur AniList.</p>`;
  }).catch(() => { if (curId === id) $("cDesc").innerHTML = `<p class="hint">Description indisponible pour le moment. <a href="https://anilist.co/character/${id}" target="_blank" rel="noopener">Voir sur AniList ↗</a></p>`; });
  return true;
}
export function closeCharacter() {
  if (!el || !el.classList.contains("open")) return;
  el.classList.remove("open"); curId = null;
  if (!document.querySelector(".dmodal.open")) document.body.classList.remove("noscroll");
}
export const isCharacterOpen = () => !!(el && el.classList.contains("open"));
