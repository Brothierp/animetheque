// Prévention (amitiés majeur / mineur) et partage d'images du site dans la messagerie
// (fiches d'animés, personnages, fan arts validés) : aucun fichier libre n'est envoyé dans les messages.
import { A, byId, norm, titleOf, hdUrl, loadCatalogue } from "./data.js";
import { ME, adultAllowed } from "./state.js";
import { esc } from "./ui.js";
import { charById, CH, loadCharacters, imgUrl, mainAnime } from "./chars.js";

export const isAdultMe = () => { const y = ME.profile && ME.profile.birth_year; return !!y && new Date().getFullYear() - y > 18; };

function dialog(html) {
  const d = document.createElement("dialog"); d.className = "fb-dlg"; d.innerHTML = html;
  document.body.appendChild(d); d.addEventListener("close", () => setTimeout(() => d.remove(), 0));
  d.showModal(); return d;
}

/** Message de prévention avant de devenir ami avec un majeur (pour un mineur) ou un mineur (pour un majeur). */
export function preventionDialog(name) {
  const adult = isAdultMe();
  const body = adult
    ? `<p><b>${esc(name)}</b> est mineur·e. Les échanges entre majeurs et mineurs sont autorisés pour parler d'animés, avec des règles strictes :</p>
       <ul class="prev-l"><li>pas de numéro, d'e-mail, de réseau social ni de lien : ces messages sont <b>bloqués automatiquement</b> ;</li>
       <li>pas de demande de photo, de rendez-vous, de secret ni de question intime ;</li>
       <li>vos conversations sont <b>analysées automatiquement</b> et tout message suspect est transmis à l'administrateur.</li></ul>
       <p class="hint">Tout comportement inapproprié entraîne la suppression du compte et peut être signalé aux autorités.</p>`
    : `<p><b>${esc(name)}</b> est majeur·e. Tu peux parler d'animés avec lui ou elle, mais garde ces réflexes :</p>
       <ul class="prev-l"><li>ne donne jamais ton numéro, ton adresse, ton école, ni tes réseaux sociaux ;</li>
       <li>n'envoie pas de photo de toi et n'accepte jamais de rendez-vous ;</li>
       <li>si quelqu'un te demande de garder un secret, te met mal à l'aise ou te fait des compliments bizarres : <b>parles-en à un adulte de confiance</b>, bloque et signale-le ;</li>
       <li>pour te protéger, les conversations entre majeurs et mineurs sont <b>analysées automatiquement</b> par l'Animéthèque.</li></ul>
       <p class="hint">Besoin d'aide ou d'en parler ? Appelle le <b>3018</b> (gratuit, anonyme, 7j/7) ou va sur <a href="https://e-enfance.org/numero-3018/" target="_blank" rel="noopener">3018.fr</a>.</p>`;
  return new Promise(res => {
    const d = dialog(`<h2>⚠️ Avant de continuer</h2>${body}
      <div class="fb-act"><button type="button" class="btn" data-x="0">Annuler</button><button type="button" class="btn primary" data-x="1">J'ai compris, continuer</button></div>`);
    let ok = false;
    d.addEventListener("click", e => { const b = e.target.closest("[data-x]"); if (b) { ok = b.dataset.x === "1"; d.close(); } });
    d.addEventListener("close", () => res(ok));
  });
}

/** Bandeau affiché dans une conversation majeur / mineur. */
export const mixedBanner = () => `<div class="safe-ban" role="note">🛡️ <span>${isAdultMe()
  ? "Conversation avec un·e mineur·e : coordonnées et liens bloqués, messages analysés automatiquement."
  : "Conversation avec un·e majeur·e : ne donne jamais tes coordonnées. Messages analysés automatiquement. Un souci ? Signale-le ou appelle le 3018."}</span></div>`;

