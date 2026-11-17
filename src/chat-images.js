// Images envoyées dans les conversations : stockage privé, visibles seulement par l'expéditeur, le destinataire
// (après vérification si un mineur participe) et l'administrateur. Jamais publiées dans la galerie.
import { supabase } from "./supabase.js";
import { ME } from "./state.js";
import { prepareImage } from "./fanart-api.js";
import { setImageResolver, setTokenPreparer } from "./safety.js";
import { scanImage, NSFW } from "./nsfw.js";

const BUCKET = "chat-images";
const CI = new Map();   // id → { status, url, w, h }
const call = async q => { const r = await q; if (r.error) throw r.error; return r.data; };

async function sign(rows) {
  const L = rows.filter(r => r.path);
  if (!L.length) return;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(L.map(r => r.path), 3600);
  const byPath = new Map((data || []).filter(x => x && x.signedUrl && !x.error).map(x => [x.path, x.signedUrl]));
  for (const r of L) { const c = CI.get(r.id); if (c) c.url = byPath.get(r.path) || ""; }
}

/** Envoie l'image vers le stockage privé ; renvoie le jeton à mettre dans le message. */
export async function uploadChatImage(file, recipient, { minor = false } = {}) {
  const img = await prepareImage(file);
  // analyse automatique : refusée d'emblée si un mineur est concerné et que l'image semble à caractère sexuel
  const ai = await scanImage(img.blob);
  if (minor && ai && ai.score >= NSFW.BLOCK) throw new Error("nsfw");
  const id = crypto.randomUUID(), path = `${ME.user.id}/${id}.${img.ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, img.blob, { contentType: img.type, upsert: false });
  if (up.error) throw up.error;
  try {
    const base = { id, recipient, path, width: img.w, height: img.h };
    let row;
    try { row = await call(supabase.from("chat_images").insert(ai ? { ...base, ai_score: +ai.score.toFixed(3) } : base).select("id, status").single()); }
    catch (e) { if (!/PGRST204|ai_score/.test((e.code || "") + (e.message || ""))) throw e; row = await call(supabase.from("chat_images").insert(base).select("id, status").single()); }
    CI.set(id, { status: row.status, url: URL.createObjectURL(img.blob), w: img.w, h: img.h });
    return `[[image:${id}]]`;
  } catch (e) { await supabase.storage.from(BUCKET).remove([path]).catch(() => {}); throw e; }
}

/** Charge les images citées dans des messages (statut + adresse temporaire). */
async function prepare(bodies) {
  const ids = [...new Set(bodies.flatMap(b => [...(b || "").matchAll(/\[\[image:([0-9a-f-]{36})\]\]/g)].map(m => m[1])))].filter(id => !CI.has(id));
  if (!ids.length || !supabase) return;
  const rows = await call(supabase.from("chat_images").select("id, path, status, width, height").in("id", ids));
  for (const r of rows) CI.set(r.id, { status: r.status, url: "", w: r.width, h: r.height });
  await sign(rows);
}
setTokenPreparer(prepare);
setImageResolver(id => CI.get(id) || null);

// ---------- Administration ----------
export async function adminChatImages(status = "pending") {
  const rows = await call(supabase.rpc("admin_chat_images", { p_status: status }));
  const { data } = rows.length ? await supabase.storage.from(BUCKET).createSignedUrls(rows.map(r => r.path), 3600) : { data: [] };
  const urls = new Map((data || []).map(x => [x.path, x.signedUrl]));
  return rows.map(r => ({ ...r, url: urls.get(r.path) || "" }));
}
export async function adminPendingChatImages() { try { return Number(await call(supabase.rpc("admin_pending_chat_images"))) || 0; } catch { return 0; } }
export async function reviewChatImage(id, status) { await call(supabase.from("chat_images").update({ status }).eq("id", id)); CI.delete(id); }
export async function deleteChatImage(r) {
  await call(supabase.from("chat_images").delete().eq("id", r.id));
  await supabase.storage.from(BUCKET).remove([r.path]).catch(() => {});
}
