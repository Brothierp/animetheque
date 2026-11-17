// Fonction Supabase « push » : envoie les notifications sur les téléphones et ordinateurs abonnés (Web Push).
// Appelée par la base de données (déclencheurs et tâche planifiée), avec un secret partagé.
//   GET                       → crée les clés VAPID si besoin (une seule fois) et renvoie la clé publique
//   POST {notification_id}    → envoie une notification de la cloche
//   POST {message_id}         → prévient d'un nouveau message privé
//   POST {episodes: true}     → vérifie sur AniList les épisodes sortis dans l'heure et prévient les membres qui suivent la série
// À déployer avec « Enforce JWT verification » désactivé (le secret partagé protège les envois).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Clé serveur : ancienne « service_role » ou nouvelle clé secrète « sb_secret_… », selon le projet.
function serverKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); const k = Object.values(keys)[0]; if (typeof k === "string") return k; } catch { /* ignoré */ }
  throw new Error("Clé serveur introuvable (SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEYS)");
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, serverKey(), { auth: { persistSession: false } });
const SITE = "https://animetheque.vercel.app";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

async function config() {
  const { data, error } = await db.rpc("push_config_get");
  if (error) throw error;
  let c = (data || [])[0];
  if (c && !c.public_key) {                                   // première utilisation : création des clés
    const k = webpush.generateVAPIDKeys();
    await db.rpc("push_config_set_keys", { pub: k.publicKey, priv: k.privateKey });
    c = ((await db.rpc("push_config_get")).data || [])[0];
  }
  return c;
}

async function sendTo(userId: string, payload: Record<string, string>) {
  const c = await config();
  webpush.setVapidDetails(c.subject, c.public_key, c.private_key);
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);   // appareil désabonné
    }
  }
  return sent;
}
const username = async (id: string | null) => {
  if (!id) return "Quelqu'un";
  const { data } = await db.from("profiles").select("username").eq("user_id", id).maybeSingle();
  return data?.username || "Un membre";
};

async function notification(id: number) {
  const { data: n } = await db.from("notifications").select("*").eq("id", id).maybeSingle();
  if (!n) return 0;
  const who = await username(n.actor);
  const [aid, ep] = String(n.ref || "").split(":");
  const m: Record<string, [string, string, string]> = {
    friend_request: ["Nouvelle demande d'ami", `${who} veut devenir ton ami·e`, "/#/amis/amis"],
    friend_accepted: ["Demande acceptée 🎉", `${who} a accepté ta demande d'ami`, `/#/amis/membre/${n.actor}`],
    fanart_approved: ["Fan art publié 🎨", "Ton fan art est visible dans la galerie", `/#/fanarts/${n.ref}`],
    fanart_rejected: ["Fan art refusé", "Le motif est indiqué dans « Mes fan arts »", "/#/fanarts/mes"],
    feedback_reply: ["Réponse à ta suggestion 💡", "L'administrateur t'a répondu", "/#/compte"],
    chat_image: ["Image visible", `L'image envoyée par ${who} a été vérifiée`, `/#/amis/chat/${n.actor}`],
    episode_reply: ["Nouvelle réponse 💬", `${who} t'a répondu sur l'épisode ${ep}${n.title ? ` de ${n.title}` : ""}`, `/#/anime/${aid}`],
    episode: [`Épisode ${ep} disponible 📺`, `${n.title || "Une série que tu suis"} : le nouvel épisode vient de sortir`, `/#/anime/${aid}`],
    test: ["Ça marche ! 🔔", "Les notifications de l'Animéthèque sont activées sur cet appareil.", "/#/compte"],
  };
  const [title, body, url] = m[n.kind] || ["Animéthèque", "Nouvelle notification", "/"];
  return sendTo(n.user_id, { title, body, url: SITE + url, tag: n.kind === "episode" ? `ep-${aid}` : n.kind });
}

async function message(id: number) {
  const { data: msg } = await db.from("messages").select("sender, recipient, body").eq("id", id).maybeSingle();
  if (!msg) return 0;
  const who = await username(msg.sender);
  const text = String(msg.body).replace(/\[\[(anime|perso|fanart|image):[^\]]+\]\]/g, "🖼️").slice(0, 120);
  return sendTo(msg.recipient, { title: `💬 ${who}`, body: text, url: `${SITE}/#/amis/chat/${msg.sender}`, tag: `msg-${msg.sender}` });
}

async function episodes() {
  const now = Math.floor(Date.now() / 1000);
  const q = `query($s:Int,$e:Int,$p:Int){ Page(page:$p, perPage:50){ pageInfo{ hasNextPage } airingSchedules(airingAt_greater:$s, airingAt_lesser:$e){ episode mediaId media{ title{ english romaji } } } } }`;
  const aired: { episode: number; mediaId: number; title: string }[] = [];
  for (let p = 1; p <= 6; p++) {
    const r = await fetch("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: q, variables: { s: now - 3600 - 600, e: now - 600, p } }) });
    const d = await r.json();
    const pg = d?.data?.Page; if (!pg) break;
    for (const x of pg.airingSchedules) aired.push({ episode: x.episode, mediaId: x.mediaId, title: x.media?.title?.english || x.media?.title?.romaji || "" });
    if (!pg.pageInfo.hasNextPage) break;
  }
  if (!aired.length) return 0;
  const { data: rows } = await db.rpc("push_watchers", { ids: aired.map(a => a.mediaId) });
  let n = 0;
  for (const w of rows || []) {
    const a = aired.find(x => x.mediaId === w.anime_id)!;
    // pas de doublon si la tâche repasse sur le même épisode
    const ref = `${a.mediaId}:${a.episode}`;
    const { count } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", w.user_id).eq("kind", "episode").eq("ref", ref);
    if (count) continue;
    await db.from("notifications").insert({ user_id: w.user_id, kind: "episode", ref, title: a.title });   // le déclencheur envoie la notification
    n++;
  }
  return n;
}

Deno.serve(async req => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" } });
    const c = await config();
    if (req.method === "GET") return json({ publicKey: c.public_key });
    if (req.headers.get("x-push-secret") !== c.secret) return json({ error: "forbidden" }, 403);
    const b = await req.json().catch(() => ({}));
    if (b.notification_id) return json({ sent: await notification(+b.notification_id) });
    if (b.message_id) return json({ sent: await message(+b.message_id) });
    if (b.episodes) return json({ notified: await episodes() });
    return json({ error: "rien à faire" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
