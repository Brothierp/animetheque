// Catalogue : chargement de data.json / chars.json, traductions, recherche, affiches.

/** Version des fichiers de données : à changer à chaque régénération, pour qu'aucun navigateur ne mélange
 *  une ancienne copie en cache avec les nouveaux fichiers. */
export const DATA_V = "20261112d";
export const dataUrl = path => `${path}?v=${DATA_V}`;

export const FR = {
  format: { TV: "Série TV", TV_SHORT: "Série courte", MOVIE: "Film", SPECIAL: "Spécial", OVA: "OAV", ONA: "ONA (web)", MUSIC: "Clip musical" },
  status: { FINISHED: "Terminé", RELEASING: "En cours de diffusion", NOT_YET_RELEASED: "À venir", CANCELLED: "Annulé", HIATUS: "En pause" },
  season: { WINTER: "Hiver", SPRING: "Printemps", SUMMER: "Été", FALL: "Automne" },
  country: { JP: "Japon", CN: "Chine", KR: "Corée du Sud", TW: "Taïwan" },
  source: { ORIGINAL: "Original", MANGA: "Manga", LIGHT_NOVEL: "Light novel", VISUAL_NOVEL: "Visual novel", VIDEO_GAME: "Jeu vidéo", NOVEL: "Roman",
    WEB_NOVEL: "Web novel", OTHER: "Autre", DOUJINSHI: "Doujinshi", ANIME: "Anime", WEB_MANGA: "Web manga", LIVE_ACTION: "Film live", GAME: "Jeu",
    COMIC: "Comic", MULTIMEDIA_PROJECT: "Projet multimédia", PICTURE_BOOK: "Livre illustré", MULTIMEDIA: "Multimédia" },
  genres: { Action: "Action", Adventure: "Aventure", Comedy: "Comédie", Drama: "Drame", Ecchi: "Ecchi", Fantasy: "Fantasy", Horror: "Horreur",
    "Mahou Shoujo": "Magical girl", Mecha: "Mecha", Music: "Musique", Mystery: "Mystère", Psychological: "Psychologique", Romance: "Romance",
    "Sci-Fi": "Science-fiction", "Slice of Life": "Tranche de vie", Sports: "Sport", Supernatural: "Surnaturel", Thriller: "Thriller", Hentai: "Hentai",
    Isekai: "Isekai", Shounen: "Shōnen", Shoujo: "Shōjo", Seinen: "Seinen", Josei: "Josei", "Martial Arts": "Arts martiaux", School: "Vie scolaire",
    Historical: "Historique", Military: "Militaire", Harem: "Harem", "Reverse Harem": "Harem inversé", Iyashikei: "Iyashikei (apaisant)",
    "Super Power": "Super-pouvoirs", Magic: "Magie", Cyberpunk: "Cyberpunk", "Post-Apocalyptic": "Post-apocalyptique", Reincarnation: "Réincarnation",
    Survival: "Survie", Space: "Espace", Vampire: "Vampires", Samurai: "Samouraïs", "Video Games": "Jeux vidéo", Cooking: "Cuisine", Idol: "Idols",
    "Boys' Love": "Boys' Love (BL / Yaoi)", Yuri: "Yuri", Detective: "Enquête", Zombie: "Zombies", Demons: "Démons", Mythology: "Mythologie" }
};
export const tr = (k, v) => (FR[k] && FR[k][v]) || String(v).replace(/_/g, " ").toLowerCase().replace(/^./, c => c.toUpperCase());
export const norm = s => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export let T = null;          // tables (genres, tags, studios…)
export let A = [];            // animés, triés par popularité
export const byId = new Map();
export let UP = -1, RELEASING = -1;
export const ready = { catalogue: false, chars: false };

let catPromise = null, charPromise = null;
/** Franchises : id animé → { list: [{ a, k }], k } (k : 0 principal, 1 parallèle, 2 spin-off, 3 récap, 4 alternative, 5 bonus). */
export const FRANCHISE = new Map();
export const KIND_FR = ["Principal", "Histoire parallèle", "Spin-off", "Récapitulatif", "Version alternative", "Bonus"];
export const franchiseKey = a => { const f = FRANCHISE.get(a.id); return f ? f.list : a; };

