// Personnages : index statique (characters.json) + détails chargés en direct depuis l'API AniList.
import { A, byId, norm, loadCatalogue, dataUrl } from "./data.js";

export let CH = [];               // personnages, triés par popularité (nombre de fans AniList)
export const charById = new Map();
export const charsByAnime = new Map();   // id animé → [{ c, role }]
export let TAGS = [], CATS = [], IMG = "";
export const chReady = { loaded: false, full: false, total: 0 };
let p = null, pAll = null;
const fullListeners = new Set();
/** Appelé quand les personnages restants (au-delà des 3 000 premiers) sont chargés. */
export const onCharsComplete = fn => { fullListeners.add(fn); return () => fullListeners.delete(fn); };

const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
// Texte de recherche préparé à la demande (coûteux à calculer pour 90 000 personnages sur un téléphone).
const HAY = Symbol("hay");
const proto = { get hay() { return this[HAY] || (this[HAY] = norm([this.name, this.native, ...this.alt].join(" "))); } };
function ingest(rows, startRank) {
  let k = 0;
  for (const [id, name, native, img, fav, tags, apps, alt] of rows) {
    if (charById.has(id)) continue;          // jamais de doublon, même avec un fichier ancien en cache
    const c = Object.create(proto);
    Object.assign(c, { id, name, native, img, fav, tags, rank: startRank + k++, alt: alt || [], apps: decodeApps(apps) });
    CH.push(c); charById.set(c.id, c);
    for (const { a, role } of c.apps) {
      if (!charsByAnime.has(a.id)) charsByAnime.set(a.id, []);
      charsByAnime.get(a.id).push({ c, role });
    }
  }
}
function sortByAnime() {
  const order = { M: 0, S: 1, B: 2 };
  for (const l of charsByAnime.values()) l.sort((x, y) => order[x.role] - order[y.role] || x.c.rank - y.c.rank);
}

/** Charge les 3 000 personnages les plus aimés (rapide), puis lance le chargement des autres en arrière-plan. */
export function loadCharacters() {
  if (!p) p = Promise.all([loadCatalogue(), getJSON(dataUrl("/characters.json"))]).then(([, d]) => {
    IMG = d.img; CATS = d.cats; chReady.total = d.total || d.chars.length;
    TAGS = d.tags.map(([cat, label, n], i) => ({ i, cat, label, n }));
    ingest(d.chars, 0); sortByAnime();
    chReady.loaded = true;
  }).catch(e => { p = null; throw e; });
  return p;
}
/** Tous les personnages (≈ 90 000). */
export function loadAllCharacters() {
  if (!pAll) pAll = Promise.all([loadCharacters(), getJSON(dataUrl("/characters-more.json"))]).then(([, d]) => {
    // découpe le traitement pour ne pas figer la page
    return new Promise(res => {
      const rows = d.chars, start = CH.length; let i = 0;
      const step = () => {
        const end = Math.min(rows.length, i + 8000);
        ingest(rows.slice(i, end), start + i); i = end;
        if (i < rows.length) setTimeout(step, 0); else { sortByAnime(); chReady.full = true; fullListeners.forEach(f => f()); res(); }
      };
      step();
    });
  }).catch(e => { pAll = null; throw e; });
  return pAll;
}

const ROLES = ["M", "S", "B"];
/** Apparitions codées « index de l'animé × 4 + rôle (0 principal, 1 secondaire, 2 figurant) ». */
const decodeApps = L => L.map(v => ({ a: A[v >> 2], role: ROLES[v & 3] })).filter(x => x.a);

/** Petit fichier des personnages les plus aimés (accueil), sans charger l'index complet. */
let topP = null;
export function loadTopCharacters() {
  if (!topP) topP = Promise.all([loadCatalogue(), fetch(dataUrl("/characters-top.json")).then(r => r.json())]).then(([, d]) => {
    if (!IMG) IMG = d.img;
    return d.chars.map(([id, name, native, img, fav, apps]) => ({ id, name, native, img, fav, tags: [], alt: [], apps: decodeApps(apps) }));
  }).catch(e => { topP = null; throw e; });
  return topP;
}

