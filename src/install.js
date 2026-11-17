// « Installer l'appli » : l'Animéthèque s'ajoute à l'écran d'accueil du téléphone (ou au bureau de l'ordinateur)
// et s'ouvre comme une application. Proposé discrètement à partir de la 3ᵉ visite ; refusable.
const KEY = "animetheque:install";
let deferred = null;

const store = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
export const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
export const canInstall = () => !isInstalled() && (!!deferred || isIOS());

/** Ouvre la fenêtre d'installation du navigateur (Android, ordinateur) ou explique la marche à suivre (iPhone). */
export async function install() {
  if (deferred) {
    deferred.prompt();
    const r = await deferred.userChoice.catch(() => null);
    deferred = null; hideBar();
    if (r && r.outcome === "accepted") save({ ...store(), done: true });
    return;
  }
  if (isIOS()) {
    const d = document.createElement("dialog"); d.className = "fb-dlg";
    d.innerHTML = `<h2>📲 Installer sur iPhone</h2>
      <ol class="prev-l"><li>Touche le bouton <b>Partager</b> <span aria-hidden="true">⬆️</span> en bas de Safari ;</li>
      <li>choisis <b>« Sur l'écran d'accueil »</b> ;</li><li>touche <b>Ajouter</b>.</li></ol>
      <p class="hint">L'Animéthèque s'ouvrira alors comme une application, en plein écran.</p>
      <div class="fb-act"><button type="button" class="btn primary" data-x>J'ai compris</button></div>`;
    document.body.appendChild(d); d.showModal();
    d.addEventListener("click", e => { if (e.target.closest("[data-x]") || e.target === d) d.close(); });
    d.addEventListener("close", () => d.remove());
  }
}
function hideBar() { const b = document.getElementById("installBar"); if (b) b.remove(); }
function showBar() {
  if (document.getElementById("installBar") || !canInstall()) return;
  const b = document.createElement("div"); b.id = "installBar"; b.className = "install-bar"; b.setAttribute("role", "region"); b.setAttribute("aria-label", "Installer l'application");
  b.innerHTML = `<span>📲 <b>Installe l'Animéthèque</b> sur ton écran d'accueil : elle s'ouvre comme une appli, en un geste.</span>
    <button type="button" class="btn sm primary" data-i="go">Installer</button><button type="button" class="x" data-i="no" aria-label="Plus tard">×</button>`;
  document.body.appendChild(b);
  b.addEventListener("click", e => {
    const k = e.target.closest("[data-i]"); if (!k) return;
    if (k.dataset.i === "go") install(); else { save({ ...store(), snooze: Date.now() }); hideBar(); }
  });
}

export function initInstall() {
  const s = store(); s.visits = (s.visits || 0) + 1; save(s);
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; maybe(); });
  addEventListener("appinstalled", () => { save({ ...store(), done: true }); hideBar(); });
  const maybe = () => {
    const st = store();
    if (st.done || isInstalled() || st.visits < 3) return;
    if (st.snooze && Date.now() - st.snooze < 14 * 86400000) return;      // refusé : on redemande dans 2 semaines
    setTimeout(showBar, 4000);
  };
  if (isIOS()) maybe();
}
