// État de l'utilisateur : session, profil, collection et listes. Toutes les vues s'abonnent à onChange.
import { supabase } from "./supabase.js";
import * as store from "./store.js";
import { loadProfile, saveProfile, isAdultYear, profileErrorMessage } from "./profile.js";
import { toast } from "./toast.js";

export const STATUSES = { plan: "Je veux regarder", watching: "En cours", watched: "Regardé", dropped: "Abandonné" };
export const STATUS_SHORT = { plan: "À voir", watching: "En cours", watched: "Vu", dropped: "Abandonné" };

export const ME = { user: null, profile: null, entries: new Map(), lists: {}, favChars: new Map(), ready: false, loading: false };
export { FEATURES } from "./store.js";

const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what, id) => listeners.forEach(fn => { try { fn(what, id); } catch (e) { console.error(e); } });

export const ent = id => ME.entries.get(id) || EMPTY;
const EMPTY = Object.freeze({ f: false, r: 0, c: "", s: "", p: 0, t: 0, l: {} });
export const isEmpty = e => !e.f && !e.r && !e.c && !e.s && !e.p && !Object.values(e.l || {}).some(Boolean);
export const inCollection = id => !isEmpty(ent(id));
export const adultAllowed = () => !!(ME.user && ME.profile && isAdultYear(ME.profile.birth_year));
export const sortedLists = () => Object.entries(ME.lists).filter(([, v]) => v && v.n).sort((a, b) => a[1].t - b[1].t);
export const listItems = lid => [...ME.entries.entries()].filter(([, e]) => e.l[lid]).sort((a, b) => b[1].t - a[1].t).map(([id]) => id);

function local(id) {
  if (!ME.entries.has(id)) ME.entries.set(id, { f: false, r: 0, c: "", s: "", p: 0, t: 0, l: {} });
  return ME.entries.get(id);
}
function prune(id) { const e = ME.entries.get(id); if (e && isEmpty(e)) ME.entries.delete(id); }

// Écritures d'un même titre sérialisées pour respecter l'ordre des clics.
const queues = {};
const enqueue = (key, fn) => { const p = (queues[key] || Promise.resolve()).then(fn); queues[key] = p.catch(() => {}); return p; };

export function errorMessage(err) {
  const p = profileErrorMessage(err);
  if (p && !(err && err.code === "23505" && !/username/.test(err.message || ""))) return p;
  const m = (err && err.message) || "";
  if (/list_limit_reached/.test(m)) return "50 listes maximum.";
  if (err && err.code === "23505") return "Tu as déjà une liste de ce nom.";
  if (err && (err.status === 401 || /JWT/i.test(m))) return "Ta session a expiré : reconnecte-toi.";
  return "L'enregistrement a échoué. Réessaie dans un instant.";
}
function fail(err) { console.error(err); toast(errorMessage(err)); reload(); }

export function requireUser() {
  if (ME.user) return true;
  emit("need-auth");
  return false;
}

/** Modifie la fiche d'un titre (f, r, c, s). Mise à jour immédiate de l'écran, enregistrement en arrière-plan. */
export function setEntry(id, patch) {
  if (!requireUser() || !ME.ready) return;
  const e = local(id);
  Object.assign(e, patch, { t: Date.now() });
  const snap = { f: e.f, r: e.r, c: e.c, s: e.s, p: e.p };
  prune(id); emit("entry", id);
  const uid = ME.user.id;
  return enqueue(id, () => store.saveEntry(uid, id, snap)).catch(fail);
}
/**
 * Épisodes vus. Passe automatiquement en « En cours » au premier épisode et en « Regardé » au dernier.
 * Renvoie le statut appliqué automatiquement (ou "").
 */
export function setProgress(id, n, total) {
  if (!requireUser() || !ME.ready || !FEATURES_REF.progress) return "";
  n = Math.max(0, Math.min(total || 5000, Math.round(n)));
  const cur = ent(id), patch = { p: n };
  let auto = "";
  if (total && n >= total && cur.s !== "watched") { patch.s = "watched"; auto = "watched"; }
  else if (n > 0 && (!cur.s || cur.s === "plan")) { patch.s = "watching"; auto = "watching"; }
  setEntry(id, patch);
  return auto;
}
export async function toggleFavChar(cid) {
  if (!requireUser() || !ME.ready) return;
  if (!FEATURES_REF.favChars) { toast("Les personnages favoris seront disponibles après la mise à jour de la base de données."); return; }
  const on = !ME.favChars.has(cid);
  if (on) ME.favChars.set(cid, Date.now()); else ME.favChars.delete(cid);
  emit("favchar", cid);
  try { await store.setFavChar(ME.user.id, cid, on); }
  catch (err) { fail(err); }
  return on;
}
/** Import en masse (MyAnimeList / AniList). items = [{ id, f, r, c, s, p }] ; fusion avec la collection existante. */
export async function importEntries(items, onProgress) {
  if (!requireUser() || !ME.ready) return 0;
  const merged = items.map(it => {
    const e = ent(it.id);
    return { id: it.id, f: e.f || !!it.f, r: it.r || e.r || 0, c: e.c || it.c || "", s: it.s || e.s || "", p: Math.max(e.p || 0, it.p || 0) };
  });
  await store.bulkUpsertEntries(ME.user.id, merged, onProgress);
  for (const m of merged) Object.assign(local(m.id), { f: m.f, r: m.r, c: m.c, s: m.s, p: m.p, t: Date.now() });
  emit("collection");
  return merged.length;
}
const FEATURES_REF = store.FEATURES;

