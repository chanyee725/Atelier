// Inside of the chat dock window (#937), loaded on its first open: 대화 상대 picker, the conversation (the #915 bubbles
// and markdown reader via SessionSheet's Chat), 생각 중…, and the message box (Enter sends, Shift+Enter adds a line).
import { useEffect, useRef } from 'react';
import { SendHorizontal, X } from 'lucide-react';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { NativeSelect } from '../components/ui/native-select';
import { Textarea } from '../components/ui/textarea';
import { Chat, type Report } from '../dispatch/SessionSheet';
import { canRun, READ_ONLY_NOTICE } from '../dispatch/lib/runnable.ts';
import type { Session } from '../../../shared/dispatch/types.ts';
import { sendsOnEnter, type ChatTarget } from './lib/chatDock.ts';

type Props = {
  titleId: string;
  open: boolean;
  targets: ChatTarget[];
  target: ChatTarget;
  onPick: (key: string) => void;
  session: Session | undefined;
  thinking: boolean;
  draft: string;
  setDraft: (v: string) => void;
  busy: boolean;
  /** Why the message cannot go yet (Claude not connected for the helper); replaces the empty-state hint. */
  notice: string | null;
  error: string | null;
  setError: (v: string | null) => void;
  onSend: () => void;
  onClose: () => void;
};

export default function ChatPane({ titleId, open, targets, target, onPick, session: s, thinking, draft, setDraft, busy, notice, error, setError, onSend, onClose }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  // The message box takes focus when the window opens and when another partner is picked.
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open, target.key]);
  const report: Report = p => p.then(() => { setError(null); return true; }, (e: Error) => { setError(e.message); return false; });
  const readOnly = !!s && !canRun(s);
  const name = target.id ? target.label.split(' · ')[0] : '도우미';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b py-2.5 pr-2.5 pl-4">
        <h2 id={titleId} className="m-0 shrink-0 text-[13px] font-semibold">채팅</h2>
        <NativeSelect
          aria-label="대화 상대"
          value={target.key}
          onChange={e => onPick(e.target.value)}
          className="max-w-[220px] truncate"
        >
          {targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </NativeSelect>
        <Button size="icon-sm" variant="ghost" className="ml-auto text-muted-foreground" aria-label="채팅 닫기" onClick={onClose}>
          <X />
        </Button>
      </header>
      {error && <Alert variant="destructive" className="rounded-none">{error}</Alert>}
      <div className="min-h-0 flex-1">
        {s ? (
          <Chat s={s} report={report} thinking={false} />
        ) : (
          <div className="flex h-full flex-col justify-end gap-1 overlay-body-mid text-[13px] leading-[1.55]">
            <p className="m-0 font-medium">무엇이든 물어보세요</p>
            <p role={notice ? 'note' : undefined} className="m-0 text-muted-foreground">{notice ?? '처음 보내면 이 프로젝트의 도우미 세션을 만들어요.'}</p>
          </div>
        )}
      </div>
      <p role="status" className="chat-dock-thinking">{thinking ? '생각 중…' : ''}</p>
      {readOnly ? (
        <p role="note" className="overlay-foot m-0 border-t text-[13px] leading-[1.55] text-muted-foreground">{READ_ONLY_NOTICE}</p>
      ) : (
        <div className="overlay-foot flex items-end gap-2 border-t">
          <Textarea
            ref={input}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (sendsOnEnter({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode, repeat: e.repeat })) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={`${name}에게 메시지 보내기`}
            aria-label="메시지"
            className="max-h-32 min-h-10 resize-none rounded-[10px] px-3 py-2 text-[13px] leading-[1.55] md:text-[13px]"
            rows={1}
          />
          <Button size="icon" onClick={onSend} disabled={!draft.trim() || busy || !!notice} aria-label="보내기"><SendHorizontal /></Button>
        </div>
      )}
    </div>
  );
}
