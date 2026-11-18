// Sondage « animé de la saison » (page Saison) : un vote par membre et par saison, modifiable jusqu'à la fin
// de la saison ; résultats visibles par tous ; rappel du gagnant de la saison précédente.
import { supabase } from "./supabase.js";
import { byId, titleOf, hdUrl } from "./data.js";
import { ME, inCollection, adultAllowed, requireUser } from "./state.js";
import { tooYoungYear } from "./profile.js";
import { esc } from "./ui.js";
import { toast } from "./toast.js";

export const seasonKey = ({ s, y }) => `${y}-${s}`;
const thumb = a => { const u = hdUrl(a, "medium"); return u ? `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<i>🎬</i>`; };
const ok = a => a && (!a.adult || adultAllowed());

async function results(key) {
  const { data, error } = await supabase.rpc("season_poll", { p_season: key });
  if (error) throw error;
  return (data || []).filter(r => ok(byId.get(r.anime_id)));
}
async function myVote(key) {
  if (!ME.user) return null;
  const { data } = await supabase.from("season_votes").select("anime_id").eq("season", key).maybeSingle();
  return data ? data.anime_id : null;
}

/** Monte le sondage dans `box`. cur / prev : { s, y } ; titles : animés de la saison (par popularité) ; label : « automne 2026 ». */
export async function mountPoll(box, cur, prev, titles, label, prevLabel) {
  if (!supabase || !box) return;
  const key = seasonKey(cur);
  let rows = [], mine = null, picking = false, prevWin = null;
  const paint = () => {
    if (!box.isConnected) return;
    const total = rows.reduce((s, r) => s + +r.votes, 0), max = Math.max(1, ...rows.map(r => +r.votes));
    const young = ME.user && tooYoungYear(ME.profile && ME.profile.birth_year);
    const mineA = mine && byId.get(mine);
    const series = titles.filter(ok);
    const opts = [...series.filter(a => inCollection(a.id)), ...series.filter(a => !inCollection(a.id))];
    const control = !ME.user ? `<button type="button" class="btn sm primary" data-poll="login">Se connecter pour voter</button>`
      : young ? `<p class="hint">🔒 Le vote est réservé aux 15 ans et plus.</p>`
      : mine && !picking ? `<p class="poll-me">Ton vote : <b>${esc(mineA ? titleOf(mineA) : "?")}</b> <button type="button" class="linkbtn" data-poll="change">changer</button></p>`
      : `<form class="poll-f" data-poll="form"><label class="sr" for="pollSel">Ton animé préféré de la saison</label>
          <select id="pollSel" required><option value="">Choisis ton préféré…</option>
            ${opts.filter(a => inCollection(a.id)).length ? `<optgroup label="Dans ta collection">${opts.filter(a => inCollection(a.id)).map(a => `<option value="${a.id}"${a.id === mine ? " selected" : ""}>${esc(titleOf(a))}</option>`).join("")}</optgroup>` : ""}
            <optgroup label="Toute la saison">${opts.filter(a => !inCollection(a.id)).map(a => `<option value="${a.id}"${a.id === mine ? " selected" : ""}>${esc(titleOf(a))}</option>`).join("")}</optgroup>
          </select><button type="submit" class="btn sm primary">Voter</button>${mine ? `<button type="button" class="linkbtn" data-poll="cancel">annuler</button>` : ""}</form>`;
    box.innerHTML = `<section class="poll"><div class="row-h"><h2>🏆 Animé de la saison</h2><span class="row-sub">Vote pour ton préféré de ${esc(label)} : un vote, modifiable jusqu'à la fin de la saison</span></div>
      ${control}
      ${rows.length ? `<ol class="poll-r">${rows.slice(0, 10).map((r, i) => { const a = byId.get(r.anime_id); const pct = Math.round(+r.votes / total * 100);
        return `<li class="${r.anime_id === mine ? "is-me" : ""}"><a href="#/anime/${a.id}">${thumb(a)}</a><span class="poll-t"><span><b>${i + 1}.</b> ${esc(titleOf(a))}</span>
          <span class="poll-bar"><i style="width:${+r.votes / max * 100}%"></i></span></span><small>${pct} % · ${r.votes} vote${r.votes > 1 ? "s" : ""}</small></li>`; }).join("")}</ol>
        <p class="hint">${total} vote${total > 1 ? "s" : ""} au total.</p>` : `<p class="hint">Aucun vote pour l'instant : lance le classement !</p>`}
      ${prevWin ? `<p class="poll-prev">Saison précédente (${esc(prevLabel)}) : 🏆 <a href="#/anime/${prevWin.anime_id}">${esc(titleOf(byId.get(prevWin.anime_id)))}</a> avec ${prevWin.votes} vote${prevWin.votes > 1 ? "s" : ""}</p>` : ""}
    </section>`;
  };
  box.onclick = async e => {
    const b = e.target.closest("[data-poll]"); if (!b || b.tagName === "FORM") return;
    if (b.dataset.poll === "login") requireUser();
    else if (b.dataset.poll === "change") { picking = true; paint(); }
    else if (b.dataset.poll === "cancel") { picking = false; paint(); }
  };
  box.onsubmit = async e => {
    e.preventDefault();
    const id = +box.querySelector("#pollSel").value; if (!id) return;
    const q = mine ? supabase.from("season_votes").update({ anime_id: id }).eq("season", key) : supabase.from("season_votes").insert({ season: key, anime_id: id });
    const { error } = await q;
    if (error) { toast(/row-level|42501/.test(error.message + error.code) ? "Le vote de cette saison est terminé." : "Le vote n'a pas pu être enregistré. Réessaie dans un instant."); return; }
    mine = id; picking = false; toast("🗳️ Vote enregistré !");
    rows = await results(key).catch(() => rows); paint();
  };
  try {
    [rows, mine, prevWin] = await Promise.all([results(key), myVote(key), results(seasonKey(prev)).then(r => r[0] || null).catch(() => null)]);
  } catch { box.innerHTML = ""; return; }   // script SQL pas encore lancé : on n'affiche rien
  paint();
}
