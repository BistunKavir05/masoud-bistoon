import { useCallback, useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost, errorMessage } from '../../api/client.ts';
import { faDateTime, faInt } from '../../lib/fmt.ts';
import { sessionStore } from '../../state/session.ts';
import { useStore } from '../../state/store.ts';
import { useCan, useProjectState } from '../../state/project.ts';
import { Alert, Btn, Card, Empty, Loading, PageHead } from '../../ui/controls.tsx';
import { confirmDialog, toast } from '../../ui/dialogs.tsx';

interface Msg {
  id: number;
  userId: number;
  userName: string;
  body: string;
  createdAt: string;
  deleted: boolean;
}

const PAGE = 100;
const POLL_MS = 5000;

export function ChatTab() {
  const ps = useProjectState();
  const can = useCan();
  const me = useStore(sessionStore, (s) => s.user?.id ?? null);
  const pid = ps.bundle!.project.id;
  const moderate = can('chat.moderate');
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const list = useRef<HTMLDivElement>(null);
  const lastId = useRef(0);

  const merge = useCallback((incoming: Msg[]): void => {
    setMsgs((cur) => {
      const map = new Map<number, Msg>((cur ?? []).map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].sort((a, b) => a.id - b.id);
    });
  }, []);

  // بارگذاری اولیه (و با افزایش سقف)
  useEffect(() => {
    const ctl = new AbortController();
    setError(null);
    apiGet<{ messages: Msg[] }>(`/projects/${pid}/chat?limit=${limit}`, ctl.signal)
      .then((r) => {
        setMsgs(r.messages);
        lastId.current = r.messages.reduce((m, x) => Math.max(m, x.id), 0);
      })
      .catch((e) => !ctl.signal.aborted && setError(errorMessage(e)));
    return () => ctl.abort();
  }, [pid, limit]);

  // به‌روزرسانی دوره‌ای فقط وقتی برگه دیده می‌شود
  useEffect(() => {
    if (msgs === null) return;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      apiGet<{ messages: Msg[] }>(`/projects/${pid}/chat?after=${lastId.current}`)
        .then((r) => {
          if (r.messages.length > 0) {
            lastId.current = Math.max(lastId.current, ...r.messages.map((m) => m.id));
            merge(r.messages);
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [pid, msgs === null, merge]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ block: 'end' });
  }, [msgs]);

  const send = async (): Promise<void> => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await apiPost<{ item: Msg }>(`/projects/${pid}/chat`, { body });
      lastId.current = Math.max(lastId.current, r.item.id);
      merge([r.item]);
      setDraft('');
      stick.current = true;
    } catch (e) {
      toast.bad(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const remove = async (m: Msg): Promise<void> => {
    const ok = await confirmDialog({ title: 'حذف پیام', message: 'این پیام حذف شود؟ جای آن «پیام حذف شد» می‌ماند و متن آن دیگر نمایش داده نمی‌شود.', confirmLabel: 'حذف شود', danger: true });
    if (!ok) return;
    try {
      await apiDelete(`/projects/${pid}/chat/${m.id}`);
      merge([{ ...m, body: '', deleted: true }]);
    } catch (e) {
      toast.bad(errorMessage(e));
    }
  };

  return (
    <>
      <PageHead title="گفتگو" />
      <Card>
        {error ? <Alert kind="bad">{error}</Alert> : null}
        {msgs === null && !error ? (
          <Loading />
        ) : (
          <div className="chat">
            <div
              className="chat-list"
              ref={list}
              role="log"
              aria-live="polite"
              aria-label="پیام‌های گفتگو"
              data-testid="chat-list"
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
            >
              {msgs && msgs.length >= limit && limit < 500 ? (
                <div className="chat-more">
                  <Btn size="sm" onClick={() => setLimit(500)} testId="chat-older">
                    نمایش پیام‌های قدیمی‌تر
                  </Btn>
                </div>
              ) : null}
              {msgs && msgs.length === 0 ? <Empty title="هنوز پیامی نیست">اولین پیام را بنویسید؛ همه‌ی اعضای پروژه که به گفتگو دسترسی دارند آن را می‌بینند.</Empty> : null}
              {msgs?.map((m) => {
                const mine = m.userId === me;
                return (
                  <div key={m.id} className={`msg${mine ? ' mine' : ''}${m.deleted ? ' gone' : ''}`} data-testid={`msg-${m.id}`}>
                    <div className="msg-head">
                      <strong>{m.userName}</strong>
                      <span className="muted small">{faDateTime(m.createdAt)}</span>
                      {!m.deleted && (mine || moderate) ? (
                        <button type="button" className="msg-del" aria-label={`حذف پیام ${m.userName}`} onClick={() => void remove(m)} data-testid={`msg-del-${m.id}`}>
                          حذف
                        </button>
                      ) : null}
                    </div>
                    <div className="msg-body" dir="auto">{m.deleted ? 'این پیام حذف شد.' : m.body}</div>
                  </div>
                );
              })}
              <div ref={bottom} />
            </div>
            <form
              className="chat-form"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label htmlFor="chat-draft" className="sr-only">
                متن پیام
              </label>
              <textarea
                id="chat-draft"
                className="ta"
                rows={2}
                maxLength={4000}
                placeholder="پیام… (Enter ارسال، Shift+Enter خط تازه)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                data-testid="chat-draft"
              />
              <Btn type="submit" kind="primary" busy={sending} disabled={draft.trim() === ''} testId="chat-send">
                ارسال
              </Btn>
            </form>
            <p className="small muted" style={{ margin: 0 }}>
              پیام‌ها هر چند ثانیه به‌روز می‌شوند. {msgs ? `${faInt(msgs.length)} پیام.` : ''} متن پیام‌ها فقط متن ساده است.
            </p>
          </div>
        )}
      </Card>
    </>
  );
}
