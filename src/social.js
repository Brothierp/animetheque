// Social : amis, messages, listes partagées, suggestions, signalements, compteurs (pastilles).
// Toutes les règles (amis seulement, blocages, mineurs, filtre…) sont appliquées par la base de données.
import { supabase } from "./supabase.js";
import { ME, onChange } from "./state.js";
import { toast } from "./toast.js";

export const SOC = {
  enabled: null,                  // null = inconnu, false = script SQL « social » pas encore lancé
  counters: { messages: 0, friend_requests: 0, feedback_replies: 0, admin_feedback: 0, admin_reports: 0 },
  friends: new Map(),             // uid → { uid, status: "friend" | "sent" | "received", since }
  people: new Map(),              // uid → { username, avatar_path, avatar }
  convos: null                    // [{ uid, last, unread }]
};
const listeners = new Set();
export const onSocial = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = what => listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } });
const me = () => ME.user && ME.user.id;
const missing = err => err && (err.code === "PGRST202" || err.code === "42883" || err.code === "PGRST205" || err.code === "42P01" || /could not find the (function|table)|does not exist/i.test(err.message || ""));

export function socialError(err) {
  const m = (err && (err.message || "")) + " " + (err && err.code || "");
  if (/forbidden_word/.test(m)) return "Ce message contient un terme interdit (insulte, propos haineux…).";
  if (/contact_blocked/.test(m)) return "Message bloqué : entre majeurs et mineurs, on n'échange ni numéro, ni e-mail, ni réseau social, ni lien. Restez sur l'Animéthèque.";
  if (/language/.test(m)) return "Seuls le français et l'anglais sont acceptés (le japonais uniquement pour citer un titre).";
  if (/rate_limited/.test(m)) return "Doucement ! Trop d'envois d'un coup, réessaie dans un instant.";
  if (/not_allowed/.test(m)) return "Impossible d'ajouter cette personne.";
  if (/row-level security|42501/.test(m)) return "Action non autorisée (vous n'êtes peut-être plus amis).";
  return "L'action a échoué. Réessaie dans un instant.";
}
async function call(fn) { const r = await fn; if (r.error) throw r.error; return r.data; }

// ---------- Compteurs ----------
export async function refreshCounters() {
  if (!me()) return;
  const { data, error } = await supabase.rpc("my_counters");
  if (error) { if (missing(error)) { SOC.enabled = false; emit("enabled"); } return; }
  if (SOC.enabled !== true) { SOC.enabled = true; emit("enabled"); }
  const c = (Array.isArray(data) ? data[0] : data) || {};
  for (const k of Object.keys(SOC.counters)) SOC.counters[k] = Number(c[k] || 0);
  emit("counters");
}

// ---------- Profils des membres (pseudo + avatar, amis seulement) ----------
const signed = new Map();
async function avatarOf(path) {
  if (!path) return "";
  if (signed.has(path)) return signed.get(path);
  const { data } = await supabase.storage.from("avatars").createSignedUrl(path, 86400);
  const u = (data && data.signedUrl) || ""; signed.set(path, u); return u;
}
export async function loadPeople(ids) {
  ids = [...new Set(ids)].filter(id => id && !SOC.people.has(id));
  if (!ids.length) return;
  const rows = await call(supabase.rpc("member_profiles", { ids }));
  await Promise.all(rows.map(async r => SOC.people.set(r.user_id, { username: r.username || "Membre", avatar_path: r.avatar_path, mixed: !!r.mixed, avatar: await avatarOf(r.avatar_path) })));
  for (const id of ids) if (!SOC.people.has(id)) SOC.people.set(id, { username: "Membre", avatar: "" });
}
export const person = uid => SOC.people.get(uid) || { username: "Membre", avatar: "" };

// ---------- Amis ----------
export async function loadFriends() {
  const rows = await call(supabase.from("friendships").select("user_a, user_b, requested_by, status, created_at, accepted_at"));
  SOC.friends = new Map(rows.map(r => {
    const uid = r.user_a === me() ? r.user_b : r.user_a;
    return [uid, { uid, status: r.status === "accepted" ? "friend" : r.requested_by === me() ? "sent" : "received", since: r.accepted_at || r.created_at }];
  }));
  await loadPeople([...SOC.friends.keys()]);
  emit("friends");
}
export const friendsList = () => [...SOC.friends.values()].filter(f => f.status === "friend").sort((a, b) => person(a.uid).username.localeCompare(person(b.uid).username, "fr"));
export const isFriend = uid => SOC.friends.get(uid) && SOC.friends.get(uid).status === "friend";

