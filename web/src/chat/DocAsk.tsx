// The chat dock's document card (#1057), pinned at the top while the person talks about a document with its lead:
// the title and path, the open-question count, and who takes the talk. With no lead the helper takes it, and the
// card offers the live leads to assign (POST /api/file/lead); 배정 switches the talk to that lead.
// Metadata only: path, title, a count and session names.
import { useId, useState } from 'react';
import { FileText } from 'lucide-react';
import type { Session } from '../../../shared/dispatch/types.ts';
import { Button } from '../components/ui/button';
import { NativeSelect } from '../components/ui/native-select';
import { liveLeads } from '../home/issueStart';
import { docLeadLine, type DocRequest } from './lib/askDoc';

type Props = {
  doc: DocRequest;
  sessions: readonly Session[];
  /** Ids that are not a document lead (the helper). */
  exclude: string | null;
  onAssign: (leadId: string) => Promise<void>;
};

export function DocCard({ doc, sessions, exclude, onAssign }: Props) {
  const uid = useId();
  const leads = liveLeads(sessions).filter((s) => s.id !== exclude);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = leads.some((s) => s.id === pick) ? pick : (leads[0]?.id ?? '');
  const assign = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    try {
      await onAssign(chosen);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={`문서 ${doc.title || doc.path}`} data-chat-doc={doc.path} className="grid gap-1 border-b bg-muted/30 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={doc.path}>{doc.title || '제목 없는 문서'}</span>
        {doc.open > 0 && (
          <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-foreground/6 px-2 text-2xs text-muted-foreground tabular-nums">열린 질문 {doc.open}개</span>
        )}
      </div>
      <p className="m-0 truncate font-mono text-2xs text-muted-foreground" title={doc.path}>{doc.path}</p>
      <p data-chat-doc-lead className="m-0 text-xs text-muted-foreground">{docLeadLine(doc.lead)}</p>
      {!doc.lead && leads.length > 0 && (
        <div className="mt-1 flex items-center gap-2">
          <label htmlFor={`${uid}-lead`} className="shrink-0 text-xs text-muted-foreground">맡길 관리자</label>
          <NativeSelect id={`${uid}-lead`} value={chosen} onChange={(e) => setPick(e.target.value)} disabled={busy} className="min-w-0 flex-1" data-chat-doc-pick>
            {leads.map((s) => (
              <option key={s.id} value={s.id}>{`${s.name} · ${s.modelLabel}`}</option>
            ))}
          </NativeSelect>
          <Button size="sm" variant="outline" disabled={busy || !chosen} onClick={() => void assign()} data-chat-doc-assign>
            {busy ? '배정하는 중…' : '배정'}
          </Button>
        </div>
      )}
    </section>
  );
}
