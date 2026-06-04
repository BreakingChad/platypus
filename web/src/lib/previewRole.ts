import { useSyncExternalStore } from "react";

/** Preview-as-role — an ADMIN-ONLY, session-local override that makes the
 *  whole app resolve nav + page layouts from a chosen access role instead of
 *  your own. Nothing is written to the database; permissions are unchanged
 *  (it's a layout preview, not an impersonation). Survives reloads via
 *  localStorage; exit from the floating pill.
 */
const KEY = "pp:previewRole";
const EVENT = "pp:preview-role-changed";

export type PreviewRole = { id: string; name: string };

export function getPreviewRole(): PreviewRole | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v.id === "string" ? (v as PreviewRole) : null;
  } catch {
    return null;
  }
}

export function setPreviewRole(role: PreviewRole | null) {
  try {
    if (role) window.localStorage.setItem(KEY, JSON.stringify(role));
    else window.localStorage.removeItem(KEY);
  } catch {
    // storage unavailable — preview just won't persist
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

let cached: PreviewRole | null = null;
let cachedRaw: string | null = null;
function getSnapshot(): PreviewRole | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = getPreviewRole();
  }
  return cached;
}

/** Reactive read of the current preview role (admin gating happens at use). */
export function usePreviewRole(): PreviewRole | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