export async function findMember(name) {
  const rows = await call(supabase.rpc("find_member", { name }));
  const r = rows[0]; if (!r) return null;
  SOC.people.set(r.user_id, { username: r.username, avatar_path: r.avatar_path, mixed: !!r.mixed, avatar: await avatarOf(r.avatar_path).catch(() => "") });
  return r;
}
export async function sendRequest(uid) { const s = await call(supabase.rpc("send_friend_request", { target: uid })); await loadFriends(); refreshCounters(); return s; }
export async function acceptRequest(uid) { await call(supabase.rpc("accept_friend", { other: uid })); await loadFriends(); refreshCounters(); }
export async function removeFriend(uid) {
  await call(supabase.from("friendships").delete().or(`and(user_a.eq.${me()},user_b.eq.${uid}),and(user_a.eq.${uid},user_b.eq.${me()})`));
  await loadFriends(); refreshCounters();
}
export async function blockUser(uid) { await call(supabase.rpc("block_user", { target: uid })); SOC.convos = null; await loadFriends(); refreshCounters(); }
export async function listBlocks() {
  const rows = await call(supabase.from("blocks").select("blocked, created_at"));
  return rows;
}
export async function unblock(uid) { await call(supabase.from("blocks").delete().eq("blocked", uid)); }

// ---------- Messages ----------
const pair = uid => `and(sender.eq.${me()},recipient.eq.${uid}),and(sender.eq.${uid},recipient.eq.${me()})`;
export async function loadConversations() {
  const rows = await call(supabase.from("messages").select("id, sender, recipient, body, created_at, read_at").order("created_at", { ascending: false }).limit(800));
  const map = new Map();
  for (const m of rows) {
    const uid = m.sender === me() ? m.recipient : m.sender;
    if (!map.has(uid)) map.set(uid, { uid, last: m, unread: 0 });
    if (m.recipient === me() && !m.read_at) map.get(uid).unread++;
  }
  await loadPeople([...map.keys()]);
  SOC.convos = [...map.values()];
  emit("convos");
  return SOC.convos;
}
export async function loadThread(uid, before) {
  let q = supabase.from("messages").select("id, sender, recipient, body, created_at, read_at").or(pair(uid)).order("created_at", { ascending: false }).limit(60);
  if (before) q = q.lt("created_at", before);
  return (await call(q)).reverse();
}
export async function sendMessage(uid, body) {
  return call(supabase.from("messages").insert({ sender: me(), recipient: uid, body: body.trim().slice(0, 2000) }).select("id, sender, recipient, body, created_at, read_at").single());
}
export async function markRead(uid) {
  await call(supabase.from("messages").update({ read_at: new Date().toISOString() }).eq("sender", uid).eq("recipient", me()).is("read_at", null));
  refreshCounters();
}
export async function deleteMessage(id) { await call(supabase.from("messages").delete().eq("id", id)); }
export async function report({ messageId, commentId, fanartId, targetUser, reason }) {
  await call(supabase.from("reports").insert({ message_id: messageId || null, comment_id: commentId || null, ...(fanartId ? { fanart_id: fanartId } : {}), target_user: targetUser || null, reason: reason.trim().slice(0, 500) }));
}

// ---------- Avis sous les animés (lisibles par tous) ----------
export async function animeComments(aid) { return call(supabase.rpc("anime_comments_list", { aid })); }
export async function saveComment(aid, body, spoiler, id) {
  body = body.trim().slice(0, 1500);
  if (id) await call(supabase.from("anime_comments").update({ body, spoiler }).eq("id", id));
  else await call(supabase.from("anime_comments").insert({ anime_id: aid, body, spoiler }));
}
export async function deleteComment(id) { await call(supabase.from("anime_comments").delete().eq("id", id)); }
export const isMissing = missing;

