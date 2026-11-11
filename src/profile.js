// Profil de l'utilisateur : pseudo, année de naissance, avatar (table profiles + stockage « avatars »).
import { supabase } from "./supabase.js";

export const USERNAME_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿ_.-]{3,20}$/;
export const USERNAME_HELP = "3 à 20 caractères : lettres, chiffres, _ . -";

/** Vérifie une année de naissance saisie ; renvoie l'année ou null. */
export function parseBirthYear(v) {
  const y = Number(String(v).trim());
  return Number.isInteger(y) && y >= 1900 && y <= new Date().getFullYear() ? y : null;
}

/** Majeur à coup sûr : avec la seule année, l'accès s'ouvre l'année des 19 ans. */
export const isAdultYear = y => !!y && new Date().getFullYear() - y > 18;

/** Vérification locale du format (avant d'interroger le serveur). */
export function usernameFormatError(name) {
  if (!name) return "Choisis un pseudo.";
  if (!USERNAME_RE.test(name) || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(name)) return "Pseudo invalide : " + USERNAME_HELP + ", avec au moins une lettre.";
  return null;
}
const STATUS_MSG = {
  invalid: "Pseudo invalide : " + USERNAME_HELP + ", avec au moins une lettre.",
  forbidden: "Ce pseudo n'est pas autorisé. Choisis-en un autre.",
  taken: "Ce pseudo est déjà pris."
};
/** Interroge le serveur : renvoie null si le pseudo est libre et autorisé, sinon un message. */
export async function usernameProblem(name) {
  const local = usernameFormatError(name);
  if (local) return local;
  const { data, error } = await supabase.rpc("username_status", { name });
  if (error) throw error;
  return data === "ok" ? null : STATUS_MSG[data] || STATUS_MSG.invalid;
}

/** Traduit les erreurs de la base liées au profil et aux textes. */
export function profileErrorMessage(err) {
  const m = (err && (err.message || "")) + " " + (err && err.code || "");
  if (/forbidden_username/.test(m)) return STATUS_MSG.forbidden;
  if (/forbidden_word/.test(m)) return "Ce texte contient un terme interdit (insulte, propos haineux…). Reformule-le.";
  if (/23505|duplicate|profiles_username_key/.test(m)) return STATUS_MSG.taken;
  if (/profiles_username_format/.test(m)) return STATUS_MSG.invalid;
  if (/birth_year_locked/.test(m)) return "L'année de naissance ne peut plus être modifiée.";
  if (/invalid_birth_year/.test(m)) return "Année de naissance invalide.";
  return null;
}

export async function loadProfile() {
  const { data, error } = await supabase.from("profiles").select("username, birth_year, avatar_path").maybeSingle();
  if (error) throw error;
  return data || { username: null, birth_year: null, avatar_path: null, missing: true };
}

/** Crée ou complète le profil. patch : { username?, birth_year?, avatar_path? } */
export async function saveProfile(userId, patch, exists) {
  const q = exists
    ? supabase.from("profiles").update(patch).eq("user_id", userId)
    : supabase.from("profiles").insert({ user_id: userId, ...patch });
  const { error } = await q;
  if (error) throw error;
}

// ---------- Avatar ----------
const AVATAR_SIZE = 256;

/** Recadre en carré, réduit à 256 px et convertit en WebP (supprime au passage les métadonnées : GPS, appareil…). */
export async function prepareAvatar(file) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("format");
  if (file.size > 15 * 1024 * 1024) throw new Error("trop_lourd");
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  canvas.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bmp.close && bmp.close();
  const blob = await new Promise(r => canvas.toBlob(r, "image/webp", 0.85));
  if (blob && blob.type === "image/webp") return blob;
  return new Promise(r => canvas.toBlob(r, "image/jpeg", 0.88)); // navigateurs sans WebP
}

/** Envoie l'avatar, l'enregistre dans le profil et supprime l'ancien fichier. Renvoie le nouveau chemin. */
export async function uploadAvatar(userId, blob, oldPath, profileExists) {
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/${Date.now()}.${ext}`;
  const up = await supabase.storage.from("avatars").upload(path, blob, { contentType: blob.type, upsert: false });
  if (up.error) throw up.error;
  try { await saveProfile(userId, { avatar_path: path }, profileExists); }
  catch (err) { await supabase.storage.from("avatars").remove([path]); throw err; }
  if (oldPath) await supabase.storage.from("avatars").remove([oldPath]);
  return path;
}

export async function removeAvatar(userId, oldPath) {
  await saveProfile(userId, { avatar_path: null }, true);
  if (oldPath) await supabase.storage.from("avatars").remove([oldPath]);
}

/** Supprime tous les fichiers d'avatar de l'utilisateur (avant suppression du compte). */
export async function removeAllAvatars(userId) {
  const { data } = await supabase.storage.from("avatars").list(userId, { limit: 100 });
  if (data && data.length) await supabase.storage.from("avatars").remove(data.map(f => `${userId}/${f.name}`));
}

const urlCache = new Map();
/** URL d'affichage de l'avatar : fichier importé (lien signé, stockage privé), sinon photo Google, sinon null. */
export async function avatarUrl(user, profile) {
  if (profile && profile.avatar_path) {
    if (urlCache.has(profile.avatar_path)) return urlCache.get(profile.avatar_path);
    const { data } = await supabase.storage.from("avatars").createSignedUrl(profile.avatar_path, 60 * 60 * 24);
    if (data && data.signedUrl) { urlCache.set(profile.avatar_path, data.signedUrl); return data.signedUrl; }
  }
  const m = (user && user.user_metadata) || {};
  return m.avatar_url || m.picture || null;
}

/** Nom affiché : pseudo, sinon nom Google, sinon début de l'e-mail. */
export function displayName(user, profile) {
  if (profile && profile.username) return profile.username;
  const m = (user && user.user_metadata) || {};
  return m.full_name || m.name || (user && user.email ? user.email.split("@")[0] : "Mon compte");
}

/** Pastille d'avatar (image ou initiale). */
export function avatarHTML(url, name, cls = "") {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return url
    ? `<img class="av ${cls}" src="${esc(url)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="av ${cls}" aria-hidden="true">${esc((name || "?").trim().charAt(0).toUpperCase() || "?")}</span>`;
}
