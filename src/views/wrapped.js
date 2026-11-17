// « Wrapped » (#/wrapped, #/wrapped/2026) : ton année en animés, en cartes à faire défiler,
// et une image à partager (format story 1080 × 1920). Tout est calculé dans le navigateur, à partir de ta collection.
import { byId, T, tr, titleOf, hdUrl } from "../data.js";
import { ME, adultAllowed, onChange } from "../state.js";
import { $, esc, fmt } from "../ui.js";
import { charById, loadCharacters, imgUrl } from "../chars.js";
import { gate } from "./collection.js";
import { toast } from "../toast.js";

let root = null, slide = 0, S = null, curYear = null;
const isShown = () => !!(root && root.isConnected && root.dataset.view === "wrapped");
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// Profils d'après le genre préféré
const PROFILES = {
  Isekai: ["Voyageur·se entre les mondes", "Un camion, une lumière blanche… et te voilà dans un autre monde. Encore."],
  Action: ["Combattant·e infatigable", "Tu ne regardes pas des animés : tu t'entraînes."],
  Romance: ["Cœur d'artichaut", "Les déclarations sous les cerisiers n'ont plus de secrets pour toi."],
  Comedy: ["Roi ou reine du fou rire", "Ton année a été placée sous le signe de la bonne humeur."],
  Drama: ["Âme sensible", "Les mouchoirs n'étaient jamais loin."],
  Fantasy: ["Grand·e aventurier·ère", "Dragons, magie et royaumes lointains : ton terrain de jeu."],
  "Slice of Life": ["Amateur·rice de douceur", "Thé chaud, plaid et petites histoires du quotidien."],
  Mystery: ["Détective dans l'âme", "Tu avais deviné le coupable avant tout le monde, avoue."],
  Psychological: ["Esprit tortueux", "Les retournements de cerveau, c'est ton truc."],
  Sports: ["Esprit d'équipe", "Tu as vibré à chaque balle de match."],
  "Sci-Fi": ["Explorateur·rice du futur", "Robots, vaisseaux et paradoxes temporels."],
  Horror: ["Nerfs d'acier", "Même pas peur. Enfin presque."],
  Supernatural: ["Chasseur·se d'esprits", "Fantômes, démons et pouvoirs étranges ne t'impressionnent plus."],
  Mecha: ["Pilote d'élite", "Ton cœur bat au rythme des réacteurs."],
  Music: ["Mélomane", "Ton année avait une bande-son."],
};

export function computeYear(year) {
  const adultOk = adultAllowed();
  const inYear = t => t && new Date(t).getFullYear() === year;
  const rows = [...ME.entries.entries()].map(([id, e]) => [byId.get(id), e]).filter(([a, e]) => a && (!a.adult || adultOk) && inYear(e.t) && (e.s || e.f || e.r || e.p));
  const done = rows.filter(([, e]) => e.s === "watched"), watching = rows.filter(([, e]) => e.s === "watching");
  let eps = 0, mins = 0;
  for (const [a, e] of rows) { const n = e.s === "watched" ? Math.max(e.p || 0, a.eps || 0) : e.p || 0; eps += n; mins += n * (a.dur || 24); }
  const gw = new Map(), sw = new Map(), month = new Array(12).fill(0);
  for (const [a, e] of rows) {
    const w = (e.s === "watched" ? 2 : e.s === "watching" ? 1 : 0) + (e.f ? 2 : 0) + (e.r >= 4 ? 1 : 0);
    if (w) { for (const g of a.genres) gw.set(g, (gw.get(g) || 0) + w); for (const s of a.studios) sw.set(s, (sw.get(s) || 0) + w); }
    month[new Date(e.t).getMonth()]++;
  }
  const top = (m, n) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(x => x[0]);
  const genres = top(gw, 3).map(g => T.genres[g]);
  const best = [...rows].filter(([, e]) => e.r).sort((x, y) => y[1].r - x[1].r || (y[0].score || 0) - (x[0].score || 0)).slice(0, 5).map(([a, e]) => ({ a, r: e.r }));
  const favs = rows.filter(([, e]) => e.f).map(([a]) => a);
  const favChar = [...ME.favChars.entries()].filter(([, t]) => inYear(t)).sort((x, y) => y[1] - x[1]).map(([id]) => id);
  const rated = rows.filter(([, e]) => e.r);
  const avg = rated.length ? rated.reduce((s, [, e]) => s + e.r, 0) / rated.length : 0;
  const peak = month.indexOf(Math.max(...month));
  const hidden = done.map(([a]) => a).filter(a => a.rank > 3000).sort((x, y) => y.rank - x.rank)[0] || null;   // pépite peu connue
  const prof = PROFILES[genres[0]] || ["Curieux·se de tout", "Tu as goûté à tous les genres, sans jamais te lasser."];
  return { year, rows, done: done.map(([a]) => a), watching: watching.map(([a]) => a), eps, hours: Math.round(mins / 60), genres,
    studio: top(sw, 1).map(s => T.studios[s])[0], best, favs, favChar, avg, peak: Math.max(...month) ? peak : -1, hidden, profile: prof };
}

