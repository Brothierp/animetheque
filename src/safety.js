// Prévention (amitiés majeur / mineur) et partage d'images dans la messagerie : fiches d'animés, personnages,
// fan arts. Une image envoyée depuis l'appareil devient un fan art, vérifié par l'administrateur avant d'être visible.
import { A, byId, norm, titleOf, hdUrl, loadCatalogue } from "./data.js";
import { ME, adultAllowed } from "./state.js";
import { esc } from "./ui.js";
import { charById, CH, loadCharacters, imgUrl, mainAnime } from "./chars.js";

export const isAdultMe = () => { const y = ME.profile && ME.profile.birth_year; return !!y && new Date().getFullYear() - y > 18; };

function dialog(html) {
  const d = document.createElement("dialog"); d.className = "fb-dlg"; d.innerHTML = html;
  document.body.appendChild(d); d.addEventListener("close", () => setTimeout(() => d.remove(), 0));
  d.showModal(); return d;
}

/** Message de prévention avant de devenir ami avec un majeur (pour un mineur) ou un mineur (pour un majeur). */
export function preventionDialog(name) {
  const adult = isAdultMe();
  const body = adult
    ? `<p><b>${esc(name)}</b> est mineur·e. Les échanges entre majeurs et mineurs sont autorisés pour parler d'animés, avec des règles strictes :</p>
       <ul class="prev-l"><li>pas de numéro, d'e-mail, de réseau social ni de lien : ces messages sont <b>bloqués automatiquement</b> ;</li>
       <li>pas de demande de photo, de rendez-vous, de secret ni de question intime ;</li>
       <li>vos conversations sont <b>analysées automatiquement</b> et tout message suspect est transmis à l'administrateur.</li></ul>
       <p class="hint">Tout comportement inapproprié entraîne la suppression du compte et peut être signalé aux autorités.</p>`
    : `<p><b>${esc(name)}</b> est majeur·e. Tu peux parler d'animés avec lui ou elle, mais garde ces réflexes :</p>
       <ul class="prev-l"><li>ne donne jamais ton numéro, ton adresse, ton école, ni tes réseaux sociaux ;</li>
       <li>n'envoie pas de photo de toi et n'accepte jamais de rendez-vous ;</li>
       <li>si quelqu'un te demande de garder un secret, te met mal à l'aise ou te fait des compliments bizarres : <b>parles-en à un adulte de confiance</b>, bloque et signale-le ;</li>
       <li>pour te protéger, les conversations entre majeurs et mineurs sont <b>analysées automatiquement</b> par l'Animéthèque.</li></ul>
       <p class="hint">Besoin d'aide ou d'en parler ? Appelle le <b>3018</b> (gratuit, anonyme, 7j/7) ou va sur <a href="https://e-enfance.org/numero-3018/" target="_blank" rel="noopener">3018.fr</a>.</p>`;
  return new Promise(res => {
    const d = dialog(`<h2>⚠️ Avant de continuer</h2>${body}
      <div class="fb-act"><button type="button" class="btn" data-x="0">Annuler</button><button type="button" class="btn primary" data-x="1">J'ai compris, continuer</button></div>`);
    let ok = false;
    d.addEventListener("click", e => { const b = e.target.closest("[data-x]"); if (b) { ok = b.dataset.x === "1"; d.close(); } });
    d.addEventListener("close", () => res(ok));
  });
}

/** Bandeau affiché dans une conversation majeur / mineur. */
export const mixedBanner = () => `<div class="safe-ban" role="note">🛡️ <span>${isAdultMe()
  ? "Conversation avec un·e mineur·e : coordonnées et liens bloqués, messages analysés automatiquement."
  : "Conversation avec un·e majeur·e : ne donne jamais tes coordonnées. Messages analysés automatiquement. Un souci ? Signale-le ou appelle le 3018."}</span></div>`;

