// Vue « Mon compte » : avatar, pseudo, informations, mot de passe, suppression du compte.
import { supabase } from "../supabase.js";
import { ME, updateProfile, setProfileLocal, onChange } from "../state.js";
import { frError, signOut } from "../auth.js";
import { displayName, avatarUrl, avatarHTML, isAdultYear, parseBirthYear, usernameFormatError, usernameProblem,
  prepareAvatar, uploadAvatar, removeAvatar, removeAllAvatars, USERNAME_HELP } from "../profile.js";
import { $, esc, fmt } from "../ui.js";
import { toast } from "../toast.js";
import { gate } from "./collection.js";

let root = null;

function html() {
  const u = ME.user, p = ME.profile, name = displayName(u, p);
  const providers = (u.app_metadata && u.app_metadata.providers) || [u.app_metadata && u.app_metadata.provider].filter(Boolean);
  const E = [...ME.entries.values()];
  return `<div class="page acc2">
    <div class="cat-top"><h1>Mon compte</h1><button type="button" class="btn" id="signOut2">Se déconnecter</button></div>
    <section class="card2 idcard">
      <span id="bigAvatar">${avatarHTML(null, name, "big")}</span>
      <div class="who"><b>${esc(name)}</b><span class="hint">${esc(u.email || "")}</span>
        <div class="avbtns"><label class="btn sm" for="avatarFile">Changer l'avatar</label><input type="file" id="avatarFile" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
        ${p.avatar_path ? `<button type="button" class="btn sm" id="avatarRemove">Retirer</button>` : ""}</div>
        <span class="hint">JPG, PNG ou WebP. Recadré en carré ; position GPS et autres informations cachées supprimées.</span></div>
      <div class="minis">
        <a href="#/collection/all"><b>${fmt(E.filter(e => e.f || e.r || e.c || e.s || Object.keys(e.l).length).length)}</b><span>titres</span></a>
        <a href="#/collection/fav"><b>${fmt(E.filter(e => e.f).length)}</b><span>coups de cœur</span></a>
        <a href="#/listes"><b>${Object.keys(ME.lists).length}</b><span>listes</span></a>
      </div>
    </section>
    <section class="card2"><h2>Informations</h2><div class="fields">
      <div class="field"><span>Pseudo</span>
        <form id="usernameForm" novalidate><input type="text" name="username" maxlength="20" value="${esc(p.username || "")}" autocomplete="username" spellcheck="false" placeholder="ex. Frieren_fan"><button class="btn primary" type="submit">Enregistrer</button></form>
        <small class="ustate" id="usernameState">${USERNAME_HELP}</small></div>
      <div class="field"><span>E-mail</span><div class="val">${esc(u.email || "—")}</div></div>
      <div class="field"><span>Connexion</span><div class="val">${providers.map(x => x === "google" ? "Google" : x === "email" ? "E-mail et mot de passe" : esc(x)).join(" · ") || "—"}</div></div>
      <div class="field"><span>Année de naissance</span>
        ${p.birth_year ? `<div class="val">${p.birth_year} · ${isAdultYear(p.birth_year) ? "accès au contenu 18+" : "contenu 18+ non accessible"}</div>`
          : `<form id="birthForm" novalidate><input type="number" name="birth" inputmode="numeric" min="1900" placeholder="ex. 1998"><button class="btn primary" type="submit">Enregistrer</button></form>`}
        <small>Sert uniquement à réserver le contenu adulte aux majeurs. Ne peut être saisie qu'une fois.</small></div>
      ${providers.includes("email") ? `<div class="field"><span>Mot de passe</span><form id="pwdForm" novalidate><input type="password" name="password" autocomplete="new-password" minlength="8" placeholder="Nouveau mot de passe (8 caractères min.)"><button class="btn" type="submit">Modifier</button></form></div>` : ""}
      <div class="field"><span>Membre depuis</span><div class="val">${new Date(u.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</div></div>
    </div></section>
    <section class="card2 danger-zone"><h2>Supprimer mon compte</h2>
      <p class="hint">Ton compte, ton profil, ton avatar, ta collection et tes listes seront effacés immédiatement et définitivement.</p>
      <form id="deleteForm" class="newlist" novalidate><input type="text" name="confirm" autocomplete="off" placeholder="Tape SUPPRIMER pour confirmer"><button class="btn danger" type="submit">Supprimer mon compte</button></form>
    </section>
  </div>`;
}

