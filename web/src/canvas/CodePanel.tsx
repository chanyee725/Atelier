// "기능 코드" panel (docs/design/code-linked-nodes.md §3): the selected node's feature, its code references and a
// read-only preview of the chosen reference with line numbers and its range highlighted. Reads GET /api/code only.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, api, type CodeWindow } from '../api';
import { Button } from '../components/ui/button';
import { codeError, previewScrollTop, refText, splitPath, type NodeCode } from './codeLinks';

type Props = {
  /** Feature name shown as the title (the node or shape label). */
  label: string;
  code: NodeCode;
  /** Stored entries of this block that match no node any more; a button offers to remove them. */
  orphans?: number;
  onCleanOrphans?: () => void;
  onClose: () => void;
};

type Preview = { state: 'loading' } | { state: 'error'; text: string } | { state: 'ok'; win: CodeWindow };

export function CodePanel({ label, code, orphans = 0, onCleanOrphans, onClose }: Props) {
  const [pick, setPick] = useState(0);
  const refs = code.refs;
  const ref = refs[Math.min(pick, refs.length - 1)];
  // The first ref again when the panel moves to another node.
  const key = `${label}\n${refs.map(refText).join('\n')}`;
  useEffect(() => setPick(0), [key]);

  const [preview, setPreview] = useState<Preview>({ state: 'loading' });
  const end = ref ? (ref.end ?? ref.start) : 0;
  useEffect(() => {
    if (!ref) return;
    const ctl = new AbortController();
    setPreview({ state: 'loading' });
    api
      .code(ref.path, ref.start, end, ctl.signal)
      .then((win) => setPreview({ state: 'ok', win }))
      .catch((e) => {
        if (ctl.signal.aborted) return;
        setPreview({ state: 'error', text: e instanceof ApiError ? codeError(e.status, e.message) : codeError(0) });
      });
    return () => ctl.abort();
  }, [ref?.path, ref?.start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  // The highlighted range is scrolled into view inside the preview only (never the page), centred when it fits, else starting at its first line.
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const b = box.current;
    const f = first.current;
    if (!b || !f || preview.state !== 'ok') return;
    const span = (Math.min(end, preview.win.end) - ref!.start + 1) * f.offsetHeight;
    b.scrollTop = previewScrollTop({ firstTop: f.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop, span, boxHeight: b.clientHeight });
  }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside
      aria-label="기능 코드"
      data-code-panel=""
      className="absolute right-3 top-16 bottom-3 z-10 flex w-[min(28rem,calc(100%-1.5rem))] flex-col gap-3 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-(--shadow-pop)"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">기능 코드</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          닫기
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold [overflow-wrap:anywhere]">{label}</h2>
        {code.summary && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{code.summary}</p>}
      </div>
      {refs.length > 0 ? (
        <>
          <ul aria-label="코드 위치" className="flex max-h-40 shrink-0 flex-col gap-0.5 overflow-auto">
            {refs.map((r, i) => {
              const { dir, file } = splitPath(r.path);
              const lines = r.end !== undefined && r.end !== r.start ? `:${r.start}-${r.end}` : `:${r.start}`;
              return (
                <li key={`${i}:${refText(r)}`}>
                  <button
                    type="button"
                    aria-pressed={i === pick}
                    data-code-ref={refText(r)}
                    className="flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1 text-left text-xs outline-offset-[-2px] hover:bg-accent aria-pressed:bg-accent"
                    onClick={() => setPick(i)}
                  >
                    {/* The directory shrinks with an ellipsis; the file name and line range stay visible. */}
                    <span className="flex min-w-0 font-mono whitespace-nowrap" title={refText(r)}>
                      <span className="min-w-0 overflow-hidden text-ellipsis text-muted-foreground">{dir}</span>
                      <span className="shrink-0">{file}</span>
                      <span className="shrink-0 text-muted-foreground">{lines}</span>
                    </span>
                    {r.symbol && <span className="truncate font-mono text-[11px]">{r.symbol}</span>}
                    {r.note && <span className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{r.note}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex min-h-0 flex-1 flex-col gap-1">
            {preview.state === 'ok' && preview.win.truncated && <p className="text-[11px] text-muted-foreground">범위가 길어서 앞쪽 400줄만 보여 줘요</p>}
            {preview.state === 'error' && (
              <p role="status" className="text-xs text-muted-foreground">
                {preview.text}
              </p>
            )}
            {preview.state === 'loading' && <p className="text-xs text-muted-foreground">불러오는 중…</p>}
            {preview.state === 'ok' && (
              <div
                ref={box}
                role="region"
                aria-label={`${refText(ref!)} 미리보기`}
                tabIndex={0}
                data-code-preview=""
                className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-background font-mono text-[11px] leading-[1.6]"
              >
                <div className="w-max min-w-full py-1">
                  {preview.win.lines.map((text, i) => {
                    const n = preview.win.start + i;
                    const on = n >= ref!.start && n <= end;
                    return (
                      <div key={n} ref={n === ref!.start ? first : undefined} data-hl={on ? '' : undefined} className={`flex whitespace-pre ${on ? 'bg-blue-500/15' : ''}`}>
                        <span aria-hidden="true" className={`w-12 shrink-0 select-none pr-3 text-right ${on ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {n}
                        </span>
                        <span className="pr-3">{text || ' '}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">연결된 코드 위치가 없어요</p>
      )}
      {orphans > 0 && onCleanOrphans && (
        <div className="flex items-center gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
          <span>이름이 바뀌어 연결이 끊긴 코드가 {orphans}개 있어요</span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={onCleanOrphans}>
            연결 안 된 코드 정리
          </Button>
        </div>
      )}
    </aside>
  );
}
