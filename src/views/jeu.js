// Vue « Jeu » : #/jeu (niveau, objectif de l'année, badges) et #/jeu/defi (quiz de la semaine + classement).
// Le quiz est le même pour tout le monde pendant une semaine (tirage déterminé par la semaine), un seul essai classé.
import { supabase } from "../supabase.js";
import { A, T, UP, byId, titleOf, hdUrl, franchiseKey, loadChars, norm } from "../data.js";
import { ME, onChange, requireUser } from "../state.js";
import { $, esc, fmt } from "../ui.js";
import { toast } from "../toast.js";
import { achievements, collectionStats, xpOf, levelOf, badges, goal, setGoal, weekKey, myQuiz, XP_RULES } from "../game.js";

let root = null, sub = "";
const isShown = () => !!(root && root.isConnected && root.dataset.view === "jeu");
const tabs = cur => `<nav class="tabs2" aria-label="Jeu"><a href="#/jeu" class="${cur === "" ? "on" : ""}">🏅 Ma progression</a><a href="#/jeu/defi" class="${cur === "defi" ? "on" : ""}">🎯 Défi de la semaine</a></nav>`;
const dur = ms => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`; };

export function render(el, s) {
  root = el; sub = s === "defi" ? "defi" : "";
  if (quiz && quiz.timer) clearInterval(quiz.timer);
  quiz = null;
  if (!ME.user) {
    el.innerHTML = `<div class="page"><h1>Jeu</h1>${tabs(sub)}<div class="empty"><p>Connecte-toi pour gagner des niveaux, débloquer des badges et participer au défi de la semaine.</p><button type="button" class="btn primary" id="jeuLogin">Se connecter</button></div></div>`;
    $("jeuLogin").onclick = () => requireUser();
    return;
  }
  return sub === "defi" ? renderQuiz(el) : renderProgress(el);
}
onChange(what => { if (isShown() && (what === "session" || (what === "collection" && !sub))) render(root, sub); });

// ---------------------------------------------------------------------------
// Progression : niveau, objectif annuel, badges
// ---------------------------------------------------------------------------
async function renderProgress(el) {
  el.innerHTML = `<div class="page jeu"><h1>Jeu</h1>${tabs("")}<p class="loading">Chargement…</p></div>`;
  const year = new Date().getFullYear();
  const [ach, target, q] = await Promise.all([achievements(true), goal(year, true), myQuiz()]);
  if (!isShown() || sub) return;
  const s = collectionStats(year);
  ach.goalDone = target > 0 && s.yearDone >= target;
  const L = levelOf(xpOf(s, ach)), B = badges(s, ach), got = B.filter(b => b.done).length;
  const pct = target ? Math.min(100, Math.round(s.yearDone / target * 100)) : 0;
  el.innerHTML = `<div class="page jeu"><h1>Jeu</h1>${tabs("")}
    <section class="lv-card">
      <div class="lv-n"><small>Niveau</small><b>${L.level}</b></div>
      <div class="lv-t"><h2>${esc(L.title)}</h2><p class="hint">${fmt(L.xp)} XP · encore <b>${fmt(L.next - L.xp)} XP</b> pour le niveau ${L.level + 1}</p>
        <span class="lv-bar"><i style="width:${L.pct}%"></i></span></div>
      <details class="lv-how"><summary>Comment gagner de l'XP ?</summary><ul>${XP_RULES.map(([t, n]) => `<li><span>${esc(t)}</span><b>+${n} XP</b></li>`).join("")}</ul></details>
    </section>
    <div class="jeu-2">
      <section class="card2 goal-card"><h2>🏁 Objectif ${year}</h2>
        ${target ? `<div class="goal-big"><b>${s.yearDone}</b><span>/ ${target} animés terminés</span></div>
          <span class="lv-bar goal-bar"><i style="width:${pct}%"></i></span>
          <p class="hint">${s.yearDone >= target ? "🎉 Objectif atteint ! Tu peux le relever si tu veux aller plus loin." : `Encore <b>${target - s.yearDone}</b> pour l'atteindre${(() => { const left = Math.max(1, Math.ceil((new Date(year, 11, 31) - new Date()) / 604800000)); return ` : environ ${Math.ceil((target - s.yearDone) / left)} par semaine.`; })()}`}</p>
          <button type="button" class="linkbtn" data-goal="edit">Modifier l'objectif</button>`
        : `<p>Combien d'animés veux-tu terminer en ${year} ? Ta progression avancera à chaque titre marqué « Regardé ».</p>`}
        <form class="goal-f" id="goalForm"${target ? " hidden" : ""}><label class="sr" for="goalN">Nombre d'animés</label>
          <input id="goalN" type="number" inputmode="numeric" min="1" max="1000" value="${target || 24}" required><span>animés en ${year}</span>
          <button type="submit" class="btn sm primary">Enregistrer</button>${target ? `<button type="button" class="linkbtn danger" data-goal="del">Retirer</button>` : ""}</form>
        <p class="hint">Déjà terminés cette année : ${s.yearDone}. Il est compté dans ton bilan de fin d'année.</p></section>
      <section class="card2 quiz-card"><h2>🎯 Défi de la semaine</h2>
        ${q === undefined ? `<p class="hint">Bientôt disponible.</p>` : q ? `<p>Tu as fait <b>${q.score}/${q.total}</b> cette semaine, en ${dur(q.ms)}.</p><a class="btn sm" href="#/jeu/defi">Voir le classement</a>`
          : `<p>10 questions sur les animés, les mêmes pour tout le monde. Compare ton score avec tes amis !</p><a class="btn sm primary" href="#/jeu/defi">Jouer</a>`}
        <p class="hint">Un nouveau défi chaque lundi.</p></section>
    </div>
    <section class="row"><div class="row-h"><h2>Badges</h2><span class="row-sub">${got} / ${B.length} débloqués</span></div>
      <div class="bdg-grid">${B.sort((x, y) => y.done - x.done).map(b => `<div class="bdg${b.done ? " on" : ""}" title="${esc(b.desc)}"><span class="bdg-i">${b.icon}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small>
        ${b.done ? `<em>Débloqué</em>` : `<span class="bdg-p"><i style="width:${Math.round(b.v / b.target * 100)}%"></i></span><em>${fmt(b.v)} / ${fmt(b.target)}</em>`}</div>`).join("")}</div></section>
  </div>`;
  const f = $("goalForm");
  f.onsubmit = async e => {
    e.preventDefault();
    const n = Math.max(1, Math.min(1000, Math.round(+$("goalN").value || 0)));
    try { await setGoal(n, year); toast(`🏁 Objectif ${year} : ${n} animés`); renderProgress(el); } catch { toast("L'objectif n'a pas pu être enregistré."); }
  };
  el.querySelector(".goal-card").onclick = async e => {
    const b = e.target.closest("[data-goal]"); if (!b) return;
    if (b.dataset.goal === "edit") { f.hidden = false; $("goalN").focus(); }
    else if (b.dataset.goal === "del" && confirm("Retirer ton objectif de l'année ?")) { try { await setGoal(0, year); renderProgress(el); } catch { toast("Impossible pour le moment."); } }
  };
}

// ---------------------------------------------------------------------------
// Défi de la semaine
// ---------------------------------------------------------------------------
let quiz = null;   // { qs, i, score, start, picked, timer, left }
const N = 10, SECS = 20;

function rng(seed) {   // générateur pseudo-aléatoire reproductible (mulberry32)
  let h = 1779033703;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19);
  return () => { h |= 0; h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (arr, r) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Les 10 questions de la semaine : affiches, années, studios et personnages, parmi les animés les plus connus. */
function buildQuestions(week) {
  const r = rng("animetheque:" + week);
  const pool = A.filter(a => !a.adult && a.status !== UP && a.rank < 700 && ["TV", "MOVIE", "ONA"].includes(T.format[a.format]) && a.year);
  const pickOther = (a, n, ok) => { const seen = new Set([franchiseKey(a)]); const out = [];
    for (const x of shuffle(pool, r)) { if (out.length >= n) break; const k = franchiseKey(x); if (seen.has(k) || !ok(x)) continue; seen.add(k); out.push(x); } return out; };
  const qs = [], used = new Set();
  const take = ok => { for (const a of shuffle(pool, r)) { const k = franchiseKey(a); if (!used.has(k) && ok(a)) { used.add(k); return a; } } return null; };
  const kinds = shuffle(["cover", "cover", "cover", "cover", "year", "year", "studio", "studio", "char", "char"], r);
  for (const kind of kinds) {
    if (kind === "cover") {
      const a = take(x => hdUrl(x, "large")); if (!a) continue;
      qs.push({ kind, q: "Quel est cet animé ?", img: hdUrl(a, "large"), a, choices: shuffle([a, ...pickOther(a, 3, () => true)].map(x => titleOf(x)), r), ok: titleOf(a) });
    } else if (kind === "year") {
      const a = take(() => true); if (!a) continue;
      const ys = new Set([a.year]); while (ys.size < 4) { const d = Math.floor(r() * 7) - 3; const y = a.year + (d || 4); if (y <= new Date().getFullYear() + 1) ys.add(y); }
      qs.push({ kind, q: `En quelle année a commencé « ${titleOf(a)} » ?`, a, choices: [...ys].sort((x, y) => x - y).map(String), ok: String(a.year) });
    } else if (kind === "studio") {
      const a = take(x => x.studios.length); if (!a) continue;
      const name = T.studios[a.studios[0]], others = new Set();
      for (const x of shuffle(pool, r)) { const n = x.studios.length && T.studios[x.studios[0]]; if (n && n !== name) others.add(n); if (others.size >= 3) break; }
      qs.push({ kind, q: `Quel studio a produit « ${titleOf(a)} » ?`, a, choices: shuffle([name, ...others], r), ok: name });
    } else {
      const a = take(x => x.chars.some(c => c[2] === "M" && c[0] && !norm(titleOf(x) + " " + x.romaji).includes(norm(c[0]).split(" ")[0]))); if (!a) continue;
      const c = a.chars.find(c => c[2] === "M" && c[0] && !norm(titleOf(a) + " " + a.romaji).includes(norm(c[0]).split(" ")[0]));
      qs.push({ kind, q: `Dans quel animé apparaît le personnage « ${c[0]} » ?`, a, choices: shuffle([a, ...pickOther(a, 3, () => true)].map(x => titleOf(x)), r), ok: titleOf(a) });
    }
  }
  return qs.slice(0, N);
}

async function renderQuiz(el) {
  el.innerHTML = `<div class="page jeu"><h1>Jeu</h1>${tabs("defi")}<p class="loading">Préparation du défi…</p></div>`;
  const week = weekKey();
  const [mine] = await Promise.all([myQuiz(week), loadChars().catch(() => {})]);
  if (!isShown() || sub !== "defi") return;
  if (mine === undefined) { el.querySelector(".loading").outerHTML = `<div class="empty"><p>Le défi de la semaine arrive très bientôt.</p></div>`; return; }
  if (mine) return showBoard(el, week, mine);
  el.innerHTML = `<div class="page jeu"><h1>Jeu</h1>${tabs("defi")}
    <section class="quiz-intro card2"><h2>🎯 Défi de la semaine</h2>
      <p><b>${N} questions</b> sur les animés : reconnaître une affiche, une année, un studio, un personnage. <b>${SECS} secondes</b> par question.</p>
      <p>Les questions sont les mêmes pour tout le monde cette semaine. <b>Un seul essai</b> compte pour le classement : en cas d'égalité, le plus rapide gagne.</p>
      <button type="button" class="btn primary" id="quizGo">C'est parti !</button></section>
    <div id="quizBoard"></div></div>`;
  $("quizGo").onclick = () => startQuiz(el, week);
  board($("quizBoard"), week, false);
}

function startQuiz(el, week, practice = false) {
  const qs = buildQuestions(week);
  if (qs.length < 5) { toast("Le défi n'a pas pu être préparé. Réessaie dans un instant."); return; }
  quiz = { qs, i: 0, score: 0, start: Date.now(), picked: null, timer: null, left: SECS, week, practice };
  el.innerHTML = `<div class="page jeu"><h1>Jeu</h1>${tabs("defi")}<section class="quiz" id="quiz"></section></div>`;
  paintQ();
}
function paintQ() {
  const box = $("quiz"); if (!box || !quiz) return;
  const q = quiz.qs[quiz.i], done = quiz.picked != null;
  box.innerHTML = `<div class="qz-h"><span>Question ${quiz.i + 1} / ${quiz.qs.length}</span><span class="qz-s">Score : <b>${quiz.score}</b></span>
      <span class="qz-t${quiz.left <= 5 && !done ? " warn" : ""}" id="qzT">${done ? "" : `⏱ ${quiz.left} s`}</span></div>
    <span class="lv-bar qz-bar"><i style="width:${quiz.i / quiz.qs.length * 100}%"></i></span>
    <h2 class="qz-q">${esc(q.q)}</h2>
    ${q.img ? `<img class="qz-img${done ? "" : " blur"}" src="${esc(q.img)}" alt="Affiche à reconnaître" referrerpolicy="no-referrer" data-hint="${esc(`L'affiche n'a pas pu se charger. Indice : sorti en ${q.a.year}${q.a.studios.length ? `, studio ${T.studios[q.a.studios[0]]}` : ""}.`)}">` : ""}
    <div class="qz-c">${q.choices.map((c, i) => `<button type="button" data-qz="${i}" class="${done ? (c === q.ok ? "good" : quiz.picked === i ? "bad" : "") : ""}"${done ? " disabled" : ""}>${esc(c)}</button>`).join("")}</div>
    ${done ? `<div class="qz-n"><p>${quiz.picked === -1 ? "⏱ Temps écoulé !" : q.choices[quiz.picked] === q.ok ? "✅ Bonne réponse !" : "❌ Raté !"} ${q.choices[quiz.picked] === q.ok ? "" : `C'était <b>${esc(q.ok)}</b>.`}</p>
      <button type="button" class="btn primary" data-qz="next">${quiz.i + 1 < quiz.qs.length ? "Question suivante →" : "Voir mon score"}</button></div>` : ""}`;
  const img = box.querySelector(".qz-img");
  if (img) img.onerror = () => { const p = document.createElement("p"); p.className = "hint qz-miss"; p.textContent = img.dataset.hint; img.replaceWith(p); };
  box.onclick = e => {
    const b = e.target.closest("[data-qz]"); if (!b) return;
    if (b.dataset.qz === "next") return next();
    if (quiz.picked != null) return;
    answer(+b.dataset.qz);
  };
  if (!done) {
    clearInterval(quiz.timer);
    quiz.timer = setInterval(() => {
      if (!quiz || !$("quiz")) { clearInterval(quiz && quiz.timer); return; }
      quiz.left--;
      const t = $("qzT"); if (t) { t.textContent = `⏱ ${quiz.left} s`; t.classList.toggle("warn", quiz.left <= 5); }
      if (quiz.left <= 0) answer(-1);
    }, 1000);
  }
}
function answer(i) {
  clearInterval(quiz.timer);
  const q = quiz.qs[quiz.i];
  quiz.picked = i;
  if (i >= 0 && q.choices[i] === q.ok) quiz.score++;
  paintQ();
}
function next() {
  if (quiz.i + 1 < quiz.qs.length) { quiz.i++; quiz.picked = null; quiz.left = SECS; paintQ(); return; }
  finish();
}
async function finish() {
  const { score, qs, start, week, practice } = quiz, ms = Math.min(3600000, Date.now() - start), total = qs.length;
  quiz = null;
  const el = root;
  if (practice) { toast(`Entraînement : ${score}/${total}`); return showBoard(el, week, null, { score, total, ms }); }
  const { error } = await supabase.from("quiz_scores").insert({ week, score, total, ms });
  if (error && error.code !== "23505") {
    toast(/row-level|42501/.test(error.message + error.code) ? "La semaine vient de changer : ce score ne peut plus être enregistré." : "Ton score n'a pas pu être enregistré.", 6000);
  }
  if (!error) achievements(true);
  const mine = (await myQuiz(week)) || { score, total, ms };
  showBoard(el, week, mine, null, true);
}

