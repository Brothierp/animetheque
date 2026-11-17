// Notifications sur cet appareil (Web Push) : abonnement du navigateur, enregistré dans push_subscriptions.
// Sur iPhone, il faut d'abord installer l'appli sur l'écran d'accueil (iOS 16.4 ou plus récent).
import { supabase } from "./supabase.js";
import { ME } from "./state.js";
import { isInstalled } from "./install.js";

const FN = () => (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/push";
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const iosNeedsInstall = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !isInstalled();

const b64ToBytes = s => { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };

async function registration() {
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("/sw.js"));
  return navigator.serviceWorker.ready.then(() => reg);
}
async function publicKey() {
  const { data, error } = await supabase.rpc("push_public_key");
  if (error) throw new Error("sql");
  if (data) return data;
  // première fois : la fonction crée ses clés
  const r = await fetch(FN()).catch(() => null);
  const d = r && r.ok ? await r.json().catch(() => ({})) : {};
  if (!d.publicKey) throw new Error("fonction");
  return d.publicKey;
}

/** État sur cet appareil : "unsupported" | "ios-install" | "denied" | "on" | "off". */
export async function pushState() {
  if (!pushSupported()) return iosNeedsInstall() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  return sub ? "on" : "off";
}

export async function enablePush() {
  if (!ME.user) throw new Error("login");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("denied");
  const reg = await registration();
  const key = await publicKey();
  let sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe().catch(() => {});
  sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  const j = sub.toJSON();
  const device = (/android/i.test(navigator.userAgent) ? "Android" : /iphone|ipad/i.test(navigator.userAgent) ? "iPhone / iPad" : /mac/i.test(navigator.userAgent) ? "Mac" : /windows/i.test(navigator.userAgent) ? "Windows" : "Appareil") + " · " + new Date().toLocaleDateString("fr-FR");
  const { error } = await supabase.from("push_subscriptions").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device }, { onConflict: "endpoint" });
  if (error) { await sub.unsubscribe().catch(() => {}); throw error; }
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe().catch(() => {});
}
export async function testPush() { const { error } = await supabase.rpc("push_test"); if (error) throw error; }

export const pushError = e => {
  const m = (e && e.message) || "";
  return m === "denied" ? "Les notifications sont bloquées pour ce site : autorise-les dans les réglages du navigateur (icône 🔒 à gauche de l'adresse)."
    : m === "sql" ? "Lance d'abord le script SQL 20261117100000 dans Supabase."
    : m === "fonction" ? "La fonction « push » n'est pas encore déployée sur Supabase."
    : m === "login" ? "Connecte-toi d'abord." : "L'activation a échoué. Réessaie dans un instant.";
};
