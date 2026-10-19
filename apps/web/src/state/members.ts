/** فهرست اعضای پروژه‌ی جاری (برای اتصال منبع به کاربر، تب کاربران و …). */
import { useCallback, useEffect, useState } from 'react';
import type { Role } from '@bistoon/core';
import { apiGet, errorMessage } from '../api/client.ts';

export interface MemberRow {
  userId: number;
  username: string;
  displayName: string;
  isActive: boolean;
  roles: Role[];
}

export function useMembers(pid: number): { members: MemberRow[] | null; error: string | null; reload: () => void } {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setError(null);
    apiGet<{ members: MemberRow[] }>(`/projects/${pid}/members`, ctl.signal)
      .then((r) => setMembers(r.members))
      .catch((e) => {
        if (!ctl.signal.aborted) setError(errorMessage(e));
      });
    return () => ctl.abort();
  }, [pid, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { members, error, reload };
}
