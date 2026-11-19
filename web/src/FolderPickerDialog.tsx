// 새 프로젝트 (E554): browse the folders of the PC that runs the server (not the browser's own file picker, since the
// app is often opened from another device) and open the folder shown as a project: the server adds it to its folder
// list and switches to it. Or make a blank project (a top-level folder of the open one) by name.
// Server: GET /api/local-folders, POST /api/workspaces (docs/design/local-folder-projects.md).
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, CornerLeftUp, Folder, House } from 'lucide-react';
import { api, ApiError, type LocalFolders } from './api';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';

type Props = {
  onClose: () => void;
  /** The server now runs in the picked folder: reload the app. */
  onOpened: () => void;
  /** 빈 프로젝트: make a plain project named `name`; resolves to an error message, or null once it is made. */
  onCreateBlank: (name: string) => Promise<string | null>;
};

// Server messages are English; show Korean copy by status and code, never the raw message.
const listError = (e: unknown) => {
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 404) return '폴더를 찾을 수 없어요';
  if (status === 403) return '이 폴더는 열어 볼 권한이 없어요';
  if (status === 400) return '폴더가 아니에요';
  return '폴더 목록을 불러오지 못했어요';
};
/** Korean copy for a refused folder switch (POST /api/workspaces and /open), by `code`. */
export const workspaceError = (e: unknown) => {
  const code = e instanceof ApiError ? e.code : undefined;
  if (code === 'sessions_running') return '실행 중인 에이전트 세션이 있어요. 세션이 끝난 뒤에 폴더를 바꿀 수 있어요';
  if (code === 'in_use') return '다른 Drawing 서버가 이 폴더를 열고 있어요';
  if (code === 'home_folder') return '홈 폴더 자체는 열 수 없어요. 안의 폴더를 골라 주세요';
  if (code === 'filesystem_root') return '최상위 폴더는 열 수 없어요';
  if (code === 'defaults_broken') return '~/.dispatch/drawing.json 파일을 읽지 못해서 저장할 수 없어요';
  if (code === 'not_found') return '폴더를 찾을 수 없어요';
  if (code === 'no_permission') return '이 폴더는 열 권한이 없어요';
  if (code === 'project_mode') return '이 화면에서는 폴더를 바꿀 수 없어요';
  return '폴더를 열지 못했어요';
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

export function FolderPickerDialog({ onClose, onOpened, onCreateBlank }: Props) {
  const [blank, setBlank] = useState(false);
  const nameId = useId();
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
      await api.addWorkspace(dir.path);
      onOpened();
    } catch (e) {
      setMessage(workspaceError(e));
      setBusy(false);
    }
  };

  const createBlank = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const name = String(new FormData(e.currentTarget).get('name') ?? '');
    setBusy(true);
    setMessage(null);
    const problem = await onCreateBlank(name);
    if (problem) {
      setMessage(problem);
      setBusy(false);
    }
  };
  const switchTo = (toBlank: boolean) => {
    setBlank(toBlank);
    setMessage(null);
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
          {blank ? '지금 연 폴더 안에 이름만 정해서 프로젝트를 만들어요.' : '서버 PC의 폴더를 골라 열어요. 문서와 기록은 그 폴더에 저장되고, 에이전트 세션도 그 폴더의 git 프로젝트에서 실행돼요.'}
        </DialogDescription>
        {blank ? (
          <form onSubmit={(e) => void createBlank(e)} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-2 px-(--overlay-x) py-4">
              <label htmlFor={nameId} className="text-sm font-medium">
                프로젝트 이름
              </label>
              <Input id={nameId} name="name" required maxLength={80} autoComplete="off" autoFocus disabled={busy} aria-invalid={message ? true : undefined} />
              {message && (
                <p role="alert" className="m-0 text-sm text-destructive">
                  {message}
                </p>
              )}
            </div>
            <DialogFooter className="max-sm:flex-col max-sm:items-stretch">
              <Button type="button" variant="ghost" className="mr-auto" onClick={() => switchTo(false)} disabled={busy}>
                폴더 고르기
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? '만드는 중이에요…' : '만들기'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
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
                {dir ? <>열 폴더: <span className="font-medium text-foreground">{baseName(dir)}</span></> : ' '}
              </p>
              <Button variant="outline" onClick={() => switchTo(true)} disabled={busy}>
                빈 프로젝트
              </Button>
              <Button onClick={() => void pick()} disabled={!dir || loading || busy || !dir.parent || dir.path === dir.home}>
                {busy ? '여는 중이에요…' : '이 폴더 열기'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