export function setInList(id, lid, on) {
  if (!requireUser() || !ME.ready) return;
  const e = local(id);
  if (!!e.l[lid] === on) return;
  if (on) e.l[lid] = true; else delete e.l[lid];
  e.t = Date.now(); prune(id); emit("entry", id);
  const uid = ME.user.id;
  return enqueue(id, () => store.saveListMembership(uid, id, { [lid]: on })).catch(fail);
}
export function clearAnime(id) {
  if (!requireUser()) return;
  ME.entries.delete(id); emit("entry", id);
  return enqueue(id, () => store.clearAnime(id)).catch(fail);
}
export async function createList(name) {
  if (!requireUser()) return null;
  name = name.trim().slice(0, 40);
  if (!name) return null;
  if (Object.values(ME.lists).some(v => v.n.toLowerCase() === name.toLowerCase())) { toast("Tu as déjà une liste de ce nom."); return null; }
  if (Object.keys(ME.lists).length >= 50) { toast("50 listes maximum."); return null; }
  try {
    const row = await store.createList(ME.user.id, name);
    ME.lists[row.id] = { n: row.name, t: Date.parse(row.created_at) };
    emit("lists"); return row.id;
  } catch (err) { console.error(err); toast(errorMessage(err)); return null; }
}
export async function renameList(lid, name) {
  name = name.trim().slice(0, 40);
  if (!name || !ME.lists[lid]) return false;
  if (Object.entries(ME.lists).some(([k, v]) => k !== lid && v.n.toLowerCase() === name.toLowerCase())) { toast("Tu as déjà une liste de ce nom."); return false; }
  try { await store.renameList(lid, name); ME.lists[lid].n = name; emit("lists"); return true; }
  catch (err) { console.error(err); toast(errorMessage(err)); return false; }
}
export async function deleteList(lid) {
  try {
    await store.deleteList(lid);
    delete ME.lists[lid];
    for (const [id, e] of ME.entries) { delete e.l[lid]; prune(id); }
    emit("lists"); return true;
  } catch (err) { console.error(err); toast(errorMessage(err)); return false; }
}
export async function updateProfile(patch) {
  await saveProfile(ME.user.id, patch, !ME.profile.missing);
  ME.profile = { ...ME.profile, ...patch, missing: false };
  emit("profile");
}
export const setProfileLocal = patch => { ME.profile = { ...ME.profile, ...patch, missing: false }; emit("profile"); };

async function reload() {
  if (!ME.user || ME.loading) return;
  const uid = ME.user.id, first = !ME.ready;
  ME.loading = true;
  try {
    const [col, profile] = await Promise.all([store.loadCollection(), loadProfile()]);
    if (!ME.user || ME.user.id !== uid) return;
    ME.entries = col.entries; ME.lists = col.lists; ME.favChars = col.favChars; ME.profile = profile; ME.ready = true;
    emit("collection");
    if (first) emit("profile-loaded");
  } catch (err) {
    console.error(err); toast("Ta collection n'a pas pu être chargée. Recharge la page plus tard.");
  } finally { ME.loading = false; }
}

function onSession(session) {
  const user = session ? session.user : null;
  if (user && ME.user && ME.user.id === user.id) { ME.user = user; return; } // simple rafraîchissement de jeton
  ME.user = user; ME.profile = null; ME.entries = new Map(); ME.lists = {}; ME.favChars = new Map(); ME.ready = false;
  emit("session");
  if (user) reload();
}

export function initSession() {
  if (!supabase) { emit("session"); return; }
  // Ne pas appeler Supabase directement dans ce rappel (verrou interne) : on diffère.
  supabase.auth.onAuthStateChange((event, session) => setTimeout(() => onSession(session), 0));
}