function bind() {
  $("signOut2").addEventListener("click", async () => { await signOut(); location.hash = "#/"; toast("Déconnecté"); });
  let ut, seq = 0;
  const uf = $("usernameForm"), st = $("usernameState");
  uf.elements.username.addEventListener("input", e => {
    clearTimeout(ut); const v = e.target.value.trim(), my = ++seq; st.className = "ustate";
    if (!v || v === ME.profile.username) { st.textContent = USERNAME_HELP; return; }
    const local = usernameFormatError(v); if (local) { st.textContent = local; st.classList.add("bad"); return; }
    st.textContent = "Vérification…";
    ut = setTimeout(async () => { try { const pb = await usernameProblem(v); if (my !== seq) return; st.textContent = pb || "Pseudo disponible ✓"; st.classList.add(pb ? "bad" : "good"); } catch { /* réseau */ } }, 400);
  });
  uf.addEventListener("submit", async e => {
    e.preventDefault(); clearTimeout(ut); seq++;
    const u = uf.elements.username.value.trim(); if (u === ME.profile.username) return;
    const btn = uf.querySelector("button"); btn.disabled = true;
    try { const pb = await usernameProblem(u); if (pb) { toast(pb); return; } await updateProfile({ username: u }); toast("Pseudo enregistré"); }
    catch (err) { console.error(err); toast(frError(err)); } finally { btn.disabled = false; }
  });
  const bf = $("birthForm");
  if (bf) bf.addEventListener("submit", async e => {
    e.preventDefault(); const y = parseBirthYear(bf.elements.birth.value);
    if (!y) return toast("Indique une année valide (4 chiffres, ex. 1998).");
    if (!confirm(`Confirmer l'année ${y} ? Elle ne pourra plus être modifiée.`)) return;
    try { await updateProfile({ birth_year: y }); toast("Année enregistrée"); } catch (err) { console.error(err); toast(frError(err)); }
  });
  const pf = $("pwdForm");
  if (pf) pf.addEventListener("submit", async e => {
    e.preventDefault(); const pw = pf.elements.password.value;
    if (pw.length < 8) return toast("Le mot de passe doit contenir au moins 8 caractères.");
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return toast(frError(error)); pf.reset(); toast("Mot de passe modifié");
  });
  $("avatarFile").addEventListener("change", async e => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    toast("Envoi de l'avatar…");
    try {
      const blob = await prepareAvatar(file);
      const path = await uploadAvatar(ME.user.id, blob, ME.profile.avatar_path, !ME.profile.missing);
      setProfileLocal({ avatar_path: path }); toast("Avatar mis à jour");
    } catch (err) {
      console.error(err);
      toast(err.message === "format" ? "Format non pris en charge : choisis une image JPG, PNG ou WebP." : err.message === "trop_lourd" ? "Image trop lourde (15 Mo maximum)." : "L'envoi de l'avatar a échoué. Réessaie.");
    }
  });
  const ar = $("avatarRemove");
  if (ar) ar.addEventListener("click", async () => {
    try { await removeAvatar(ME.user.id, ME.profile.avatar_path); setProfileLocal({ avatar_path: null }); toast("Avatar retiré"); }
    catch (err) { console.error(err); toast(frError(err)); }
  });
  $("deleteForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (e.target.elements.confirm.value.trim().toUpperCase() !== "SUPPRIMER") return toast("Tape SUPPRIMER (en majuscules) pour confirmer.");
    const btn = e.target.querySelector("button"); btn.disabled = true;
    try {
      await removeAllAvatars(ME.user.id).catch(() => {});
      const { error } = await supabase.rpc("delete_my_account"); if (error) throw error;
      await supabase.auth.signOut({ scope: "local" });
      location.hash = "#/"; toast("Ton compte et toutes tes données ont été supprimés.", 5000);
    } catch (err) { console.error(err); toast("La suppression a échoué. Réessaie dans un instant."); btn.disabled = false; }
  });
}

async function paintAvatar() {
  const u = ME.user; if (!u || !$("bigAvatar")) return;
  const url = await avatarUrl(u, ME.profile);
  if (url && ME.user && ME.user.id === u.id && $("bigAvatar")) $("bigAvatar").innerHTML = avatarHTML(url, displayName(u, ME.profile), "big");
}

export function render(el) {
  root = el;
  if (!ME.user) { el.innerHTML = gate("Mon compte", "Connecte-toi pour gérer ton profil, ton avatar et ton compte."); return; }
  if (!ME.ready || !ME.profile) { el.innerHTML = `<div class="page"><p class="loading">Chargement de ton compte…</p></div>`; return; }
  el.innerHTML = html(); bind(); paintAvatar();
}
onChange(what => {
  if (!root || !root.isConnected) return;
  if (["session", "collection", "profile"].includes(what)) {
    const a = document.activeElement; if (a && root.contains(a) && a.tagName === "INPUT" && what === "profile" && a.type !== "file") { paintAvatar(); return; }
    render(root);
  }
});
