// Traduction anglais → français à la demande, sans clé :
//  1. traducteur intégré au navigateur (Chrome récent : sur l'appareil, gratuit, privé) ;
//  2. sinon MyMemory (service gratuit, ~5 000 caractères par jour et par personne) ;
//  3. sinon lien vers Google Traduction.
// Les traductions sont gardées sur l'appareil (localStorage) pour ne pas être redemandées.

const PREF = "animetheque:auto-translate";
const CACHE = "animetheque:tr:";
export const autoTranslate = () => { try { return localStorage.getItem(PREF) === "1"; } catch { return false; } };
export const setAutoTranslate = on => { try { on ? localStorage.setItem(PREF, "1") : localStorage.removeItem(PREF); } catch {} };

const getCached = k => { try { return localStorage.getItem(CACHE + k); } catch { return null; } };
const setCached = (k, v) => { try { localStorage.setItem(CACHE + k, v); } catch { /* stockage plein : tant pis */ } };

// ---------- 1. Traducteur du navigateur ----------
let local = null, preparing = null;
const withTimeout = (pr, ms) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error("délai")), ms))]);
async function localTranslator() {
  if (local) return local;
  if (!("Translator" in self)) return null;
  try {
    const av = await withTimeout(self.Translator.availability({ sourceLanguage: "en", targetLanguage: "fr" }), 2000);
    if (av === "available") { local = await withTimeout(self.Translator.create({ sourceLanguage: "en", targetLanguage: "fr" }), 5000); return local; }
    // à télécharger : on lance la préparation pour les prochaines fois, sans faire attendre maintenant
    if ((av === "downloadable" || av === "downloading") && !preparing)
      preparing = self.Translator.create({ sourceLanguage: "en", targetLanguage: "fr" }).then(t => (local = t)).catch(() => {});
  } catch { /* indisponible ou trop lent */ }
  return null;
}

// ---------- 2. MyMemory (morceaux de 450 caractères au plus, découpés aux fins de phrase) ----------
function chunks(text, max = 450) {
  const out = []; let cur = "";
  for (const s of text.match(/[^.!?\n]+[.!?]*\s*|\n+/g) || [text]) {
    if ((cur + s).length > max && cur) { out.push(cur); cur = ""; }
    if (s.length > max) { for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max)); continue; }
    cur += s;
  }
  if (cur) out.push(cur);
  return out;
}
async function myMemory(text) {
  const parts = [];
  for (const c of chunks(text)) {
    if (!c.trim()) { parts.push(c); continue; }
    const r = await withTimeout(fetch("https://api.mymemory.translated.net/get?" + new URLSearchParams({ q: c, langpair: "en|fr" })), 15000);
    if (!r.ok) throw new Error("http " + r.status);
    const d = await r.json();
    const t = d && d.responseData && d.responseData.translatedText;
    if (!t || d.responseStatus === 429 || /MYMEMORY WARNING|QUOTA/i.test(t)) throw new Error("quota");
    parts.push(t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&") + (/\s$/.test(c) ? " " : ""));
  }
  return parts.join("").trim();
}

/** Lien de secours : le texte s'ouvre dans Google Traduction. */
export const googleLink = text => "https://translate.google.com/?" + new URLSearchParams({ sl: "en", tl: "fr", op: "translate", text: text.slice(0, 4500) });

/**
 * Traduit un texte. key : clé de cache (ex. « a16498 »). Renvoie { text, via } ou lève une erreur.
 * via : « navigateur », « MyMemory » ou « mémoire ».
 */
export async function translate(text, key, onStatus) {
  if (!text || !text.trim()) return { text: "", via: "" };
  const hit = key && getCached(key);
  if (hit) return { text: hit, via: "mémoire" };
  let out = null, via = "";
  const lt = await localTranslator();
  if (lt) { try { out = await withTimeout(lt.translate(text), 15000); via = "navigateur"; } catch { out = null; } }
  if (!out) { if (onStatus) onStatus("Traduction…"); out = await myMemory(text); via = "MyMemory"; }
  if (key && out) setCached(key, out);
  return { text: out, via };
}

/** Traduit les morceaux de texte d'un bloc HTML déjà affiché (liens et spoilers conservés). */
export async function translateElement(el, key, onStatus) {
  const nodes = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) { const n = walker.currentNode; if (n.nodeValue.trim().length > 1 && !n.parentElement.closest(".src")) nodes.push(n); }
  // un seul appel pour tout le bloc, séparateurs conservés
  const SEP = "\n¶\n", joined = nodes.map(n => n.nodeValue.replace(/\n/g, " ")).join(SEP);
  const r = await translate(joined, key, onStatus);
  const parts = r.text.split(/\s*¶\s*/);
  if (parts.length === nodes.length) nodes.forEach((n, i) => { const lead = n.nodeValue.match(/^\s*/)[0], tail = n.nodeValue.match(/\s*$/)[0]; n.nodeValue = lead + parts[i].trim() + tail; });
  else nodes.forEach((n, i) => { n.nodeValue = i === 0 ? r.text : ""; });   // séparateurs perdus : texte d'un bloc
  return r;
}

/**
 * Ajoute sous « el » une barre « Traduire en français » (+ « Toujours traduire »).
 * html : vrai si « el » contient du HTML à préserver (liens, spoilers), faux pour du texte simple.
 */
export function attachTranslate(el, key, html = false) {
  if (!el || el.dataset.tr) return;
  el.dataset.tr = "1";
  const original = html ? el.innerHTML : el.textContent;
  const bar = document.createElement("div"); bar.className = "tr-bar";
  el.after(bar);
  const idle = () => {
    bar.innerHTML = `<button type="button" class="btn sm" data-tr="go">🇫🇷 Traduire en français</button>
      <label class="tgl sm"><input type="checkbox" data-tr="auto"${autoTranslate() ? " checked" : ""}> Toujours traduire automatiquement</label>`;
  };
  const done = via => {
    bar.innerHTML = `<span class="hint">Traduction automatique${via === "navigateur" ? " (traducteur du navigateur)" : via === "MyMemory" ? " (MyMemory)" : ""}, elle peut contenir des erreurs.</span>
      <button type="button" class="linkbtn" data-tr="orig">Voir l'original en anglais</button>`;
  };
  const go = async () => {
    bar.innerHTML = `<span class="hint">Traduction…</span>`;
    try {
      let r;
      if (html) r = await translateElement(el, key, s => { bar.innerHTML = `<span class="hint">${s}</span>`; });
      else { r = await translate(original, key, s => { bar.innerHTML = `<span class="hint">${s}</span>`; }); el.textContent = r.text; }
      if (!el.isConnected) return;
      el.classList.add("translated"); done(r.via);
    } catch {
      if (html) el.innerHTML = original;
      bar.innerHTML = `<span class="hint">La traduction gratuite n'est pas disponible pour le moment (limite quotidienne atteinte ?).</span>
        <a class="linkbtn" href="${googleLink(html ? el.textContent : original)}" target="_blank" rel="noopener">Ouvrir dans Google Traduction ↗</a>`;
    }
  };
  bar.addEventListener("click", e => {
    const b = e.target.closest("[data-tr]"); if (!b) return;
    if (b.dataset.tr === "go") go();
    else if (b.dataset.tr === "orig") { if (html) el.innerHTML = original; else el.textContent = original; el.classList.remove("translated"); idle(); }
  });
  bar.addEventListener("change", e => { if (e.target.dataset.tr === "auto") { setAutoTranslate(e.target.checked); if (e.target.checked) go(); } });
  idle();
  if (autoTranslate()) go();
}
