import { useEffect, useSyncExternalStore } from "react";

import { fetchMe, type MeDto } from "../services/usersApi";
import {
  getCurrentUserSnapshot,
  setCurrentUserSnapshot,
  subscribeCurrentUser,
  type CurrentUserSnapshot,
} from "./rbac";

export function applyMeDto(me: MeDto): void {
  setCurrentUserSnapshot({
    permissions: new Set(me.permissions ?? []),
    roles: new Set(me.roles ?? []),
    hasFullAccess: !!me.has_full_access,
    username: me.username ?? me.actor ?? null,
    displayName: me.display_name ?? null,
    loaded: true,
  });
}

export async function refreshCurrentUser(): Promise<void> {
  try {
    const me = await fetchMe();
    applyMeDto(me);
  } catch {
    setCurrentUserSnapshot({
      permissions: new Set(),
      roles: new Set(),
      hasFullAccess: true,
      loaded: true,
    });
  }
}

/** Reaktivní přístup k aktuálnímu uživateli (používá store ve `rbac.ts`). */
export function useCurrentUser(): CurrentUserSnapshot {
  return useSyncExternalStore(subscribeCurrentUser, getCurrentUserSnapshot, getCurrentUserSnapshot);
}

/** Vyvolá `/users/me` při mountu (a poté kdykoli se změní klíče triggeru). */
export function useInitCurrentUser(triggers: ReadonlyArray<unknown> = []): void {
  useEffect(() => {
    void refreshCurrentUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, triggers);
}