// Textes de recherche calculés au premier usage (coûteux sur un téléphone pour 22 000 titres).
const ANIME = {
  get hay() { return this._hay || (this._hay = norm([this.romaji, this.english, this.native, ...this.syn].join(" "))); },
  get studioHay() { return this._sh || (this._sh = this.studios.map(j => norm(T.studios[j])).join("|")); }
};
export function loadCatalogue() {
  if (!catPromise) catPromise = Promise.all([
    fetch(dataUrl("/data.json")).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch(dataUrl("/franchises.json")).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(dataUrl("/covers-hd.json")).then(r => r.ok ? r.json() : null).catch(() => null)
  ]).then(([d, fr, hd]) => {
    T = d.tables;
    A = d.items.map((x, i) => Object.assign(Object.create(ANIME), { id: x[0], mal: x[1], romaji: x[2], english: x[3], native: x[4], syn: x[5], format: x[6], status: x[7], eps: x[8], dur: x[9],
      season: x[10], year: x[11], genres: x[12], tags: x[13], studios: x[14], score: x[15], pop: x[16], country: x[17], source: x[18], hasDesc: !!x[19], desc: typeof x[19] === "string" ? x[19] : null,
      plats: Array.isArray(x[20]) ? x[20] : null, nPlats: Array.isArray(x[20]) ? x[20].length : x[20], lang: x[21], adult: x[22] === 1, cov: x[23], rank: i, chars: [], charHay: "",
      _hay: null, _sh: null }));
    for (const a of A) byId.set(a.id, a);
    if (hd) { HD_BASE = hd.base; hd.c.forEach((f, i) => { if (!A[i] || !f) return; const [file, color] = f.split("|"); A[i].hd = file.replace("~", A[i].id + "-"); A[i].color = color || ""; }); }
    UP = T.status.indexOf("NOT_YET_RELEASED"); RELEASING = T.status.indexOf("RELEASING");
    if (fr) for (const f of fr.f) {
      const list = f.map(([i, k]) => ({ a: A[i], k })).filter(x => x.a);
      for (const x of list) FRANCHISE.set(x.a.id, { list, k: x.k });
    }
    ready.catalogue = true;
  });
  return catPromise;
}
export function loadChars() {
  if (!charPromise) charPromise = loadCatalogue().then(() => fetch(dataUrl("/chars.json"))).then(r => r.json()).then(C => {
    C.forEach((cs, i) => { const a = A[i]; if (!a) return; a.chars = cs; a.charHay = norm(cs.map(c => c[0] + " " + c[1]).join(" | ")); });
    ready.chars = true;
  });
  return charPromise;
}

/** Synopsis, chargé à la demande (64 petits fichiers). */
const descP = new Map();
/** Détails chargés à la demande (synopsis + plateformes) : 64 petits fichiers. */
export function loadDetails(a) {
  if (a.desc != null && a.plats) return Promise.resolve(a);
  const n = a.rank % 64;
  if (!descP.has(n)) descP.set(n, fetch(dataUrl(`/dshards/${n}.json`)).then(r => r.json()).catch(e => { descP.delete(n); throw e; }));
  return descP.get(n).then(d => {
    const v = d[a.rank];
    if (Array.isArray(v)) { a.desc = v[0] || ""; a.plats = v[1] || []; } else { a.desc = v || ""; a.plats = a.plats || []; }
    return a;
  });
}
export const loadDesc = a => loadDetails(a).then(x => x.desc || "");

export const titleOf = a => a.english || a.romaji;
export const altTitles = a => { const m = titleOf(a); return [...new Set([a.romaji, a.native].filter(t => t && t.toLowerCase() !== m.toLowerCase()))]; };
/** Lien externe : MyAnimeList pour les titres adultes (AniList les cache aux visiteurs), AniList sinon. */
export const extLink = a => a.adult && a.mal ? `https://myanimelist.net/anime/${a.mal}` : `https://anilist.co/anime/${a.id}`;

/** Affiches haute définition (CDN AniList) : medium ≈ 230 px de large, large ≈ 460 px. */
let HD_BASE = "";
export const hdUrl = (a, size) => a && a.hd ? `${HD_BASE}${size}/${a.hd}` : "";

/** Style CSS d'une affiche (planches de 10 × 20 affiches de 96 × 136 px). */
export function coverStyle(a) {
  if (!a || a.cov < 0) return "";
  const c = a.cov;
  return `background-image:url(/covers/s${Math.floor(c / 200)}.webp);background-position:${(c % 10) / 9 * 100}% ${Math.floor((c % 200) / 10) / 19 * 100}%`;
}

/** Garde un seul titre par franchise (le premier rencontré, donc le plus populaire si la liste est triée ainsi). */
export function onePerFranchise(list, n = Infinity) {
  const seen = new Set(), out = [];
  for (const a of list) { const k = franchiseKey(a); if (seen.has(k)) continue; seen.add(k); out.push(a); if (out.length >= n) break; }
  return out;
}

/** Similarité simple : thèmes et genres en commun, pondérés, puis popularité. */
export function similar(a, n = 12, adultOk = false) {
  const tags = new Set(a.tags), genres = new Set(a.genres), out = [];
  for (const b of A) {
    if (b.id === a.id || (b.adult && !(adultOk && a.adult)) || b.status === UP) continue;
    let s = 0;
    for (const t of b.tags) if (tags.has(t)) s += 2;
    for (const g of b.genres) if (genres.has(g)) s += 1.5;
    if (s < 5) continue;
    s += (b.score || 60) / 25 - b.rank / 4000;
    out.push([s, b]);
  }
  const own = franchiseKey(a);
  return onePerFranchise(out.sort((x, y) => y[0] - x[0]).map(x => x[1]).filter(b => franchiseKey(b) !== own), n);
}