async function showBoard(el, week, mine, practice = null, fresh = false) {
  if (!isShown()) return;
  const m = mine || practice;
  const msg = m.score === m.total ? "💯 Sans-faute ! Impressionnant." : m.score >= m.total * 0.7 ? "🔥 Très beau score !" : m.score >= m.total * 0.4 ? "👍 Pas mal du tout !" : "💪 La semaine prochaine sera la bonne !";
  el.innerHTML = `<div class="page jeu"><h1>Jeu</h1>${tabs("defi")}
    <section class="quiz-res card2"><small>${practice ? "Entraînement (non classé)" : fresh ? "Ton score de la semaine" : "Tu as déjà joué cette semaine"}</small>
      <div class="qz-big"><b>${m.score}</b><span>/ ${m.total}</span></div><p>${msg} Temps : <b>${dur(m.ms)}</b>.</p>
      <p class="hint">Nouveau défi lundi. ${mine ? `<button type="button" class="linkbtn" id="qzAgain">S'entraîner (non classé)</button>` : ""}</p></section>
    <div id="quizBoard"></div></div>`;
  const again = $("qzAgain"); if (again) again.onclick = () => startQuiz(el, week, true);
  board($("quizBoard"), week, true);
}

async function board(box, week, played) {
  if (!box) return;
  const { data, error } = await supabase.rpc("quiz_board", { p_week: week });
  if (error || !box.isConnected) return;
  const rows = data || [];
  if (!rows.length) { box.innerHTML = `<p class="hint center">Personne n'a encore joué cette semaine${played ? "" : " : sois le premier ou la première !"}</p>`; return; }
  const friends = rows.filter(r => r.friend || r.me);
  const line = r => `<li class="${r.me ? "is-me" : r.friend ? "fr" : ""}"><span class="qb-r">${r.rank}</span><b>${esc(r.username)}</b>${r.me ? `<span class="cm-me">toi</span>` : r.friend ? `<span class="qb-f">ami·e</span>` : "<span></span>"}<span class="qb-s">${r.score}/${r.total}</span><small>${dur(r.ms)}</small></li>`;
  box.innerHTML = `<div class="qb-2">
    ${friends.length > 1 ? `<section class="card2"><h2>Entre amis</h2><ol class="qb">${friends.map(line).join("")}</ol></section>` : ""}
    <section class="card2"><h2>Classement de la semaine</h2><ol class="qb">${rows.filter(r => r.rank <= 20).map(line).join("")}</ol>
      ${rows.some(r => r.me && r.rank > 20) ? `<ol class="qb">${rows.filter(r => r.me).map(line).join("")}</ol>` : ""}</section></div>`;
}
