// Jeu : niveaux (XP), badges, objectif annuel et clé de la semaine du défi.
// Tout est calculé à partir de la collection (déjà chargée) et de quelques compteurs du serveur (my_achievements).
import { supabase } from "./supabase.js";
import { byId, T } from "./data.js";
import { ME, onChange } from "./state.js";

// ---------- Compteurs du serveur (avis, likes reçus, fan arts, amis, quiz…) ----------
let achP = null;
export function achievements(force = false) {
  if (!ME.user || !supabase) return Promise.resolve({});
  if (!achP || force) achP = supabase.rpc("my_achievements").then(r => (r.error ? {} : r.data || {}), () => ({}));
  return achP;
}
onChange(what => { if (what === "session") { achP = null; goalP = null; } });

// ---------- Statistiques de la collection ----------
export function collectionStats(year = new Date().getFullYear()) {
  const s = { watched: 0, watching: 0, eps: 0, favs: 0, rated: 0, films: 0, longest: 0, oldest: 9999, yearDone: 0, genres: new Map(), lists: 0, chars: ME.favChars.size };
  for (const [id, e] of ME.entries) {
    const a = byId.get(id); if (!a) continue;
    const done = e.s === "watched";
    const n = done ? Math.max(e.p || 0, a.eps || 0) : e.s === "watching" ? e.p || 0 : 0;
    s.eps += n;
    if (e.f) s.favs++;
    if (e.r) s.rated++;
    if (e.s === "watching") s.watching++;
    if (done) {
      s.watched++;
      if (T.format[a.format] === "MOVIE") s.films++;
      s.longest = Math.max(s.longest, a.eps || 0);
      if (a.year) s.oldest = Math.min(s.oldest, a.year);
      if (e.t && new Date(e.t).getFullYear() === year) s.yearDone++;
      for (const g of a.genres) s.genres.set(T.genres[g], (s.genres.get(T.genres[g]) || 0) + 1);
    }
  }
  s.lists = Object.values(ME.lists).filter(l => l && l.n).length;
  return s;
}

// ---------- Niveaux ----------
export function xpOf(s, ach = {}) {
  return s.eps + s.watched * 10 + s.rated * 3 + s.favs * 2
    + (ach.reviews || 0) * 20 + (ach.likes || 0) * 5 + (ach.fanarts || 0) * 30 + (ach.posts || 0) * 5
    + (ach.quizzes || 0) * 15 + (ach.perfect || 0) * 25 + (ach.votes || 0) * 10 + (ach.friends || 0) * 10;
}
export const XP_RULES = [["1 épisode vu", 1], ["1 animé terminé", 10], ["1 note", 3], ["1 coup de cœur", 2], ["1 avis publié", 20], ["1 « utile » reçu", 5],
  ["1 fan art publié", 30], ["1 message dans une discussion d'épisode", 5], ["1 défi de la semaine", 15], ["Un sans-faute au défi", 25], ["1 vote de saison", 10], ["1 ami", 10]];
const TITLES = [[1, "Novice"], [3, "Spectateur·rice"], [5, "Otaku en herbe"], [8, "Otaku confirmé·e"], [12, "Sensei"], [16, "Maître·sse des animés"], [20, "Légende vivante"]];
const need = l => 50 * (l - 1) ** 2;            // XP nécessaire pour atteindre le niveau l
export function levelOf(xp) {
  const level = Math.floor(Math.sqrt(xp / 50)) + 1;
  const lo = need(level), hi = need(level + 1);
  const title = TITLES.filter(([l]) => level >= l).pop()[1];
  return { level, title, xp, into: xp - lo, span: hi - lo, next: hi, pct: Math.round((xp - lo) / (hi - lo) * 100) };
}

