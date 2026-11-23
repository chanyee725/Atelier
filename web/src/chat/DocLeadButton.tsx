// The document screen's 관리자와 대화 button (#1057), top right: opens the chat dock on the document's lead
// (GET /api/file/lead, read again on each press) with the document pinned, or on the helper when it has no live lead.
// The badge counts the document's open questions. Hidden where agent sessions are off (no Dispatch).
import { useEffect, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { api } from '../dispatch/store';
import { Button } from '../components/ui/button';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import { badgeText } from './lib/chatDock.ts';
import { askAboutDoc, docButtonLabel, docLeadLine, type DocLead } from './lib/askDoc.ts';

type LeadAnswer = { lead: DocLead | null; dispatch?: false };

export function DocLeadButton({ path, title, open, narrow }: { path: string; title: string; open: number; narrow?: boolean }) {
  const [lead, setLead] = useState<DocLead | null | undefined>(undefined);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    setLead(undefined);
    api<LeadAnswer>('GET', `/api/file/lead?path=${encodeURIComponent(path)}`, undefined, ctl.signal).then(
      (r) => {
        setOff(r.dispatch === false);
        setLead(r.lead);
      },
      () => {},
    );
    return () => ctl.abort();
  }, [path]);
  if (off) return null;

  const press = async () => {
    if (busy) return;
    setBusy(true);
    let now: DocLead | null = lead ?? null;
    try {
      now = (await api<LeadAnswer>('GET', `/api/file/lead?path=${encodeURIComponent(path)}`)).lead;
      setLead(now);
    } catch {
      // Not blocked: the helper takes the talk.
    } finally {
      setBusy(false);
    }
    askAboutDoc({ path, title, open, lead: now });
  };

  const badge = badgeText(open);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={docButtonLabel(open)}
      title={lead === undefined ? '관리자와 대화' : docLeadLine(lead)}
      aria-busy={busy || undefined}
      data-doc-lead-button
      className={cn('relative gap-1.5 text-muted-foreground hover:text-foreground', narrow && 'min-h-11 min-w-11 px-2', FOCUS_RING)}
      onClick={() => void press()}
    >
      <MessagesSquare aria-hidden />
      <span className={cn(narrow && 'sr-only')}>관리자와 대화</span>
      {badge && (
        <span aria-hidden data-doc-lead-badge className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/8 px-1 text-2xs font-semibold tabular-nums text-foreground">
          {badge}
        </span>
      )}
    </Button>
  );
}
