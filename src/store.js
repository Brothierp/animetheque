// Accès aux données de collection dans Supabase.
// Toutes les requêtes passent par la clé publique + le jeton de l'utilisateur connecté :
// les règles RLS (supabase/migrations) garantissent que chacun ne voit et ne modifie que ses lignes.
import { supabase } from "./supabase.js";

const PAGE = 1000; // limite par défaut de PostgREST

/** Fonctions qui dépendent du script SQL 20261112000000 (détectées au chargement). */
export const FEATURES = { progress: true, favChars: true };
const missingColumn = err => err && (err.code === "42703" || err.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(err.message || ""));
const missingTable = err => err && (err.code === "42P01" || err.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(err.message || ""));

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/**
 * Charge toute la collection de l'utilisateur connecté.
 * Renvoie { entries: Map<animeId, {f, r, c, s, t, l}>, lists: { [listId]: { n, t } } }
 */
export async function loadCollection() {
  const entriesP = fetchAll("collection_entries", "anime_id, favorite, rating, comment, status, progress, updated_at").catch(err => {
    if (!missingColumn(err)) throw err;
    FEATURES.progress = false;
    return fetchAll("collection_entries", "anime_id, favorite, rating, comment, status, updated_at");
  });
  const favP = fetchAll("favorite_characters", "character_id, created_at").catch(err => {
    if (!missingTable(err)) throw err;
    FEATURES.favChars = false; return [];
  });
  const [entries, lists, items, favs] = await Promise.all([entriesP, fetchAll("lists", "id, name, created_at"), fetchAll("list_items", "list_id, anime_id, added_at"), favP]);
  const map = new Map();
  const get = id => map.get(id) || (map.set(id, { f: false, r: 0, c: "", s: "", p: 0, t: 0, l: {} }), map.get(id));
  for (const e of entries) {
    const x = get(e.anime_id);
    Object.assign(x, { f: e.favorite, r: e.rating || 0, c: e.comment || "", s: e.status || "", p: e.progress || 0, t: Math.max(x.t, Date.parse(e.updated_at)) });
  }
  for (const it of items) {
    const x = get(it.anime_id);
    x.l[it.list_id] = true;
    x.t = Math.max(x.t, Date.parse(it.added_at));
  }
  const L = {};
  for (const l of lists) L[l.id] = { n: l.name, t: Date.parse(l.created_at) };
  const favChars = new Map(favs.map(f => [f.character_id, Date.parse(f.created_at)]));
  return { entries: map, lists: L, favChars };
}

/** Enregistre la partie « fiche » d'un titre (cœur, note, commentaire, statut). Supprime la ligne si elle est vide. */
export async function saveEntry(userId, animeId, e) {
  const empty = !e.f && !e.r && !e.c && !e.s && !e.p;
  if (empty) {
    const { error } = await supabase.from("collection_entries").delete().eq("anime_id", animeId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("collection_entries").upsert(row(userId, animeId, e), { onConflict: "user_id,anime_id" });
  if (error) throw error;
}
function row(userId, animeId, e) {
  const r = { user_id: userId, anime_id: animeId, favorite: !!e.f, rating: e.r || null, comment: e.c ? e.c.slice(0, 280) : null, status: e.s || null };
  if (FEATURES.progress) r.progress = e.p || null;
  return r;
}

/** Import en masse : fiches (par paquets de 500). entries = [{ id, f, r, c, s, p }] */
export async function bulkUpsertEntries(userId, entries, onProgress) {
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500).map(e => row(userId, e.id, e));
    const { error } = await supabase.from("collection_entries").upsert(chunk, { onConflict: "user_id,anime_id" });
    if (error) throw error;
    if (onProgress) onProgress(Math.min(i + 500, entries.length));
  }
}

/** Personnages favoris. */
export async function setFavChar(userId, charId, on) {
  const q = on ? supabase.from("favorite_characters").upsert({ user_id: userId, character_id: charId }, { onConflict: "user_id,character_id", ignoreDuplicates: true })
    : supabase.from("favorite_characters").delete().eq("character_id", charId);
  const { error } = await q;
  if (error) throw error;
}

/** Ajoute ou retire un titre de plusieurs listes. changes = { [listId]: true | false } */
export async function saveListMembership(userId, animeId, changes) {
  const add = Object.keys(changes).filter(k => changes[k]);
  const del = Object.keys(changes).filter(k => !changes[k]);
  if (add.length) {
    const { error } = await supabase.from("list_items")
      .upsert(add.map(list_id => ({ list_id, user_id: userId, anime_id: animeId })), { onConflict: "list_id,anime_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  if (del.length) {
    const { error } = await supabase.from("list_items").delete().eq("anime_id", animeId).in("list_id", del);
    if (error) throw error;
  }
}

/** Retire complètement un titre de la collection (fiche + toutes les listes). */
export async function clearAnime(animeId) {
  const [a, b] = await Promise.all([
    supabase.from("collection_entries").delete().eq("anime_id", animeId),
    supabase.from("list_items").delete().eq("anime_id", animeId)
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
}

export async function createList(userId, name) {
  const { data, error } = await supabase.from("lists").insert({ user_id: userId, name }).select("id, name, created_at").single();
  if (error) throw error;
  return data;
}

export async function deleteList(listId) {
  const { error } = await supabase.from("lists").delete().eq("id", listId);
  if (error) throw error;
}

export async function renameList(listId, name) {
  const { error } = await supabase.from("lists").update({ name }).eq("id", listId);
  if (error) throw error;
}
