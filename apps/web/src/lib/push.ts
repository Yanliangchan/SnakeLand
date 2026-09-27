import type { PushConfigDTO, PushPrefsDTO } from "@snakeland/shared";
import { api } from "./api";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** This device's subscription and its preferences, if notifications are on here. */
export async function currentPush(): Promise<{ endpoint: string; prefs: PushPrefsDTO } | null> {
  if (!pushSupported() || Notification.permission !== "granted") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  const { prefs } = await api<{ prefs: PushPrefsDTO | null }>("/v1/push/prefs", { method: "POST", body: { endpoint: sub.endpoint } });
  return prefs ? { endpoint: sub.endpoint, prefs } : null;
}

export const pushConfig = () => api<PushConfigDTO>("/v1/push/config");

/** Ask permission (if needed), subscribe this device, and save the preferences. */
export async function enablePush(publicKey: string, prefs: PushPrefsDTO): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked in your browser settings.");
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api("/v1/push/subscribe", { method: "POST", body: { endpoint: json.endpoint, keys: json.keys, ...prefs } });
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api("/v1/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}
