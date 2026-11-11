// Connexion : e-mail + mot de passe (inscription libre), Google, réinitialisation du mot de passe,
// et écran « Complète ton profil » (pseudo, année de naissance) après une première connexion Google.
// La fenêtre est créée ici pour être partagée par toutes les pages.
import { supabase } from "./supabase.js";
import { parseBirthYear, usernameFormatError, usernameProblem, profileErrorMessage, USERNAME_HELP } from "./profile.js";

export { parseBirthYear };

const $ = id => document.getElementById(id);
let dlg = null;
let mode = "signin";
let hooks = {};

const DIALOG_HTML = `
<dialog id="auth" aria-labelledby="authTitle">
  <form method="dialog" class="auth-close"><button class="x" aria-label="Fermer">×</button></form>
  <h2 id="authTitle">Connexion</h2>
  <p class="hint" id="authLead">Ta collection (coups de cœur, notes, statuts, listes) est privée : toi seul y as accès.</p>

  <div id="authMain">
    <button type="button" class="btn google" id="google">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1-3.3 0-6-2.74-6-6.2s2.7-6.2 6-6.2c1.88 0 3.14.8 3.86 1.49l2.63-2.54C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.66 0 9.4-3.98 9.4-9.58 0-.64-.07-1.14-.16-1.62H12z"/></svg>
      Continuer avec Google
    </button>
    <div class="or"><span>ou par e-mail</span></div>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" data-mode="signin" class="on" aria-selected="true">Se connecter</button>
      <button type="button" role="tab" data-mode="signup" aria-selected="false">Créer un compte</button>
    </div>
    <form id="authForm" class="authform" novalidate>
      <label id="usernameField" hidden>Pseudo <input type="text" name="username" maxlength="20" autocomplete="username" spellcheck="false" placeholder="ex. Frieren_fan">
        <small class="ustate" data-for="authForm">${USERNAME_HELP}</small></label>
      <label>E-mail <input type="email" name="email" autocomplete="email" required></label>
      <label>Mot de passe <input type="password" name="password" autocomplete="current-password" minlength="8" required></label>
      <label id="birthField" hidden>Année de naissance <input type="number" name="birth" inputmode="numeric" min="1900" placeholder="ex. 1998" autocomplete="bday-year">
        <small>Sert uniquement à réserver le contenu adulte aux majeurs. Elle ne pourra plus être modifiée.</small></label>
      <button type="submit" class="btn primary" id="authSubmit">Se connecter</button>
      <button type="button" class="linkbtn" id="forgot">Mot de passe oublié ?</button>
    </form>
  </div>

  <form id="resetForm" class="authform" hidden novalidate>
    <label>E-mail du compte <input type="email" name="email" autocomplete="email" required></label>
    <button type="submit" class="btn primary">Recevoir un lien de réinitialisation</button>
    <button type="button" class="linkbtn" id="backToLogin">Retour à la connexion</button>
  </form>

  <form id="profileForm" class="authform" hidden novalidate>
    <p class="hint">Bienvenue ! Il ne manque que quelques informations.</p>
    <label id="pfUsername">Pseudo <input type="text" name="username" maxlength="20" autocomplete="username" spellcheck="false" placeholder="ex. Frieren_fan">
      <small class="ustate" data-for="profileForm">${USERNAME_HELP}</small></label>
    <label id="pfBirth">Année de naissance <input type="number" name="birth" inputmode="numeric" min="1900" placeholder="ex. 1998" autocomplete="bday-year">
      <small>Sert uniquement à réserver le contenu adulte (18+) aux majeurs. Elle ne pourra plus être modifiée.</small></label>
    <button type="submit" class="btn primary">Enregistrer</button>
    <button type="button" class="linkbtn" id="profileLater">Plus tard</button>
  </form>

  <form id="newPwdForm" class="authform" hidden novalidate>
    <label>Nouveau mot de passe <input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
    <button type="submit" class="btn primary">Enregistrer le mot de passe</button>
  </form>

  <p class="authmsg" id="authMsg" role="alert" hidden></p>
  <p class="legalline">En continuant, tu acceptes les <a href="/conditions.html" target="_blank">conditions d'utilisation</a> et la <a href="/confidentialite.html" target="_blank">politique de confidentialité</a>.</p>
</dialog>`;

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
export const frError = err => {
  const p = profileErrorMessage(err);
  if (p) return p;
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
  $("profileForm").hidden = view !== "profile";
  $("authTitle").textContent = { main: mode === "signup" ? "Créer un compte" : "Connexion", reset: "Mot de passe oublié", newpwd: "Nouveau mot de passe", profile: "Complète ton profil" }[view];
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
  $("usernameField").hidden = m !== "signup";
  show("main");
}
async function busy(form, fn) {
  const btns = form.querySelectorAll("button");
  btns.forEach(b => b.disabled = true);
  try { await fn(); } finally { btns.forEach(b => b.disabled = false); }
}

