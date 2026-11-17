// Aperçu des liens partagés (Discord, WhatsApp, Instagram, X…) : /u/<pseudo> et /l/<id-de-liste>.
// Renvoie une petite page avec les balises Open Graph (titre, description, image), puis redirige le visiteur
// vers la vraie page du site (#/u/… ou #/l/…). Les robots des messageries lisent l'aperçu, les humains sont redirigés.
const SITE = "https://animetheque.vercel.app";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function rpc(fn, args) {
  const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(4000) }).catch(() => null);
  return r && r.ok ? r.json() : null;
}
async function cover(id) {
  if (!id || id >= 900000) return null;
  const r = await fetch("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: "query($id:Int){ Media(id:$id){ coverImage{ extraLarge } bannerImage title{ english romaji } } }", variables: { id } }),
    signal: AbortSignal.timeout(3000) }).catch(() => null);
  const d = r && r.ok ? await r.json().catch(() => null) : null;
  const m = d && d.data && d.data.Media;
  return m ? { img: m.bannerImage || m.coverImage.extraLarge, title: m.title.english || m.title.romaji } : null;
}

export default async function handler(req, res) {
  const kind = req.query.kind === "l" ? "l" : "u", id = String(req.query.id || "").slice(0, 60);
  const target = `${SITE}/#/${kind}/${encodeURIComponent(id)}`;
  let title = "Animéthèque", desc = "Le catalogue d'animés pour suivre, noter et partager ce que tu regardes.", image = `${SITE}/icon-512.png`;
  try {
    if (kind === "u") {
      const p = await rpc("public_profile", { name: id });
      if (p) {
        const c = p.counts || {};
        title = `${p.username} sur l'Animéthèque`;
        desc = `${c.watched || 0} animés vus · ${c.favorites || 0} coups de cœur · ${c.watching || 0} en cours. Découvre ses favoris et ses listes.`;
        const first = await cover((p.favorites || [])[0] || (p.top_rated || [])[0]);
        if (first) { image = first.img; desc = `Coup de cœur : ${first.title}. ` + desc; }
      }
    } else if (/^[0-9a-f-]{36}$/.test(id)) {
      const l = await rpc("public_list", { lid: id });
      if (l) {
        title = `${l.name} · liste de ${l.owner}`;
        desc = `${(l.items || []).length} animés sélectionnés par ${l.owner} sur l'Animéthèque.`;
        const first = await cover((l.items || [])[0]);
        if (first) image = first.img;
      }
    }
  } catch { /* aperçu par défaut */ }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
  res.status(200).send(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="profile"><meta property="og:site_name" content="Animéthèque">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:url" content="${esc(`${SITE}/${kind}/${encodeURIComponent(id)}`)}">
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#130f1f">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
</head><body style="background:#130f1f;color:#ece7f8;font-family:sans-serif"><p><a style="color:#f2b84b" href="${esc(target)}">Ouvrir sur l'Animéthèque</a></p>
<script>location.replace(${JSON.stringify(target)})</script></body></html>`);
}
