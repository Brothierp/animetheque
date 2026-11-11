// Connexion : e-mail + mot de passe (inscription libre), Google, réinitialisation du mot de passe.
import { supabase } from "./supabase.js";

const $ = id => document.getElementById(id);
const dlg = $("auth");
let mode = "signin";
let hooks = {};

/** Vérifie une année de naissance saisie ; renvoie l'année ou null. */
export function parseBirthYear(v) {
  const y = Number(String(v).trim());
  return Number.isInteger(y) && y >= 1900 && y <= new Date().getFullYear() ? y : null;
}

const ERRORS = [
  [/invalid login credentials/i, "E-mail ou mot de passe incorrect."],
  [/email not confirmed/i, "Confirme d'abord ton adresse : clique sur le lien reçu par e-mail."],
  [/user already registered|already been registered/i, "Un compte existe déjà avec cet e-mail. Connecte-toi ou réinitialise ton mot de passe."],
  [/password should be at least|weak.?password/i, "Mot de passe trop faible : 8 caractères minimum, mélange lettres et chiffres."],
  [/rate limit|too many|security purposes/i, "Trop de tentatives. Patiente une minute avant de réessayer."],
  [/unable to validate email|invalid email|email address .* is invalid/i, "Adresse e-mail invalide."],
  [/provider is not enabled/i, "La connexion Google n'est pas encore activée sur ce site."],
  [/same.?password|different from the old/i, "Choisis un mot de passe différent de l'ancien."],
  [/network|fetch/i, "Connexion au serveur impossible. Vérifie ta connexion Internet."]
];
const frError = err => {
  const m = (err && err.message) || "";
  for (const [re, fr] of ERRORS) if (re.test(m)) return fr;
  return "Une erreur est survenue. Réessaie dans un instant.";
};

function msg(text, ok = false) {
  const el = $("authMsg");
  el.textContent = text || "";
  el.hidden = !text;
  el.classList.toggle("ok", ok);
}
function show(view) {
  $("authMain").hidden = view !== "main";
  $("resetForm").hidden = view !== "reset";
  $("newPwdForm").hidden = view !== "newpwd";
  $("birthForm").hidden = view !== "birth";
  $("authTitle").textContent = { main: mode === "signup" ? "Créer un compte" : "Connexion", reset: "Mot de passe oublié", newpwd: "Nouveau mot de passe", birth: "Ton année de naissance" }[view];
  $("authLead").hidden = view !== "main";
  msg("");
}
function setMode(m) {
  mode = m;
  document.querySelectorAll("#auth .tabs button").forEach(b => { const on = b.dataset.mode === m; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
  $("authSubmit").textContent = m === "signup" ? "Créer mon compte" : "Se connecter";
  $("authForm").elements.password.autocomplete = m === "signup" ? "new-password" : "current-password";
  $("forgot").hidden = m === "signup";
  $("birthField").hidden = m !== "signup";
  show("main");
}
async function busy(form, fn) {
  const btns = form.querySelectorAll("button");
  btns.forEach(b => b.disabled = true);
  try { await fn(); } finally { btns.forEach(b => b.disabled = false); }
}

export function openAuth(view = "main") {
  if (!supabase) return;
  if (view === "main") setMode(mode); else show(view);
  if (!dlg.open) dlg.showModal();
}

export function initAuth(h = {}) {
  if (!supabase) return;
  hooks = h;
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); }); // clic sur le fond
  document.querySelectorAll("#auth .tabs button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("forgot").addEventListener("click", () => {
    show("reset");
    $("resetForm").elements.email.value = $("authForm").elements.email.value;
  });
  $("backToLogin").addEventListener("click", () => show("main"));

  $("google").addEventListener("click", async () => {
    msg("");
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) msg(frError(error));
  });

  $("authForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target, email = f.elements.email.value.trim(), password = f.elements.password.value;
    if (!email || !f.elements.email.checkValidity()) return msg("Saisis une adresse e-mail valide.");
    if (password.length < 8) return msg("Le mot de passe doit contenir au moins 8 caractères.");
    const birth = mode === "signup" ? parseBirthYear(f.elements.birth.value) : null;
    if (mode === "signup" && !birth) return msg("Indique ton année de naissance (4 chiffres, ex. 1998).");
    busy(f, async () => {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname, data: { birth_year: birth } } });
        if (error) return msg(frError(error));
        // Supabase ne signale pas les e-mails déjà inscrits (protection contre l'énumération) : identities est alors vide.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
          return msg("Un compte existe déjà avec cet e-mail. Connecte-toi ou réinitialise ton mot de passe.");
        if (!data.session) return msg("Compte créé ! Clique sur le lien de confirmation envoyé à " + email + " pour l'activer.", true);
        dlg.close();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return msg(frError(error));
        f.reset();
        dlg.close();
      }
    });
  });

  $("resetForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target, email = f.elements.email.value.trim();
    if (!email || !f.elements.email.checkValidity()) return msg("Saisis une adresse e-mail valide.");
    busy(f, async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) return msg(frError(error));
      msg("Si un compte existe pour " + email + ", un lien de réinitialisation vient d'être envoyé.", true);
    });
  });

  $("newPwdForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target, password = f.elements.password.value;
    if (password.length < 8) return msg("Le mot de passe doit contenir au moins 8 caractères.");
    busy(f, async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return msg(frError(error));
      f.reset();
      msg("Mot de passe mis à jour. Tu es connecté.", true);
      setTimeout(() => dlg.close(), 1500);
    });
  });

  $("birthLater").addEventListener("click", () => dlg.close());
  $("birthForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target, y = parseBirthYear(f.elements.birth.value);
    if (!y) return msg("Indique une année valide (4 chiffres, ex. 1998).");
    busy(f, async () => {
      try { await hooks.onBirthYear(y); f.reset(); dlg.close(); }
      catch (err) { console.error(err); msg("L'enregistrement a échoué. Réessaie dans un instant."); }
    });
  });

  // Retour d'un lien « mot de passe oublié » : on propose de saisir le nouveau mot de passe.
  supabase.auth.onAuthStateChange(event => {
    if (event === "PASSWORD_RECOVERY") setTimeout(() => openAuth("newpwd"), 0);
  });
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}

/** Nom affiché pour l'utilisateur : nom Google s'il existe, sinon l'e-mail. */
export function displayName(user) {
  const m = user.user_metadata || {};
  return m.full_name || m.name || user.email || "Mon compte";
}