// ---------- Badges ----------
const g = (s, name) => s.genres.get(name) || 0;
/** [id, icône, nom, description, valeur(s, ach), objectif] */
const DEFS = [
  ["first", "🌱", "Premier pas", "Terminer ton premier animé", s => s.watched, 1],
  ["w10", "📺", "Spectateur·rice assidu·e", "Terminer 10 animés", s => s.watched, 10],
  ["w50", "🎬", "Cinéphile de l'anime", "Terminer 50 animés", s => s.watched, 50],
  ["w100", "🏯", "Otaku centenaire", "Terminer 100 animés", s => s.watched, 100],
  ["w250", "👑", "Collection légendaire", "Terminer 250 animés", s => s.watched, 250],
  ["e100", "⏱️", "Cent épisodes", "Voir 100 épisodes", s => s.eps, 100],
  ["e1000", "🔥", "Marathonien·ne", "Voir 1 000 épisodes", s => s.eps, 1000],
  ["e5000", "🌋", "Sans sommeil", "Voir 5 000 épisodes", s => s.eps, 5000],
  ["long", "🏔️", "Longue route", "Terminer un animé de 100 épisodes ou plus", s => s.longest, 100],
  ["films", "🍿", "Soirée ciné", "Terminer 10 films", s => s.films, 10],
  ["retro", "📼", "Rétro", "Terminer un animé sorti avant 1995", s => (s.oldest < 1995 ? 1 : 0), 1],
  ["favs", "💖", "Cœur d'artichaut", "Avoir 10 coups de cœur", s => s.favs, 10],
  ["rate", "⭐", "Critique en herbe", "Noter 25 animés", s => s.rated, 25],
  ["chars", "🧑‍🎤", "Fan de personnages", "Ajouter 10 personnages favoris", s => s.chars, 10],
  ["lists", "🗂️", "Bien rangé·e", "Créer 3 listes", s => s.lists, 3],
  ["action", "⚔️", "Âme de combattant·e", "Terminer 15 animés d'action", s => g(s, "Action"), 15],
  ["romance", "💌", "Romantique", "Terminer 10 romances", s => g(s, "Romance"), 10],
  ["comedy", "😂", "Rire aux éclats", "Terminer 10 comédies", s => g(s, "Comedy"), 10],
  ["horror", "👻", "Nerfs d'acier", "Terminer 5 animés d'horreur", s => g(s, "Horror"), 5],
  ["sports", "🏐", "Esprit d'équipe", "Terminer 5 animés de sport", s => g(s, "Sports"), 5],
  ["mecha", "🤖", "Pilote d'élite", "Terminer 5 animés de mecha", s => g(s, "Mecha"), 5],
  ["review", "✍️", "Première critique", "Publier un avis", (s, a) => a.reviews || 0, 1],
  ["review10", "📝", "Plume reconnue", "Publier 10 avis", (s, a) => a.reviews || 0, 10],
  ["liked", "👍", "Avis apprécié", "Recevoir 10 « utile » sur tes avis", (s, a) => a.likes || 0, 10],
  ["fanart", "🎨", "Artiste", "Publier un fan art", (s, a) => a.fanarts || 0, 1],
  ["posts", "💬", "Bavard·e", "Écrire 10 messages dans les discussions d'épisodes", (s, a) => a.posts || 0, 10],
  ["friend", "🤝", "Sociable", "Avoir un ami", (s, a) => a.friends || 0, 1],
  ["friends10", "🎉", "Populaire", "Avoir 10 amis", (s, a) => a.friends || 0, 10],
  ["quiz", "🎯", "Challenger", "Jouer au défi de la semaine", (s, a) => a.quizzes || 0, 1],
  ["quiz10", "🧠", "Habitué·e des défis", "Jouer à 10 défis de la semaine", (s, a) => a.quizzes || 0, 10],
  ["perfect", "💯", "Sans-faute", "Réussir un défi sans aucune erreur", (s, a) => a.perfect || 0, 1],
  ["vote", "🗳️", "Électeur·rice", "Voter pour l'animé de la saison", (s, a) => a.votes || 0, 1],
  ["goal", "🏁", "Objectif atteint", "Atteindre ton objectif de l'année", (s, a) => (a.goalDone ? 1 : 0), 1],
];
export function badges(s, ach = {}) {
  return DEFS.map(([id, icon, name, desc, f, target]) => { const v = Math.min(target, f(s, ach)); return { id, icon, name, desc, v, target, done: v >= target }; });
}

// ---------- Objectif annuel ----------
let goalP = null;
export function goal(year = new Date().getFullYear(), force = false) {
  if (!ME.user || !supabase) return Promise.resolve(null);
  if (!goalP || force) goalP = supabase.from("user_goals").select("target").eq("year", year).maybeSingle().then(r => (r.error ? null : r.data ? r.data.target : 0), () => null);
  return goalP;
}
export async function setGoal(target, year = new Date().getFullYear()) {
  // pas d'« upsert » : il exigerait le droit de modifier toutes les colonnes
  if (!target) { const { error } = await supabase.from("user_goals").delete().eq("year", year); if (error) throw error; }
  else {
    const { data, error } = await supabase.from("user_goals").update({ target, updated_at: new Date().toISOString() }).eq("year", year).select("year");
    if (error) throw error;
    if (!(data || []).length) { const r = await supabase.from("user_goals").insert({ year, target }); if (r.error) throw r.error; }
  }
  goalP = Promise.resolve(target || 0);
}

// ---------- Semaine du défi (même calcul que le serveur : semaine ISO, heure de Paris) ----------
export function weekKey(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map(x => [x.type, x.value]));
  const t = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);                       // jeudi de la même semaine
  const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}
/** Mon score du défi de cette semaine (ou null). */
export async function myQuiz(week = weekKey()) {
  if (!ME.user || !supabase) return null;
  const { data, error } = await supabase.from("quiz_scores").select("score, total, ms").eq("week", week).maybeSingle();
  if (error) return error.code === "42P01" || /quiz_scores/.test(error.message) ? undefined : null;   // undefined : script SQL pas encore lancé
  return data;
}
