// Fan arts des membres : accès aux données (Supabase), préparation des images, partage dans la messagerie.
import { supabase } from "./supabase.js";
import { ME } from "./state.js";
import { setFanartResolver, setTokenPreparer } from "./safety.js";

export const FA = { cache: new Map(), missing: false };
const call = async q => { const r = await q; if (r.error) throw r.error; return r.data; };
export const fanartUrl = path => path && supabase ? supabase.storage.from("fanarts").getPublicUrl(path).data.publicUrl : "";
const keep = rows => { for (const r of rows || []) { r.url = fanartUrl(r.path); FA.cache.set(r.id, r); } return rows || []; };
const isMissing = e => e && (e.code === "PGRST202" || e.code === "42883" || e.code === "PGRST205" || /could not find the function/i.test(e.message || ""));

export async function listFanarts({ sort = "recent", character = null, anime = null, user = null, ids = null, limit = 48, offset = 0 } = {}) {
  try {
    return keep(await call(supabase.rpc("fanarts_list", { p_sort: sort, p_character: character, p_anime: anime, p_user: user, p_ids: ids, p_limit: limit, p_offset: offset })));
  } catch (e) { if (isMissing(e)) FA.missing = true; throw e; }
}
export async function getFanart(id) {
  if (FA.cache.has(id)) return FA.cache.get(id);
  const r = await listFanarts({ ids: [id], user: null, limit: 1 });
  if (r[0]) return r[0];
  if (ME.user) { const m = await listFanarts({ ids: [id], user: ME.user.id, limit: 1 }); return m[0] || null; }
  return null;
}
export async function toggleLike(f) {
  if (f.liked) await call(supabase.from("fanart_likes").delete().eq("fanart_id", f.id).eq("user_id", ME.user.id));
  else await call(supabase.from("fanart_likes").insert({ fanart_id: f.id }));
  f.liked = !f.liked; f.likes = Number(f.likes || 0) + (f.liked ? 1 : -1);
}
export async function updateFanart(id, fields) { await call(supabase.from("fanarts").update(fields).eq("id", id)); FA.cache.delete(id); }
export async function deleteFanart(f) {
  await call(supabase.from("fanarts").delete().eq("id", f.id));
  await supabase.storage.from("fanarts").remove([f.path]).catch(() => {});
  FA.cache.delete(f.id);
}
export async function adminFanarts(status = "pending") { return keep(await call(supabase.rpc("admin_fanarts", { p_status: status }))); }
export async function adminPending() { try { return Number(await call(supabase.rpc("admin_pending_fanarts"))) || 0; } catch { return 0; } }

/** Image → WebP (≤ 1600 px, ≤ 3 Mo). Le ré-encodage supprime les métadonnées (position GPS, appareil…). */
export async function prepareImage(file) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("format");
  if (file.size > 20 * 1024 * 1024) throw new Error("size");
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  for (const q of [0.9, 0.8, 0.7, 0.55]) {
    const blob = await new Promise(r => c.toBlob(r, "image/webp", q));
    if (blob && blob.type === "image/webp" && blob.size <= 3 * 1024 * 1024) return { blob, ext: "webp", type: "image/webp", w, h };
  }
  const jpg = await new Promise(r => c.toBlob(r, "image/jpeg", 0.8));
  if (jpg && jpg.size <= 3 * 1024 * 1024) return { blob: jpg, ext: "jpg", type: "image/jpeg", w, h };
  throw new Error("size");
}
export async function publishFanart(file, { title, description, character_id, anime_id }) {
  const img = await prepareImage(file);
  const path = `${ME.user.id}/${crypto.randomUUID()}.${img.ext}`;
  const up = await supabase.storage.from("fanarts").upload(path, img.blob, { contentType: img.type, upsert: false });
  if (up.error) throw up.error;
  try {
    await call(supabase.from("fanarts").insert({ path, width: img.w, height: img.h, title, description: description || null, character_id: character_id || null, anime_id: anime_id || null }));
  } catch (e) { await supabase.storage.from("fanarts").remove([path]).catch(() => {}); throw e; }
}

// Partage dans la messagerie : seuls les fan arts validés (les tiens ou ceux des autres).
setFanartResolver(id => { const f = FA.cache.get(id); return f && f.status === "approved" ? { url: f.url, title: f.title, by: f.username } : null; });
export async function fanartPickerSource(q) {
  const rows = await listFanarts({ sort: "recent", limit: 100 }).catch(() => []);
  const s = (q || "").toLowerCase();
  return rows.filter(f => !s || f.title.toLowerCase().includes(s) || f.username.toLowerCase().includes(s)).slice(0, 24);
}
/** Charge les fan arts cités dans des messages (pour afficher leur carte). */
export async function prepareFanartTokens(bodies) {
  const ids = [...new Set(bodies.flatMap(b => [...(b || "").matchAll(/\[\[fanart:([0-9a-f-]{36})\]\]/g)].map(m => m[1])))].filter(id => !FA.cache.has(id));
  if (ids.length && supabase) await listFanarts({ ids, limit: ids.length }).catch(() => {});
}
setTokenPreparer(prepareFanartTokens);