// Messages en direct : un abonnement par session.
let channel = null;
const msgListeners = new Set();
export const onMessage = fn => { msgListeners.add(fn); return () => msgListeners.delete(fn); };
function subscribe() {
  unsubscribe();
  if (!me()) return;
  channel = supabase.channel("messages-" + me())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient=eq.${me()}` }, p => {
      const m = p.new; msgListeners.forEach(fn => fn(m)); refreshCounters();
      if (!msgListeners.size) loadPeople([m.sender]).then(() => toast(`💬 Nouveau message de ${person(m.sender).username}`));
    }).subscribe();
}
function unsubscribe() { if (channel) { supabase.removeChannel(channel); channel = null; } }

// ---------- Listes partagées ----------
export async function setListVisibility(lid, v) { await call(supabase.from("lists").update({ visibility: v }).eq("id", lid)); }
export async function listMembers(lid) { return call(supabase.from("list_members").select("user_id, added_at").eq("list_id", lid)); }
export async function addListMember(lid, uid) { await call(supabase.from("list_members").insert({ list_id: lid, user_id: uid })); }
export async function removeListMember(lid, uid) { await call(supabase.from("list_members").delete().eq("list_id", lid).eq("user_id", uid)); }
/** Listes de mes amis visibles par moi (partagées ou communes). */
export async function sharedLists() {
  const [lists, mine] = await Promise.all([
    call(supabase.from("lists").select("id, user_id, name, visibility, created_at").neq("user_id", me())),
    call(supabase.from("list_members").select("list_id").eq("user_id", me()))
  ]);
  const member = new Set(mine.map(m => m.list_id));
  await loadPeople(lists.map(l => l.user_id));
  return lists.map(l => ({ ...l, member: member.has(l.id) }));
}
export async function listItemsOf(lid) { return call(supabase.from("list_items").select("anime_id, added_at, added_by").eq("list_id", lid).order("added_at", { ascending: false })); }
export async function addToSharedList(lid, owner, animeId) { await call(supabase.from("list_items").upsert({ list_id: lid, user_id: owner, anime_id: animeId }, { onConflict: "list_id,anime_id", ignoreDuplicates: true })); }
export async function removeFromSharedList(lid, animeId) { await call(supabase.from("list_items").delete().eq("list_id", lid).eq("anime_id", animeId)); }

// ---------- Suggestions ----------
export async function sendFeedback(kind, body) {
  await call(supabase.from("feedback").insert({ user_id: me(), kind, body: body.trim().slice(0, 2000), page: (location.hash || "#/").slice(0, 200) }));
}
export async function myFeedback() {
  const fb = await call(supabase.from("feedback").select("id, kind, body, status, user_unread, created_at, updated_at").eq("user_id", me()).order("updated_at", { ascending: false }));
  const replies = fb.length ? await call(supabase.from("feedback_replies").select("id, feedback_id, body, from_admin, created_at").in("feedback_id", fb.map(f => f.id)).order("created_at")) : [];
  return fb.map(f => ({ ...f, replies: replies.filter(r => r.feedback_id === f.id) }));
}
export async function replyFeedback(id, body) { await call(supabase.from("feedback_replies").insert({ feedback_id: id, body: body.trim().slice(0, 2000) })); refreshCounters(); }
export async function markFeedbackRead() { await call(supabase.rpc("mark_feedback_read")); refreshCounters(); }
export async function adminFeedback() { return call(supabase.rpc("admin_feedback")); }
export async function feedbackReplies(id) { return call(supabase.from("feedback_replies").select("id, body, from_admin, created_at").eq("feedback_id", id).order("created_at")); }
export async function setFeedbackStatus(id, status) { await call(supabase.from("feedback").update({ status }).eq("id", id)); refreshCounters(); }
export async function adminReports() { return call(supabase.rpc("admin_reports")); }
export async function setReportHandled(id, handled) { await call(supabase.from("reports").update({ handled }).eq("id", id)); refreshCounters(); }

// ---------- Session ----------
let timer = null;
onChange(what => {
  if (what === "session") {
    SOC.friends = new Map(); SOC.people = new Map(); SOC.convos = null; signed.clear();
    for (const k of Object.keys(SOC.counters)) SOC.counters[k] = 0;
    clearInterval(timer); unsubscribe(); emit("counters");
    if (!me()) { SOC.enabled = null; return; }
  }
  if (what === "profile-loaded") {
    refreshCounters().then(() => { if (SOC.enabled) { subscribe(); loadFriends().catch(() => {}); } });
    clearInterval(timer); timer = setInterval(refreshCounters, 45000);
  }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshCounters(); });
