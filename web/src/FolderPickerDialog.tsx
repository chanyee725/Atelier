// 새 프로젝트 (E554): browse the folders of the PC that runs the server (not the browser's own file picker, since the
// app is often opened from another device) and link the folder shown as a project.
// Server: GET /api/local-folders, POST /api/workspace/local-project (docs/design/local-folder-projects.md).
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, CornerLeftUp, Folder, House } from 'lucide-react';
import { api, ApiError, type LocalFolders } from './api';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';

type Props = {
  onClose: () => void;
  /** The folder is now a project: `path` is its workspace project path. */
  onLinked: (path: string) => void;
};

// Server messages are English; show Korean copy by status, never the raw message.
const listError = (e: unknown) => {
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 404) return '폴더를 찾을 수 없어요';
  if (status === 403) return '이 폴더는 열어 볼 권한이 없어요';
  if (status === 400) return '폴더가 아니에요';
  return '폴더 목록을 불러오지 못했어요';
};
const linkError = (e: unknown) => {
  const status = e instanceof ApiError ? e.status : 0;
  const msg = e instanceof Error ? e.message : '';
  if (status === 409) return '이미 프로젝트로 추가한 폴더예요';
  if (/workspace/.test(msg)) return '작업 폴더 안의 폴더는 추가할 수 없어요';
  if (/root/.test(msg)) return '최상위 폴더는 추가할 수 없어요';
  if (status === 403) return '프로젝트를 추가하지 못했어요. 권한을 확인해 주세요';
  return '프로젝트를 추가하지 못했어요';
};

/** Breadcrumb steps for an absolute path: [{ label, path }] from the root down. */
export function crumbs(path: string, root: string, sep: string): { label: string; path: string }[] {
  const out = [{ label: root === '/' ? '/' : root.replace(/[\\/]+$/, ''), path: root }];
  let cur = root;
  for (const part of path.slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    cur = cur.endsWith(sep) ? cur + part : cur + sep + part;
    out.push({ label: part, path: cur });
  }
  return out;
}

const childPath = (dir: LocalFolders, name: string) => (dir.path.endsWith(dir.sep) ? dir.path + name : dir.path + dir.sep + name);
const baseName = (dir: LocalFolders) => crumbs(dir.path, dir.root, dir.sep).pop()?.label ?? dir.path;

export function FolderPickerDialog({ onClose, onLinked }: Props) {
  const [dir, setDir] = useState<LocalFolders | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const seq = useRef(0);
  const titleId = useId();
  const noteId = useId();

  const go = async (path?: string) => {
    const n = ++seq.current;
    setLoading(true);
    setMessage(null);
    try {
      const next = await api.localFolders(path);
      if (n !== seq.current) return; // a newer click won
      setDir(next);
      listRef.current?.scrollTo({ top: 0 });
    } catch (e) {
      if (n === seq.current) setMessage(listError(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  };
  useEffect(() => {
    void go();
  }, []);

  const pick = async () => {
    if (!dir || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.linkLocalFolder(dir.path);
      onLinked(r.path);
    } catch (e) {
      setMessage(linkError(e));
      setBusy(false);
    }
  };

  const trail = dir ? crumbs(dir.path, dir.root, dir.sep) : [];
  const hint = 'px-4 py-2 text-sm text-muted-foreground';
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent aria-labelledby={titleId} aria-describedby={noteId} className="h-[min(36rem,calc(100%-2rem))] w-[min(40rem,calc(100%-2rem))] max-w-none">
        <DialogHeader>
          <DialogTitle id={titleId} className="mr-auto">
            새 프로젝트
          </DialogTitle>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            닫기
          </Button>
        </DialogHeader>
        <DialogDescription id={noteId} className="px-(--overlay-x) pt-2">
          서버 PC의 폴더를 골라 프로젝트로 추가해요. 폴더 안의 파일은 바꾸지 않아요.
        </DialogDescription>
        <div className="flex items-center gap-1 px-(--overlay-x) py-2">
          <Button variant="ghost" size="sm" disabled={!dir?.parent || loading} onClick={() => dir?.parent && void go(dir.parent)} aria-label="위 폴더로 가기" title="위 폴더로 가기">
            <CornerLeftUp aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" disabled={!dir || loading || dir.path === dir.home} onClick={() => dir && void go(dir.home)} aria-label="홈 폴더로 가기" title="홈 폴더로 가기">
            <House aria-hidden />
          </Button>
          <nav aria-label="폴더 경로" className="min-w-0 flex-1">
            <ol className="m-0 flex list-none flex-wrap items-center gap-x-0.5 p-0 text-sm">
              {trail.map((c, i) => {
                const last = i === trail.length - 1;
                return (
                  <li key={c.path} className="flex min-w-0 items-center gap-0.5">
                    {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
                    <button
                      type="button"
                      aria-current={last ? 'location' : undefined}
                      disabled={loading}
                      onClick={() => !last && void go(c.path)}
                      className={`max-w-[12rem] truncate rounded px-1.5 py-0.5 underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring ${last ? 'font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground hover:underline'}`}
                      title={c.path}
                    >
                      {c.label}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
        {message && (
          <p role="alert" className="bg-muted px-(--overlay-x) py-2 text-sm">
            {message}
          </p>
        )}
        <ul ref={listRef} aria-label="하위 폴더" aria-busy={loading} className="min-h-0 flex-1 overflow-auto overscroll-contain border-t px-1.5 pt-1.5 pb-(--menu-end)">
          {!dir && loading && <li className={hint}>불러오는 중이에요…</li>}
          {dir?.folders.length === 0 && <li className={hint}>하위 폴더가 없어요</li>}
          {dir?.folders.map((name) => (
            <li key={name}>
              <button
                type="button"
                disabled={loading || busy}
                onClick={() => void go(childPath(dir, name))}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 max-sm:py-2.5"
              >
                <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
          {dir?.truncated && <li className={hint}>폴더가 너무 많아서 앞쪽 {dir.folders.length}개만 보여요</li>}
        </ul>
        <DialogFooter className="max-sm:flex-col max-sm:items-stretch">
          <p className="m-0 mr-auto min-w-0 truncate text-sm text-muted-foreground" title={dir?.path}>
            {dir ? <>추가할 폴더: <span className="font-medium text-foreground">{baseName(dir)}</span></> : ' '}
          </p>
          <Button onClick={() => void pick()} disabled={!dir || loading || busy || !dir.parent}>
            {busy ? '추가하는 중이에요…' : '이 폴더 선택'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