// ---------- Partage d'images du site ----------
// Un message peut contenir [[anime:123]], [[perso:456]] ou [[fanart:<uuid>]] : affichés comme des cartes.
const TOKEN = /\[\[(anime|perso|fanart):([0-9a-f-]{1,36})\]\]/g;
export const hasTokens = s => /\[\[(anime|perso|fanart):/.test(s || "");
export const tokenPreview = s => (s || "").replace(TOKEN, (_, k) => ({ anime: "🎬 Animé partagé", perso: "🧑 Personnage partagé", fanart: "🎨 Fan art partagé" })[k]);

let fanartResolver = () => null;
export const setFanartResolver = fn => { fanartResolver = fn; };
let extraPrep = async () => {};
export const setTokenPreparer = fn => { extraPrep = fn; };

function shareCard(kind, id) {
  if (kind === "anime") {
    const a = byId.get(+id); if (!a || (a.adult && !adultAllowed())) return `<span class="sh-card none">Animé indisponible</span>`;
    const src = hdUrl(a, "medium");
    return `<a class="sh-card" href="#/anime/${a.id}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<span><small>Animé</small><b>${esc(titleOf(a))}</b></span></a>`;
  }
  if (kind === "perso") {
    const c = charById.get(+id); if (!c) return `<a class="sh-card" href="#/personnage/${+id}"><span><small>Personnage</small><b>Voir la fiche</b></span></a>`;
    const a = mainAnime(c, adultAllowed());
    return `<a class="sh-card" href="#/personnage/${c.id}">${imgUrl(c) ? `<img src="${esc(imgUrl(c))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<span><small>Personnage</small><b>${esc(c.name || c.native)}</b>${a ? `<em>${esc(titleOf(a))}</em>` : ""}</span></a>`;
  }
  const f = fanartResolver(id);
  return f ? `<a class="sh-card fan" href="#/fanarts/${esc(id)}">${f.url ? `<img src="${esc(f.url)}" alt="" loading="lazy">` : ""}<span><small>Fan art</small><b>${esc(f.title)}</b>${f.by ? `<em>par ${esc(f.by)}</em>` : ""}</span></a>`
    : `<a class="sh-card" href="#/fanarts/${esc(id)}"><span><small>Fan art</small><b>Voir le fan art</b></span></a>`;
}
/** Texte d'un message → HTML (échappé, retours à la ligne, cartes partagées). */
export function messageHTML(body) {
  return esc(body).replace(/\n/g, "<br>").replace(TOKEN, (_, k, id) => shareCard(k, id));
}
/** Les personnages partagés doivent être chargés pour afficher leur carte. */
export async function prepareTokens(bodies) {
  const need = bodies.some(b => /\[\[perso:/.test(b || ""));
  await Promise.all([need ? loadCharacters().catch(() => {}) : null, extraPrep(bodies).catch(() => {})]);
}

/** Fenêtre « Partager un animé ou un personnage » ; renvoie le jeton à envoyer, ou null. */
export function sharePicker(extra) {
  return new Promise(res => {
    const d = dialog(`<h2>🖼️ Partager une image</h2>
      <p class="hint">Partage la fiche d'un animé, d'un personnage${extra ? " ou un fan art validé" : ""}. Pour protéger tout le monde, on n'envoie pas de photos personnelles dans la messagerie.</p>
      <div class="sp-tabs" role="tablist">${[["anime", "Animé"], ["perso", "Personnage"], ...(extra ? [["fanart", "Fan art"]] : [])].map(([k, v], i) => `<button type="button" data-k="${k}" class="${i ? "" : "on"}">${v}</button>`).join("")}</div>
      <input type="search" class="sp-q" placeholder="Rechercher…" autocomplete="off" aria-label="Rechercher">
      <div class="sp-res"></div>
      <div class="fb-act"><button type="button" class="btn" data-x>Fermer</button></div>`);
    let kind = "anime", out = null, t;
    const q = d.querySelector(".sp-q"), box = d.querySelector(".sp-res");
    const draw = async () => {
      const s = norm(q.value), ok = adultAllowed();
      let items = [];
      if (kind === "anime") { await loadCatalogue(); items = A.filter(a => (!a.adult || ok) && (!s || a.hay.includes(s))).slice(0, 24).map(a => ({ tok: `[[anime:${a.id}]]`, img: hdUrl(a, "medium"), t: titleOf(a) })); }
      else if (kind === "perso") { box.innerHTML = `<p class="hint">Chargement…</p>`; await loadCharacters(); items = CH.filter(c => (!s || c.hay.includes(s)) && mainAnime(c, ok)).slice(0, 24).map(c => ({ tok: `[[perso:${c.id}]]`, img: imgUrl(c), t: c.name || c.native })); }
      else items = (await extra(s)).map(f => ({ tok: `[[fanart:${f.id}]]`, img: f.url, t: f.title }));
      box.innerHTML = items.length ? items.map(x => `<button type="button" class="sp-it" data-tok="${esc(x.tok)}">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "<i></i>"}<span>${esc(x.t)}</span></button>`).join("") : `<p class="hint">Aucun résultat.</p>`;
    };
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(draw, 150); });
    d.addEventListener("click", e => {
      const k = e.target.closest("[data-k]"); if (k) { kind = k.dataset.k; d.querySelectorAll("[data-k]").forEach(b => b.classList.toggle("on", b === k)); draw(); return; }
      const it = e.target.closest("[data-tok]"); if (it) { out = it.dataset.tok; d.close(); return; }
      if (e.target.closest("[data-x]")) d.close();
    });
    d.addEventListener("close", () => res(out));
    draw(); q.focus();
  });
}
