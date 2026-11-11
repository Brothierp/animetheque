// Personnages : index statique (characters.json) + détails chargés en direct depuis l'API AniList.
import { A, byId, norm, loadCatalogue } from "./data.js";

export let CH = [];               // personnages, triés par popularité (nombre de fans AniList)
export const charById = new Map();
export const charsByAnime = new Map();   // id animé → [{ c, role }]
export let TAGS = [], CATS = [], IMG = "";
export const chReady = { loaded: false };
let p = null;

export function loadCharacters() {
  if (!p) p = Promise.all([loadCatalogue(), fetch("/characters.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })]).then(([, d]) => {
    IMG = d.img; CATS = d.cats;
    TAGS = d.tags.map(([cat, label, n], i) => ({ i, cat, label, n }));
    CH = d.chars.map(([id, name, native, img, fav, tags, apps, alt], rank) => ({
      id, name, native, img, fav, tags, rank, alt: alt || [],
      apps: decodeApps(apps),
      hay: norm([name, native, ...(alt || [])].join(" "))
    }));
    for (const c of CH) {
      charById.set(c.id, c);
      for (const { a, role } of c.apps) {
        if (!charsByAnime.has(a.id)) charsByAnime.set(a.id, []);
        charsByAnime.get(a.id).push({ c, role });
      }
    }
    const order = { M: 0, S: 1, B: 2 };
    for (const l of charsByAnime.values()) l.sort((x, y) => order[x.role] - order[y.role] || x.c.rank - y.c.rank);
    chReady.loaded = true;
  }).catch(e => { p = null; throw e; });
  return p;
}

const ROLES = ["M", "S", "B"];
/** Apparitions codées « index de l'animé × 4 + rôle (0 principal, 1 secondaire, 2 figurant) ». */
const decodeApps = L => L.map(v => ({ a: A[v >> 2], role: ROLES[v & 3] })).filter(x => x.a);

/** Petit fichier des personnages les plus aimés (accueil), sans charger l'index complet. */
let topP = null;
export function loadTopCharacters() {
  if (!topP) topP = Promise.all([loadCatalogue(), fetch("/characters-top.json").then(r => r.json())]).then(([, d]) => {
    if (!IMG) IMG = d.img;
    return d.chars.map(([id, name, native, img, fav, apps]) => ({ id, name, native, img, fav, tags: [], alt: [], apps: decodeApps(apps) }));
  }).catch(e => { topP = null; throw e; });
  return topP;
}

/** Personnages d'un animé (fichier découpé, léger). Renvoie [{ c: {id, name, img}, role }]. */
const shardP = new Map();
export function charsOfAnime(anime) {
  if (chReady.loaded) return Promise.resolve(charsByAnime.get(anime.id) || []);
  const n = anime.rank % 64;
  if (!shardP.has(n)) shardP.set(n, fetch(`/cshards/${n}.json`).then(r => r.json()).catch(e => { shardP.delete(n); throw e; }));
  return shardP.get(n).then(d => {
    if (!IMG) IMG = d.img;
    return (d.a[anime.rank] || []).map(([id, name, img, role]) => ({ c: { id, name, img }, role: ROLES[role] }));
  });
}

export const imgUrl = (c, size = "large") => c && c.img ? (c.img.startsWith("http") ? c.img : IMG.replace("/medium/", `/${size}/`) + c.img) : "";
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
