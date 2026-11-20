// 최근 page (#889, Lists.dc.html): every document newest edit first with a kind filter, and next to it the files in
// the 보관함 (recently deleted, kept 30 days). Restoring stays in TrashDialog; this card only lists and opens it.
import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, type ProjectsResponse, type TrashItem } from '../api';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/PageHeader';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
import { whenLabel } from '../lib/when';
import { locationOf } from './model';
import { FILTERS, KIND_LABEL, filterRecent, recentRows, type RecentFilter } from './recentModel';
import './recent.css';

type Props = {
  data: ProjectsResponse;
  /** Bumps when the workspace changed: the 보관함 list refetches. */
  version: unknown;
  narrow?: boolean;
  bell?: React.ReactNode;
  onOpen: (path: string) => void;
  onNewDoc: () => void;
  /** Opens the 보관함 dialog (restore lives there). */
  onArchive?: () => void;
};

const fileLabel = (path: string) => path.replace(/\.dpx\.json$/, '');

function When({ at }: { at: number }) {
  if (!at) return <span className="recent-when">—</span>;
  return (
    <time className="recent-when" dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString('ko-KR')}>
      {whenLabel(at)}
    </time>
  );
}

function useTrash(version: unknown) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  useEffect(() => {
    let live = true;
    api
      .trash()
      .then((t) => live && setItems([...t].sort((a, b) => b.deletedAt - a.deletedAt)))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [version]);
  return items;
}

export function RecentPage({ data, version, narrow, bell, onOpen, onNewDoc, onArchive }: Props) {
  const [filter, setFilter] = useState<RecentFilter>('all');
  const all = useMemo(() => recentRows(data.projects, data.unfiled), [data]);
  const rows = filterRecent(all, filter);
  const trash = useTrash(version);
  return (
    <div className="recent-page" data-screen="recent">
      <PageHeader
        title="최근과 보관함"
        narrow={narrow}
        bell={bell}
        actions={
          <Button variant="outline" size="sm" className="recent-btn" onClick={onNewDoc}>
            <Plus /> 새 문서
          </Button>
        }
      />
      <div className="recent-body">
        <section className="recent-card recent-main" aria-labelledby="recent-title">
          <div className="recent-card-head">
            <h2 id="recent-title">최근</h2>
            <span className="recent-count">{all.length}</span>
            {all.length > 0 && (
              <ToggleGroup aria-label="종류" value={filter} onValueChange={(v) => setFilter(v as RecentFilter)} className="recent-filter">
                {FILTERS.map((f) => (
                  <ToggleGroupItem key={f.id} value={f.id} size="sm">
                    {f.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </div>
          {all.length === 0 ? (
            <div className="recent-empty">
              <EmptyMark />
              <p className="recent-empty-title">아직 문서가 없어요</p>
              <p className="recent-empty-text">새 문서를 만들면 고친 순서대로 여기에 모여요.</p>
              <Button variant="outline" size="sm" className="recent-btn" onClick={onNewDoc}>
                새 문서 만들기
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="recent-none">이 종류의 문서가 없어요.</p>
          ) : (
            <ul className="recent-list" aria-labelledby="recent-title">
              {rows.map((r) => (
                <li key={r.path}>
                  <button type="button" className="recent-row" onClick={() => onOpen(r.path)}>
                    <span className="recent-title">{r.title}</span>
                    <span className="recent-cell">
                      <span className="recent-kind">{KIND_LABEL[r.kind]}</span>
                    </span>
                    <span className="recent-place">{locationOf(r)}</span>
                    <When at={r.modifiedAt} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {all.length > 0 && <p className="recent-foot">일주일이 지난 항목은 날짜로 보여요.</p>}
        </section>

        <section className="recent-card recent-side" aria-labelledby="archive-title">
          <div className="recent-card-head">
            <h2 id="archive-title">보관함</h2>
            <span className="recent-count">{trash?.length ?? ''}</span>
            {onArchive && !!trash?.length && (
              <Button variant="ghost" size="sm" className="recent-btn ml-auto" onClick={onArchive}>
                되살리기
              </Button>
            )}
          </div>
          {trash === null ? (
            <p className="recent-none">불러오는 중이에요</p>
          ) : trash.length === 0 ? (
            <div className="recent-empty">
              <EmptyMark />
              <p className="recent-empty-title">보관한 문서가 없어요</p>
              <p className="recent-empty-text">지운 문서는 30일 동안 여기에 남아요. 그동안 언제든 되살릴 수 있어요.</p>
            </div>
          ) : (
            <ul className="recent-list" aria-labelledby="archive-title">
              {trash.map((t) => (
                <li key={t.id} className="recent-trash-row">
                  <span className="recent-title">{fileLabel(t.path)}</span>
                  <When at={t.deletedAt} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** A quiet archive-box outline drawn in the line colour. */
const EmptyMark = () => (
  <svg aria-hidden="true" width="56" height="48" viewBox="0 0 56 48" fill="none" className="recent-empty-mark">
    <path d="M4 6h48v10H4zM8 16v26h40V16M22 26h12" />
  </svg>
);
