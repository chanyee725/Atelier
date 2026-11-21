// Version history of the open file: the saved versions, a rendered read-only preview, and "restore".
// Restoring is a normal save of that version's content over the current file (App does it).
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, type HistoryEntry, type HistoryVersion, type VersionLabel } from './api';
import { RenderedDoc } from './doc/RenderedDoc';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';
import { cn } from './lib/utils';
import { askConfirm } from './appDialog';
import { dateTimeLabel } from './lib/when';

type Props = {
  path: string;
  dark: boolean;
  onClose: () => void;
  /** Resolves with an error message, or null once the version is restored. */
  onRestore: (id: string) => Promise<string | null>;
};

// Pipeline milestones (E28), in run order.
const LABEL_TEXT: Record<VersionLabel, string> = { draft: '계획 초안', approved: '승인', done: '완료' };
export const versionLabels = (ls: readonly string[] | undefined): string[] =>
  (Object.keys(LABEL_TEXT) as VersionLabel[]).filter((l) => ls?.includes(l)).map((l) => LABEL_TEXT[l]);

// Server messages are English; show Korean copy by status, never the raw message.
const errText = (e: unknown, fallback: string) => {
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 404) return '이 버전을 찾지 못했어요';
  if (status === 422) return '이 버전을 읽을 수 없어요';
  return fallback;
};

export function HistoryDialog({ path, dark, onClose, onRestore }: Props) {
  const [versions, setVersions] = useState<HistoryEntry[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<HistoryVersion | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .history(path)
      .then((v) => {
        if (!live) return;
        setVersions(v);
        if (v[0]) setPicked(v[0].id);
      })
      .catch(() => live && (setVersions([]), setMessage('버전 기록을 불러오지 못했어요')));
    return () => {
      live = false;
    };
  }, [path]);

  useEffect(() => {
    if (!picked) return setPreview(null);
    let live = true;
    setPreview(null);
    api
      .historyVersion(path, picked)
      .then((v) => live && setPreview(v))
      .catch((e) => live && setMessage(errText(e, '이 버전을 불러오지 못했어요')));
    return () => {
      live = false;
    };
  }, [path, picked]);

  const restore = async () => {
    if (!picked || !preview || busy) return;
    const ok = await askConfirm({ title: `${dateTimeLabel(preview.time)} 버전으로 되돌릴까요?`, body: '지금 내용도 버전 기록에 남겨 둬요.', ok: '되돌리기' });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const err = await onRestore(picked);
    setBusy(false);
    if (err) setMessage(err);
    else onClose();
  };

  const hint = 'px-3 py-2 text-sm text-muted-foreground';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label="버전 기록" aria-describedby={undefined} className="h-[min(40rem,calc(100%-2rem))] w-[min(56rem,calc(100%-2rem))] max-w-none">
        <DialogHeader>
          <DialogTitle className="mr-auto">버전 기록</DialogTitle>
          <Button variant="ghost" size="icon-sm" aria-label="닫기" title="닫기" onClick={onClose} className="max-md:size-11">
            <X />
          </Button>
        </DialogHeader>
        {message && (
          <p role="alert" className="bg-muted px-(--overlay-x) py-2 text-sm">
            {message}
          </p>
        )}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <ul className="max-h-40 shrink-0 overflow-auto border-b p-1.5 md:max-h-none md:w-56 md:border-r md:border-b-0" aria-label="저장된 버전">
            {versions === null && <li className={hint}>불러오는 중이에요…</li>}
            {versions?.length === 0 && <li className={hint}>아직 저장된 버전이 없어요</li>}
            {versions?.map((v) => (
              <li key={v.id}>
                <Button
                  variant="ghost"
                  aria-pressed={picked === v.id}
                  onClick={() => setPicked(v.id)}
                  className={cn('h-auto min-h-(--h-row) w-full flex-wrap justify-start gap-x-1.5 gap-y-0.5 px-2.5 py-1 tabular-nums', picked === v.id && 'bg-muted font-semibold text-foreground')}
                >
                  <span>{dateTimeLabel(v.time)}</span>
                  {versionLabels(v.labels).map((l) => (
                    <span key={l} className="rounded-sm border px-1 text-xs font-normal text-muted-foreground">
                      {l}
                    </span>
                  ))}
                </Button>
              </li>
            ))}
          </ul>
          <section className="overlay-body-mid min-h-0 min-w-0 flex-1 overflow-auto" aria-label="미리보기">
            {!picked ? null : !preview ? (
              <p className="text-sm text-muted-foreground">불러오는 중이에요…</p>
            ) : (
              <article data-testid="history-doc" aria-label="읽기 전용 미리보기" className="mx-auto flex max-w-2xl flex-col gap-4">
                <p className="text-xs text-muted-foreground">읽기 전용 미리보기예요</p>
                <h3 className="text-xl font-semibold break-words">{preview.title || '제목 없는 파일'}</h3>
                <RenderedDoc v={preview} idPrefix={`history:${preview.id}`} dark={dark} />
              </article>
            )}
          </section>
        </div>
        <DialogFooter>
          <Button disabled={!preview || busy} onClick={() => void restore()}>
            {busy ? '되돌리는 중이에요…' : '이 버전으로 되돌리기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