const cv = (a, cls = "") => { const u = hdUrl(a, "large") || hdUrl(a, "medium"); return u ? `<img class="${cls}" src="${esc(u)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ""; };

function slides(s) {
  const L = [];
  L.push(`<div class="wr-s wr-intro"><small>Animéthèque</small><h2>Ton année ${s.year}<br>en animés</h2><p>${esc(ME.profile && ME.profile.username || "")}, prêt·e à revoir ton année ?</p></div>`);
  L.push(`<div class="wr-s"><small>Cette année, tu as passé</small><h2 class="wr-big">${fmt(s.hours)} h</h2><p>devant <b>${fmt(s.eps)}</b> épisodes. ${s.hours >= 24 ? `Soit <b>${fmt(Math.round(s.hours / 24))} jour${s.hours >= 48 ? "s" : ""}</b> entier${s.hours >= 48 ? "s" : ""}, sans dormir.` : "Un bon début !"}</p></div>`);
  L.push(`<div class="wr-s"><small>Séries terminées</small><h2 class="wr-big">${s.done.length}</h2><div class="wr-covers">${s.done.slice(0, 6).map(a => cv(a)).join("")}</div>${s.watching.length ? `<p>Et <b>${s.watching.length}</b> encore en cours.</p>` : ""}</div>`);
  if (s.genres.length) L.push(`<div class="wr-s"><small>Ton genre préféré</small><h2>${esc(tr("genres", s.genres[0]))}</h2>${s.genres.length > 1 ? `<p>Suivi de ${s.genres.slice(1).map(g => `<b>${esc(tr("genres", g))}</b>`).join(" et ")}.</p>` : ""}${s.studio ? `<p class="wr-sub">Studio que tu as le plus regardé : <b>${esc(s.studio)}</b></p>` : ""}</div>`);
  if (s.best.length) L.push(`<div class="wr-s"><small>Ton coup de cœur de l'année</small>${cv(s.best[0].a, "wr-hero")}<h2>${esc(titleOf(s.best[0].a))}</h2><p>${"★".repeat(s.best[0].r)}${s.avg ? ` · ta note moyenne : <b>${s.avg.toFixed(1).replace(".", ",")} ★</b>` : ""}</p></div>`);
  if (s.favChar.length) { const c = charById.get(s.favChar[0]); if (c) L.push(`<div class="wr-s"><small>Ton personnage de l'année</small>${imgUrl(c) ? `<img class="wr-hero wr-char" src="${esc(imgUrl(c))}" alt="" referrerpolicy="no-referrer">` : ""}<h2>${esc(c.name)}</h2>${s.favChar.length > 1 ? `<p>Parmi <b>${s.favChar.length}</b> personnages ajoutés en favoris.</p>` : ""}</div>`); }
  if (s.hidden) L.push(`<div class="wr-s"><small>Ta pépite cachée</small>${cv(s.hidden, "wr-hero")}<h2>${esc(titleOf(s.hidden))}</h2><p>Peu de gens l'ont vue. Toi, si. 👀</p></div>`);
  if (s.peak >= 0) L.push(`<div class="wr-s"><small>Ton mois le plus animé</small><h2>${MONTHS[s.peak]}</h2><p>C'est là que ta collection a le plus bougé.</p></div>`);
  L.push(`<div class="wr-s wr-end"><small>Ton profil ${s.year}</small><h2>${esc(s.profile[0])}</h2><p>${esc(s.profile[1])}</p>
    <button type="button" class="btn primary" data-wr="share">📤 Partager mon année</button><button type="button" class="btn" data-wr="again">Revoir</button></div>`);
  return L;
}

function paint() {
  const L = slides(S); slide = Math.max(0, Math.min(slide, L.length - 1));
  $("wrStage").innerHTML = L[slide];
  $("wrDots").innerHTML = L.map((_, i) => `<i class="${i === slide ? "on" : i < slide ? "done" : ""}"></i>`).join("");
  $("wrStage").className = "wr-stage g" + (slide % 5);
}