/** Vérification du pseudo pendant la saisie (format immédiat, disponibilité après une courte pause). */
function liveUsername(input) {
  const state = input.parentElement.querySelector(".ustate");
  let t, seq = 0;
  input.addEventListener("input", () => {
    clearTimeout(t);
    const v = input.value.trim(), my = ++seq;
    state.className = "ustate";
    if (!v) { state.textContent = USERNAME_HELP; return; }
    const local = usernameFormatError(v);
    if (local) { state.textContent = local; state.classList.add("bad"); return; }
    state.textContent = "Vérification…";
    t = setTimeout(async () => {
      try {
        const p = await usernameProblem(v);
        if (my !== seq) return;
        state.textContent = p || "Pseudo disponible ✓";
        state.classList.add(p ? "bad" : "good");
      } catch { if (my === seq) state.textContent = USERNAME_HELP; }
    }, 400);
  });
}

/**
 * Ouvre la fenêtre. view : "main" (connexion), "reset", "newpwd" ou "profile".
 * Pour "profile", opts = { needUsername, needBirth } indique les champs à demander.
 */
export function openAuth(view = "main", opts = {}) {
  if (!supabase || !dlg) return;
  if (view === "profile") {
    $("pfUsername").hidden = !opts.needUsername;
    $("pfBirth").hidden = !opts.needBirth;
  }
  if (view === "main") setMode(mode); else show(view);
  if (!dlg.open) dlg.showModal();
}
export const isAuthOpen = () => !!(dlg && dlg.open);

export function initAuth(h = {}) {
  if (!supabase) return;
  hooks = h;
  document.body.insertAdjacentHTML("beforeend", DIALOG_HTML);
  dlg = $("auth");
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); }); // clic sur le fond
  document.querySelectorAll("#auth .tabs button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("forgot").addEventListener("click", () => {
    show("reset");
    $("resetForm").elements.email.value = $("authForm").elements.email.value;
  });
  $("backToLogin").addEventListener("click", () => show("main"));
  liveUsername($("authForm").elements.username);
  liveUsername($("profileForm").elements.username);

  $("google").addEventListener("click", async () => {
    msg("");
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) msg(frError(error));
  });

  $("authForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target, email = f.elements.email.value.trim(), password = f.elements.password.value;
    const username = f.elements.username.value.trim();
    if (mode === "signup") { const u = usernameFormatError(username); if (u) return msg(u); }
    if (!email || !f.elements.email.checkValidity()) return msg("Saisis une adresse e-mail valide.");
    if (password.length < 8) return msg("Le mot de passe doit contenir au moins 8 caractères.");
    const birth = mode === "signup" ? parseBirthYear(f.elements.birth.value) : null;
    if (mode === "signup" && !birth) return msg("Indique ton année de naissance (4 chiffres, ex. 1998).");
    busy(f, async () => {
      if (mode === "signup") {
        try { const p = await usernameProblem(username); if (p) return msg(p); }
        catch (err) { return msg(frError(err)); }
        const { data, error } = await supabase.auth.signUp({ email, password,
          options: { emailRedirectTo: location.origin + location.pathname, data: { birth_year: birth, username } } });
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

  $("profileLater").addEventListener("click", () => dlg.close());
  $("profileForm").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target, patch = {};
    if (!$("pfUsername").hidden) {
      const u = f.elements.username.value.trim(), err = usernameFormatError(u);
      if (err) return msg(err);
      patch.username = u;
    }
    if (!$("pfBirth").hidden) {
      const y = parseBirthYear(f.elements.birth.value);
      if (!y) return msg("Indique une année valide (4 chiffres, ex. 1998).");
      patch.birth_year = y;
    }
    busy(f, async () => {
      try {
        if (patch.username) { const p = await usernameProblem(patch.username); if (p) return msg(p); }
        await hooks.onCompleteProfile(patch);
        f.reset(); dlg.close();
      } catch (err) { console.error(err); msg(frError(err)); }
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
