// Accès aux données de collection dans Supabase.
// Toutes les requêtes passent par la clé publique + le jeton de l'utilisateur connecté :
// les règles RLS (supabase/migrations) garantissent que chacun ne voit et ne modifie que ses lignes.
import { supabase } from "./supabase.js";

const PAGE = 1000; // limite par défaut de PostgREST

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
  const [entries, lists, items] = await Promise.all([
    fetchAll("collection_entries", "anime_id, favorite, rating, comment, status, updated_at"),
    fetchAll("lists", "id, name, created_at"),
    fetchAll("list_items", "list_id, anime_id, added_at")
  ]);
  const map = new Map();
  const get = id => map.get(id) || (map.set(id, { f: false, r: 0, c: "", s: "", t: 0, l: {} }), map.get(id));
  for (const e of entries) {
    const x = get(e.anime_id);
    Object.assign(x, { f: e.favorite, r: e.rating || 0, c: e.comment || "", s: e.status || "", t: Math.max(x.t, Date.parse(e.updated_at)) });
  }
  for (const it of items) {
    const x = get(it.anime_id);
    x.l[it.list_id] = true;
    x.t = Math.max(x.t, Date.parse(it.added_at));
  }
  const L = {};
  for (const l of lists) L[l.id] = { n: l.name, t: Date.parse(l.created_at) };
  return { entries: map, lists: L };
}

/** Enregistre la partie « fiche » d'un titre (cœur, note, commentaire, statut). Supprime la ligne si elle est vide. */
export async function saveEntry(userId, animeId, e) {
  const empty = !e.f && !e.r && !e.c && !e.s;
  if (empty) {
    const { error } = await supabase.from("collection_entries").delete().eq("anime_id", animeId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("collection_entries").upsert({
    user_id: userId, anime_id: animeId, favorite: !!e.f, rating: e.r || null,
    comment: e.c ? e.c.slice(0, 280) : null, status: e.s || null
  }, { onConflict: "user_id,anime_id" });
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