export function render(el, sub) {
  root = el;
  const year = +sub || new Date().getFullYear(); curYear = year;
  if (!ME.user) { el.innerHTML = gate(`Ton année ${year} en animés`, "Connecte-toi pour découvrir ton année : heures passées devant les animés, genres préférés, coup de cœur, personnage de l'année… et une image à partager."); return; }
  if (!ME.ready) { el.innerHTML = `<div class="page"><p class="loading">Chargement de ta collection…</p></div>`; return; }
  S = computeYear(year); slide = 0;
  if (S.rows.length < 3) {
    el.innerHTML = `<div class="page"><div class="empty"><p>Pas encore assez de titres dans ta collection en ${year} pour faire ton bilan.</p><p class="hint">Ajoute ce que tu as regardé cette année (statut « Vu », notes, coups de cœur), ou importe ta liste MyAnimeList / AniList depuis Mon compte.</p><a class="btn primary" href="#/catalogue">Parcourir le catalogue</a></div></div>`;
    return;
  }
  el.innerHTML = `<div class="wr"><div class="wr-dots" id="wrDots"></div><div class="wr-stage" id="wrStage"></div>
    <button type="button" class="wr-nav prev" data-wr="prev" aria-label="Précédent">‹</button><button type="button" class="wr-nav next" data-wr="next" aria-label="Suivant">›</button>
    <a class="wr-close x" href="#/collection" aria-label="Fermer">×</a></div>`;
  if (S.favChar.length) loadCharacters().then(() => isShown() && paint()).catch(() => {});
  paint();
  const wr = el.querySelector(".wr");
  wr.addEventListener("click", e => {
    const b = e.target.closest("[data-wr]");
    if (b) {
      const k = b.dataset.wr;
      if (k === "share") return shareImage();
      if (k === "again") { slide = 0; return paint(); }
      slide += k === "prev" ? -1 : 1; return paint();
    }
    if (e.target.closest("a, button")) return;
    slide += e.clientX < innerWidth / 3 ? -1 : 1; paint();     // toucher à gauche : retour, ailleurs : suivant
  });
  let x0 = null;
  wr.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
  wr.addEventListener("touchend", e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) { slide += dx < 0 ? 1 : -1; paint(); } x0 = null; });
}
addEventListener("keydown", e => { if (!isShown() || !S) return; if (e.key === "ArrowRight") { slide++; paint(); } if (e.key === "ArrowLeft") { slide--; paint(); } });

// ---------- Image à partager (1080 × 1920) ----------
const loadImg = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.crossOrigin = "anonymous"; i.referrerPolicy = "no-referrer"; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
async function shareImage() {
  const s = S, W = 1080, H = 1920, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, "#2c1b5e"); grad.addColorStop(.55, "#130f1f"); grad.addColorStop(1, "#5a2a1e");
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const font = (w, px) => `${w} ${px}px "Zen Kaku Gothic New", "Segoe UI", sans-serif`;
  g.textAlign = "center"; g.fillStyle = "#f2b84b"; g.font = font(700, 40); g.fillText("ANIMÉTHÈQUE", W / 2, 120);
  g.fillStyle = "#ece7f8"; g.font = font(900, 92); g.fillText(`Mon année ${s.year}`, W / 2, 240);
  // affiches des séries terminées (si le CDN l'autorise)
  const imgs = (await Promise.all(s.done.concat(s.best.map(b => b.a)).filter((a, i, L) => L.indexOf(a) === i).slice(0, 4).map(a => loadImg(hdUrl(a, "medium"))))).filter(Boolean);
  const cw = 220, ch = 312, gap = 24, x0 = (W - (imgs.length * cw + (imgs.length - 1) * gap)) / 2;
  imgs.forEach((im, i) => { g.save(); g.beginPath(); (g.roundRect ? g.roundRect.bind(g) : (x, y, w, h) => g.rect(x, y, w, h))(x0 + i * (cw + gap), 310, cw, ch, 22); g.clip(); g.drawImage(im, x0 + i * (cw + gap), 310, cw, ch); g.restore(); });
  let y = imgs.length ? 790 : 400;
  const stat = (big, label) => { g.fillStyle = "#ece7f8"; g.font = font(900, 120); g.fillText(big, W / 2, y); g.fillStyle = "#a39bbd"; g.font = font(500, 40); g.fillText(label, W / 2, y + 58); y += 220; };
  stat(`${fmt(s.hours)} h`, `devant ${fmt(s.eps)} épisodes`);
  stat(String(s.done.length), `série${s.done.length > 1 ? "s" : ""} terminée${s.done.length > 1 ? "s" : ""}`);
  if (s.genres[0]) stat(tr("genres", s.genres[0]), "genre préféré");
  if (s.best[0]) { g.fillStyle = "#a39bbd"; g.font = font(500, 40); g.fillText("Coup de cœur", W / 2, y); g.fillStyle = "#f2b84b"; g.font = font(900, 58); g.fillText(titleOf(s.best[0].a).slice(0, 30), W / 2, y + 70); y += 170; }
  g.fillStyle = "#9b7bff"; g.font = font(900, 60); g.fillText(s.profile[0], W / 2, Math.min(y + 40, H - 200));
  g.fillStyle = "#a39bbd"; g.font = font(500, 36); g.fillText("animetheque.vercel.app", W / 2, H - 90);
  let blob;
  try { blob = await new Promise(r => c.toBlob(r, "image/png")); } catch { blob = null; }
  if (!blob) return toast("L'image n'a pas pu être créée sur cet appareil.");
  const file = new File([blob], `animetheque-${s.year}.png`, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `Mon année ${s.year} en animés`, text: `Mon année ${s.year} en animés sur l'Animéthèque 🎌` }); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  toast("Image téléchargée : partage-la où tu veux 📤");
}
// la session et la collection arrivent après l'ouverture directe du lien : on redessine
onChange(what => { if (isShown() && (what === "session" || what === "collection") && !(S && S.year === curYear && root.querySelector(".wr"))) render(root, curYear); });