// ---------- Partage d'images du site ----------
// Un message peut contenir [[anime:123]], [[perso:456]] ou [[fanart:<uuid>]] : affichés comme des cartes.
const TOKEN = /\[\[(anime|perso|fanart):([0-9a-f-]{1,36})\]\]/g;
export const hasTokens = s => /\[\[(anime|perso|fanart):/.test(s || "");
export const tokenPreview = s => (s || "").replace(TOKEN, (_, k) => ({ anime: "🎬 Animé partagé", perso: "🧑 Personnage partagé", fanart: "🎨 Fan art partagé" })[k]);

let fanartResolver = () => null;
export const setFanartResolver = fn => { fanartResolver = fn; };
let extraPrep = async () => {};
export const setTokenPreparer = fn => { extraPrep = fn; };

function shareCard(kind, id) {
  if (kind === "anime") {
    const a = byId.get(+id); if (!a || (a.adult && !adultAllowed())) return `<span class="sh-card none">Animé indisponible</span>`;
    const src = hdUrl(a, "medium");
    return `<a class="sh-card" href="#/anime/${a.id}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<span><small>Animé</small><b>${esc(titleOf(a))}</b></span></a>`;
  }
  if (kind === "perso") {
    const c = charById.get(+id); if (!c) return `<a class="sh-card" href="#/personnage/${+id}"><span><small>Personnage</small><b>Voir la fiche</b></span></a>`;
    const a = mainAnime(c, adultAllowed());
    return `<a class="sh-card" href="#/personnage/${c.id}">${imgUrl(c) ? `<img src="${esc(imgUrl(c))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<span><small>Personnage</small><b>${esc(c.name || c.native)}</b>${a ? `<em>${esc(titleOf(a))}</em>` : ""}</span></a>`;
  }
  const f = fanartResolver(id);
  return f ? `<a class="sh-card fan" href="#/fanarts/${esc(id)}">${f.url ? `<img src="${esc(f.url)}" alt="" loading="lazy">` : ""}<span><small>${f.pending ? "Image · en vérification ⏳" : "Fan art"}</small><b>${esc(f.title)}</b>${f.pending ? `<em>visible par ton ami après validation</em>` : f.by ? `<em>par ${esc(f.by)}</em>` : ""}</span></a>`
    : `<a class="sh-card" href="#/fanarts/${esc(id)}"><span><small>Image</small><b>En cours de vérification</b><em>bientôt visible</em></span></a>`;
}
/** Texte d'un message → HTML (échappé, retours à la ligne, cartes partagées). */
export function messageHTML(body) {
  return esc(body).replace(/\n/g, "<br>").replace(TOKEN, (_, k, id) => shareCard(k, id));
}
/** Les personnages partagés doivent être chargés pour afficher leur carte. */
export async function prepareTokens(bodies) {
  const need = bodies.some(b => /\[\[perso:/.test(b || ""));
  await Promise.all([need ? loadCharacters().catch(() => {}) : null, extraPrep(bodies).catch(() => {})]);
}

/** Fenêtre « Partager un animé ou un personnage » ; renvoie le jeton à envoyer, ou null. */
export const TAG_SUGGEST = ["fan art", "chibi", "croquis", "aquarelle", "digital", "pixel art", "paysage", "humour", "romance", "action", "crossover", "redraw", "oc"];
export const parseTags = s => [...new Set((s || "").split(/[,;\n]+/).map(t => t.trim().replace(/^#+/, "").toLowerCase().slice(0, 24)).filter(t => t.length >= 2 && !["18+", "+18", "nsfw", "18"].includes(t)))].slice(0, 8);

/** Formulaire d'envoi d'une image depuis l'appareil (galerie du téléphone, fichiers de l'ordinateur). */
export function uploadFormHTML(id) {
  return `<form class="up-form" id="${id}" novalidate>
    <label class="fa-drop up-drop"><input type="file" accept="image/*" hidden data-up="file">
      <span data-up="prev"><b>📁 Choisir une image</b><small>Galerie du téléphone ou fichier de l'ordinateur · tu peux aussi la coller (Ctrl+V) ou la glisser ici</small></span></label>
    <label>Titre <input type="text" data-up="title" maxlength="80" required placeholder="Ex. : Frieren sous les étoiles"></label>
    <label><span>Artiste <small class="hint">(si ce n'est pas ton dessin)</small></span><input type="text" data-up="credit" maxlength="80" placeholder="Pseudo de l'artiste (symboles acceptés)"></label>
    <label><span>Lien vers la source <small class="hint">(facultatif)</small></span><input type="url" data-up="source" maxlength="300" inputmode="url" placeholder="https://www.pinterest.fr/pin/…  ·  DeviantArt, ArtStation, Pixiv…"></label>
    <label><span>Étiquettes <small class="hint">(jusqu'à 8, séparées par des virgules)</small></span><input type="text" data-up="tags" maxlength="200" autocomplete="off" placeholder="ex. : one piece, chibi, aquarelle"></label>
    <div class="tag-sug" aria-label="Étiquettes suggérées">${TAG_SUGGEST.map(t => `<button type="button" class="tchip" data-addtag="${esc(t)}">+ ${esc(t)}</button>`).join("")}</div>
    ${isAdultMe() ? `<label class="chk adult-chk"><input type="checkbox" data-up="adult"><span>🔞 <b>Contenu 18+</b> (nudité, ecchi, violence…) : visible seulement par les membres majeurs connectés, jamais par les mineurs ni les visiteurs. Aucun personnage mineur ou d'apparence mineure.</span></label>` : ""}
    <label class="chk"><input type="checkbox" data-up="ok"><span>C'est un <b>dessin ou une illustration</b> (le mien, ou celui d'un artiste que je crédite), sans <b>vraie personne</b>${isAdultMe() ? " ; tout contenu adulte est marqué 18+" : " ni contenu adulte, violent ou choquant"}.</span></label>
    <p class="hint up-note">Chaque image est vérifiée par l'administrateur avant d'être visible (en général sous 48 h). Elle rejoint aussi la galerie Fan arts.</p>
  </form>`;
}
/** Branche le formulaire : glisser-déposer, coller, aperçu ; renvoie une fonction qui lit les champs. */
export function bindUploadForm(form, { onPick } = {}) {
  let file = null;
  const $u = k => form.querySelector(`[data-up=${k}]`);
  const pick = f => {
    if (!f || (f.type && !f.type.startsWith("image/"))) return;
    file = f; const u = URL.createObjectURL(f);
    $u("prev").innerHTML = `<img src="${u}" alt=""><small>${esc(f.name || "image collée")} · cliquer pour changer</small>`;
    if (!$u("title").value && f.name) $u("title").value = f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").slice(0, 80);
    if (onPick) onPick(f);
  };
  $u("file").addEventListener("change", e => pick(e.target.files[0]));
  form.querySelector(".tag-sug").addEventListener("click", e => {
    const b = e.target.closest("[data-addtag]"); if (!b) return;
    const L = parseTags($u("tags").value); if (!L.includes(b.dataset.addtag) && L.length < 8) L.push(b.dataset.addtag);
    $u("tags").value = L.join(", "); b.hidden = true;
  });
  const drop = form.querySelector(".fa-drop");
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); pick(e.dataTransfer.files[0]); });
  const paste = e => { const it = [...(e.clipboardData && e.clipboardData.items || [])].find(x => x.type.startsWith("image/")); if (it) { e.preventDefault(); pick(it.getAsFile()); } };
  (form.closest("dialog") || document).addEventListener("paste", paste);
  return () => ({ file, title: $u("title").value.trim(), credit: $u("credit").value.trim(), source_url: $u("source").value.trim(), tags: parseTags($u("tags").value), adult: !!($u("adult") && $u("adult").checked), ok: $u("ok").checked });
}
/** Vérifie les champs ; renvoie un message d'erreur ou null. */
export function checkUpload(v, sourceRe) {
  if (!v.file) return "Choisis une image 🙂";
  if (v.title.length < 2) return "Donne un titre à l'image";
  if (v.source_url && !sourceRe.test(v.source_url)) return "Lien de source non accepté : Pinterest, DeviantArt, ArtStation, Pixiv, X, Instagram, Tumblr, Bluesky, Reddit ou Behance (adresse en https://).";
  if (!v.ok) return "Coche la case de certification pour continuer";
  return null;
}
export const uploadError = err => {
  const m = (err && err.message) || "";
  return m === "format" ? "Ce fichier n'est pas une image lisible (essaie en JPEG ou PNG)." : m === "size" ? "Image trop lourde (25 Mo maximum)." : null;
};

export function sharePicker(extra, upload) {
  return new Promise(res => {
    const d = dialog(`<h2>🖼️ Partager une image</h2>
      <p class="hint">${upload ? "Envoie une image de ton téléphone ou de ton ordinateur (fan art, dessin…), ou partage une fiche du site." : `Partage la fiche d'un animé, d'un personnage${extra ? " ou un fan art validé" : ""}.`} Pas de photos personnelles : on partage des dessins et des illustrations.</p>
      <div class="sp-tabs" role="tablist">${[...(upload ? [["device", "📁 Mon appareil"]] : []), ["anime", "Animé"], ["perso", "Personnage"], ...(extra ? [["fanart", "Fan art"]] : [])].map(([k, v], i) => `<button type="button" data-k="${k}" class="${i ? "" : "on"}">${v}</button>`).join("")}</div>
      <div class="sp-pick"><input type="search" class="sp-q" placeholder="Rechercher…" autocomplete="off" aria-label="Rechercher">
      <div class="sp-res"></div></div>
      ${upload ? `<div class="sp-up" hidden>${uploadFormHTML("spUp")}</div>` : ""}
      <p class="imp-err sp-err" hidden></p>
      <div class="fb-act"><button type="button" class="btn" data-x>Fermer</button>${upload ? `<button type="button" class="btn primary" data-send hidden>Envoyer l'image</button>` : ""}</div>`);
    let kind = upload ? "device" : "anime", out = null, t;
    const q = d.querySelector(".sp-q"), box = d.querySelector(".sp-res");
    const err = d.querySelector(".sp-err");
    const read = upload ? bindUploadForm(d.querySelector("#spUp")) : null;
    const mode = () => {
      const dev = kind === "device";
      d.querySelector(".sp-pick").hidden = dev;
      if (upload) { d.querySelector(".sp-up").hidden = !dev; d.querySelector("[data-send]").hidden = !dev; }
      err.hidden = true;
    };
    const draw = async () => {
      mode(); if (kind === "device") return;
      const s = norm(q.value), ok = adultAllowed();
      let items = [];
      if (kind === "anime") { await loadCatalogue(); items = A.filter(a => (!a.adult || ok) && (!s || a.hay.includes(s))).slice(0, 24).map(a => ({ tok: `[[anime:${a.id}]]`, img: hdUrl(a, "medium"), t: titleOf(a) })); }
      else if (kind === "perso") { box.innerHTML = `<p class="hint">Chargement…</p>`; await loadCharacters(); items = CH.filter(c => (!s || c.hay.includes(s)) && mainAnime(c, ok)).slice(0, 24).map(c => ({ tok: `[[perso:${c.id}]]`, img: imgUrl(c), t: c.name || c.native })); }
      else items = (await extra(s)).map(f => ({ tok: `[[fanart:${f.id}]]`, img: f.url, t: f.title }));
      box.innerHTML = items.length ? items.map(x => `<button type="button" class="sp-it" data-tok="${esc(x.tok)}">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "<i></i>"}<span>${esc(x.t)}</span></button>`).join("") : `<p class="hint">Aucun résultat.</p>`;
    };
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(draw, 150); });
    d.addEventListener("click", e => {
      const k = e.target.closest("[data-k]"); if (k) { kind = k.dataset.k; d.querySelectorAll("[data-k]").forEach(b => b.classList.toggle("on", b === k)); draw(); return; }
      const it = e.target.closest("[data-tok]"); if (it) { out = it.dataset.tok; d.close(); return; }
      if (e.target.closest("[data-x]")) d.close();
      const send = e.target.closest("[data-send]");
      if (send && read) {
        const v = read(), bad = checkUpload(v, upload.sourceRe);
        if (bad) { err.textContent = bad; err.hidden = false; return; }
        send.disabled = true; send.textContent = "Envoi…"; err.hidden = true;
        upload.send(v).then(tok => { out = tok; d.close(); })
          .catch(x => { err.textContent = uploadError(x) || upload.error(x); err.hidden = false; send.disabled = false; send.textContent = "Envoyer l'image"; });
      }
    });
    d.addEventListener("close", () => res(out));
    draw(); if (kind !== "device") q.focus();
  });
}