/** Personnages d'un animé (fichier découpé, léger). Renvoie [{ c: {id, name, img}, role }]. */
const shardP = new Map();
export function charsOfAnime(anime) {
  if (chReady.full) return Promise.resolve(charsByAnime.get(anime.id) || []);
  const n = anime.rank % 64;
  if (!shardP.has(n)) shardP.set(n, fetch(dataUrl(`/cshards/${n}.json`)).then(r => r.json()).catch(e => { shardP.delete(n); throw e; }));
  return shardP.get(n).then(d => {
    if (!IMG) IMG = d.img;
    return (d.a[anime.rank] || []).map(([id, name, img, role]) => ({ c: { id, name, img }, role: ROLES[role] }));
  });
}

/** URL de l'image ; « b~xx.jpg » signifie « b<id>-xx.jpg » (identifiant retiré pour alléger les fichiers). */
export const imgUrl = (c, size = "large") => {
  if (!c || !c.img) return "";
  if (c.img.startsWith("http")) return c.img;
  return IMG.replace("/medium/", `/${size}/`) + c.img.replace("~", c.id + "-");
};
export const ROLE_FR = { M: "Principal", S: "Secondaire", B: "Figurant" };
/** Un personnage n'est visible que s'il apparaît dans au moins un animé visible (contenu adulte réservé aux majeurs). */
export const visibleApps = (c, adultOk) => c.apps.filter(x => !x.a.adult || adultOk);
export const mainAnime = (c, adultOk) => { const v = visibleApps(c, adultOk); return (v.find(x => x.role === "M") || v[0] || {}).a; };

/** Personnages proches : étiquettes de nature, métier, physique, personnalité en commun. */
export function similarChars(c, n = 14, adultOk = false) {
  const strong = new Set(c.tags.filter(t => !["Genre", "Rôle dans l'histoire", "Signe", "Groupe sanguin", "Âge"].includes(CATS[TAGS[t].cat])));
  if (!strong.size) return [];
  const same = new Set(c.tags), out = [];
  for (const d of CH) {
    if (d.id === c.id || !d.img || !visibleApps(d, adultOk).length) continue;
    let s = 0;
    for (const t of d.tags) if (strong.has(t)) s += 3; else if (same.has(t)) s += 0.5;
    if (s < 3) continue;
    out.push([s - d.rank / 20000, d]);
  }
  return out.sort((x, y) => y[0] - x[0]).slice(0, n).map(x => x[1]);
}

// ---------- Détails en direct (AniList) ----------
const cache = new Map();
export function fetchCharacter(id) {
  if (cache.has(id)) return cache.get(id);
  const q = `query($id:Int){ Character(id:$id){ id name{ full native alternative alternativeSpoiler } description gender age bloodType dateOfBirth{ year month day } favourites siteUrl } }`;
  const pr = fetch("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query: q, variables: { id } }) })
    .then(r => r.json()).then(d => { if (!d.data) throw new Error("anilist"); return d.data.Character; })
    .catch(e => { cache.delete(id); throw e; });
  cache.set(id, pr);
  return pr;
}

/** Description AniList (markdown simplifié) → HTML sûr. Les spoilers ~!…!~ sont floutés, à révéler au clic. */
export function descHTML(md) {
  const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let t = esc(md || "");
  t = t.replace(/~!([\s\S]*?)!~/g, (_, x) => `<span class="spoil" tabindex="0" role="button" aria-label="Spoiler : afficher">${x}</span>`);
  // liens vers un autre personnage AniList → fiche interne ; autres liens → texte simple
  t = t.replace(/\[([^\]]*)\]\(https?:\/\/anilist\.co\/character\/(\d+)[^)]*\)/g, (_, txt, id) => `<a href="#/personnage/${id}">${txt}</a>`);
  t = t.replace(/\[([^\]]*)\]\(https?:\/\/anilist\.co\/anime\/(\d+)[^)]*\)/g, (_, txt, id) => byId.has(+id) ? `<a href="#/anime/${id}">${txt}</a>` : txt);
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/__([^_\n]+?)__/g, "<b>$1</b>").replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>").replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>");
  t = t.replace(/&lt;br\s*\/?&gt;/gi, "\n");
  return t.split(/\n{2,}/).map(par => `<p>${par.replace(/\n/g, "<br>")}</p>`).join("");
}
export const GENDER_FR = g => !g ? "" : /^male$/i.test(g) ? "Homme" : /^female$/i.test(g) ? "Femme" : g;
export const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
