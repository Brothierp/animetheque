// Vue « Mon compte » : avatar, pseudo, informations, mot de passe, suppression du compte.
import { supabase } from "../supabase.js";
import { ME, updateProfile, setProfileLocal, onChange } from "../state.js";
import { frError, signOut } from "../auth.js";
import { displayName, avatarUrl, avatarHTML, isAdultYear, parseBirthYear, ageGate, tooYoungYear, MIN_AGE_MSG, usernameFormatError, usernameProblem,
  prepareAvatar, uploadAvatar, removeAvatar, removeAllAvatars, USERNAME_HELP } from "../profile.js";
import { $, esc, fmt } from "../ui.js";
import { byId } from "../data.js";
import { canInstall, install } from "../install.js";
import { shareUrl, shareLink } from "./public.js";
import { pushState, enablePush, disablePush, testPush, pushError } from "../push.js";
import { toast } from "../toast.js";
import { gate } from "./collection.js";
import { importHTML, bindImport } from "./importer.js";
import { mySuggestionsHTML, bindMySuggestions } from "../feedback.js";

let root = null;
const isShown = () => !!(root && root.isConnected && root.dataset.view === "compte");   // page réellement affichée ?

function html() {
  const u = ME.user, p = ME.profile, name = displayName(u, p);
  const providers = (u.app_metadata && u.app_metadata.providers) || [u.app_metadata && u.app_metadata.provider].filter(Boolean);
  const E = [...ME.entries.values()];
  return `<div class="page acc2">
    <div class="cat-top"><h1>Mon compte</h1><div class="cat-tools">${ME.isAdmin ? `<a class="btn primary" href="#/admin">Espace administrateur</a>` : ME.isStaff ? `<a class="btn primary" href="#/admin/signalements">Espace modération</a>` : ""}<button type="button" class="btn" id="signOut2">Se déconnecter</button></div></div>
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
        ${p.age_flag ? `<div class="val">${p.declared_year || ""} · <b>compte traité comme ${p.age_flag === "under15" ? "ayant moins de 15 ans" : "mineur"}</b> par l'équipe de modération</div>`
          : p.birth_year ? `<div class="val">${p.birth_year} · ${isAdultYear(p.birth_year) ? "accès au contenu 18+" : "contenu 18+ non accessible"}</div>`
          : `<form id="birthForm" novalidate><input type="number" name="birth" inputmode="numeric" min="1900" placeholder="ex. 1998"><button class="btn primary" type="submit">Enregistrer</button></form>`}
        <small>Inscription à partir de 15 ans ; sert aussi à réserver le contenu adulte aux majeurs. Ne peut être saisie qu'une fois.</small></div>
      ${p.age_flag ? `<p class="imp-err">D'après des éléments de ton activité, l'équipe de modération pense que ton âge réel ne correspond pas à l'année indiquée. Ton compte est donc traité comme celui ${p.age_flag === "under15" ? "d'une personne de moins de 15 ans : amis, messagerie, avis et fan arts sont désactivés" : "d'une personne mineure : pas de contenu 18+, pas de profil public, et les échanges avec des majeurs ne sont pas possibles"}. Ta collection reste accessible. Si c'est une erreur, explique-le-nous avec le bouton « 💡 Suggestion » : l'administrateur te répondra ici.</p>`
        : tooYoungYear(p.birth_year) ? `<p class="imp-err">Ton compte est limité : l'Animéthèque est désormais réservée aux 15 ans et plus (en France, avant 15 ans, il faut l'accord d'un parent). Ta collection reste accessible, mais les amis, la messagerie, les avis et les fan arts sont désactivés jusqu'à l'année de tes 15 ans. Tu peux aussi supprimer ton compte en bas de cette page.</p>` : ""}
      ${providers.includes("email") ? `<div class="field"><span>Mot de passe</span><form id="pwdForm" novalidate><input type="password" name="password" autocomplete="new-password" minlength="8" placeholder="Nouveau mot de passe (8 caractères min.)"><button class="btn" type="submit">Modifier</button></form></div>` : ""}
      <div class="field"><span>Membre depuis</span><div class="val">${new Date(u.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</div></div>
    </div></section>
    ${"public_profile" in p && isAdultYear(p.birth_year) && p.username ? `<section class="card2"><h2>Profil public</h2>
      <label class="chk"><input type="checkbox" id="pubProfile"${p.public_profile ? " checked" : ""}><span><b>Rendre mon profil public</b> : pseudo, nombre de titres, coups de cœur, titres notés 5 ★ et listes publiques, visibles par toute personne qui a le lien. Jamais ton e-mail, ton âge ni le reste de ta collection.</span></label>
      ${p.public_profile ? `<p class="pub-link"><code>${esc(shareUrl("u", p.username))}</code> <button type="button" class="btn sm primary" id="pubShare">📤 Partager mon profil</button> <a class="btn sm" href="#/u/${encodeURIComponent(p.username)}">Voir</a></p>` : ""}</section>` : ""}
    ${"share_activity" in p ? `<section class="card2"><h2>Partage avec mes amis</h2>
      <label class="chk"><input type="checkbox" id="shareAct"${p.share_activity ? " checked" : ""}><span><b>Partager mon activité avec mes amis</b> : titres commencés et terminés, notes de 4 ou 5 étoiles, coups de cœur, avis et fan arts publiés. Visible uniquement par tes amis, dans « Amis → Activité » ; tes coups de cœur et meilleures notes apparaissent aussi dans leur rangée « Adorés par tes amis ». Ta collection complète reste privée.</span></label></section>` : ""}
    <section class="card2"><h2>Jeu</h2><p class="hint" style="margin-top:0">Ton niveau, tes badges, ton objectif de l'année et le défi de la semaine.</p><a class="btn" href="#/jeu">🏅 Ma progression</a> <a class="btn" href="#/jeu/defi">🎯 Défi de la semaine</a></section>
    ${canInstall() ? `<section class="card2"><h2>Application</h2><p class="hint" style="margin-top:0">Ajoute l'Animéthèque à ton écran d'accueil : elle s'ouvrira comme une appli, en plein écran.</p><button type="button" class="btn" id="installBtn">📲 Installer l'appli</button></section>` : ""}
    <section class="card2" id="pushCard"><h2>Notifications sur cet appareil</h2><div id="pushBox"><p class="hint">Vérification…</p></div></section>
    ${mySuggestionsHTML()}
    ${importHTML()}
    <section class="card2"><h2>Exporter mes données</h2>
      <p class="hint" style="margin-top:0">Télécharge une copie complète de ton profil, ta collection (statuts, notes, avis, épisodes vus), tes listes et tes personnages favoris, au format JSON.</p>
      <button type="button" class="btn" id="exportBtn">Télécharger mes données</button></section>
    <section class="card2 danger-zone"><h2>Supprimer mon compte</h2>
      <p class="hint">Ton compte, ton profil, ton avatar, ta collection et tes listes seront effacés immédiatement et définitivement.</p>
      <form id="deleteForm" class="newlist" novalidate><input type="text" name="confirm" autocomplete="off" placeholder="Tape SUPPRIMER pour confirmer"><button class="btn danger" type="submit">Supprimer mon compte</button></form>
    </section>
  </div>`;
}

function exportData() {
  const titleOf = id => { const a = byId.get(id); return a ? a.english || a.romaji : null; };
  const out = {
    export: "Animéthèque", date: new Date().toISOString(),
    profil: { pseudo: ME.profile.username, email: ME.user.email, annee_naissance: ME.profile.declared_year || ME.profile.birth_year, inscrit_le: ME.user.created_at },
    collection: [...ME.entries.entries()].map(([id, e]) => ({ anilist_id: id, titre: titleOf(id), statut: e.s || null, note_sur_5: e.r || null,
      coup_de_coeur: !!e.f, avis: e.c || null, episodes_vus: e.p || null, listes: Object.keys(e.l).map(k => ME.lists[k] && ME.lists[k].n).filter(Boolean) })),
    listes: Object.values(ME.lists).map(l => l.n),
    personnages_favoris: [...ME.favChars.keys()]
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `animetheque-${(ME.profile.username || "export").replace(/[^\w.-]/g, "_")}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Export téléchargé");
}
function bind() {
  bindImport(); bindMySuggestions();
  $("exportBtn").addEventListener("click", exportData);
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
  paintPush();
  const ib = $("installBtn"); if (ib) ib.addEventListener("click", () => install());
  const pp = $("pubProfile");
  if (pp) pp.addEventListener("change", async () => {
    try { await updateProfile({ public_profile: pp.checked }); toast(pp.checked ? "Ton profil est public : partage son lien 🌍" : "Ton profil n'est plus public"); render(root); }
    catch (err) { pp.checked = !pp.checked; toast(frError(err)); }
  });
  const ps = $("pubShare"); if (ps) ps.addEventListener("click", () => shareLink(shareUrl("u", p.username), `Mon profil anime : ${p.username}`));
  const sa = $("shareAct");
  if (sa) sa.addEventListener("change", async () => {
    try { await updateProfile({ share_activity: sa.checked }); toast(sa.checked ? "Ton activité est partagée avec tes amis" : "Ton activité n'est plus partagée"); }
    catch (err) { sa.checked = !sa.checked; toast(frError(err)); }
  });
  const bf = $("birthForm");
  if (bf) bf.addEventListener("submit", async e => {
    e.preventDefault(); const y = parseBirthYear(bf.elements.birth.value);
    if (!y) return toast("Indique une année valide (4 chiffres, ex. 1998).");
    const g = ageGate(y); if (g) return toast(g, 7000);
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
  if (!isShown()) return;
  if (["session", "collection", "profile"].includes(what)) {
    const a = document.activeElement; if (a && root.contains(a) && a.tagName === "INPUT" && what === "profile" && a.type !== "file") { paintAvatar(); return; }
    render(root);
  }
});

// ---------- Notifications sur l'appareil ----------
async function paintPush() {
  const box = $("pushBox"); if (!box) return;
  const st = await pushState().catch(() => "unsupported");
  const T = {
    on: `<p>✅ <b>Activées sur cet appareil.</b> Tu es prévenu·e des nouveaux épisodes de tes séries en cours, des messages, des demandes d'amis et des réponses, même site fermé.</p>
      <p class="hint">Le site vérifie les nouveaux épisodes toutes les heures, pour les séries au statut « En cours » de ta collection.</p>
      <div class="rep-act"><button type="button" class="btn sm" data-push="test">Envoyer une notification de test</button><button type="button" class="btn sm danger-o" data-push="off">Désactiver sur cet appareil</button></div>`,
    off: `<p>Sois prévenu·e <b>dès qu'un épisode de tes séries en cours sort</b>, quand un ami t'écrit ou te répond, même quand le site est fermé.</p>
      <button type="button" class="btn primary" data-push="on">🔔 Activer les notifications</button>`,
    denied: `<p class="imp-err">Les notifications sont bloquées pour ce site. Autorise-les dans les réglages du navigateur (icône 🔒 à gauche de l'adresse), puis recharge la page.</p>`,
    "ios-install": `<p>Sur iPhone, les notifications fonctionnent une fois l'Animéthèque <b>installée sur l'écran d'accueil</b> (iOS 16.4 ou plus récent) : bouton Partager ⬆️ → « Sur l'écran d'accueil », puis ouvre l'appli depuis son icône et reviens ici.</p>`,
    unsupported: `<p class="hint">Ce navigateur ne gère pas les notifications. Essaie avec Chrome, Edge, Firefox ou Safari récent.</p>`,
  };
  box.innerHTML = T[st] || T.unsupported;
  box.onclick = async e => {
    const b = e.target.closest("[data-push]"); if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.push === "on") { await enablePush(); toast("🔔 Notifications activées sur cet appareil"); }
      else if (b.dataset.push === "off") { await disablePush(); toast("Notifications désactivées sur cet appareil"); }
      else { await testPush(); toast("Notification de test envoyée : elle arrive dans quelques secondes"); }
    } catch (err) { toast(pushError(err), 6000); }
    paintPush();
  };
}
