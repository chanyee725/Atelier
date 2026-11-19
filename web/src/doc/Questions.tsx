// In-document questions (#738): what agents asked the user in this document, answered in place. Open questions are
// cards at the top of the document (the screen's one accent: a blocked-colour edge, as their pipeline step is blocked
// while they wait); answered ones fold into a quiet list ("답변됨 · 세션 이름/사용자"). An answer is a picked choice or
// typed text, sent to the asking session by the server. Questions show at document level: an anchor (block, text
// range, diagram node) is named on the card, not highlighted in the text yet.
import { useId, useState, type KeyboardEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { api, type Discussion, type Plan } from '../api';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
import type { FileSession } from '../fileSession';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import { useSession } from '../useSession';
import { anchorLabel, answeredLine, answerOf, questionLists, stepLine, whoLabel } from './questionsModel';

/** The section's id: the agent area's question badge scrolls here. */
export const QUESTIONS_ID = 'doc-questions';

type Props = { session: FileSession };

export function Questions({ session }: Props) {
  const path = useSession(session, (s) => s.path ?? '');
  const discussions = useSession(session, (s) => s.file?.discussions);
  const plan = useSession(session, (s) => s.file?.plan);
  const { open, answered } = questionLists(discussions);
  const [showAnswered, setShowAnswered] = useState(false);
  const [note, setNote] = useState('');
  const headId = useId();
  const answeredId = useId();
  if (!open.length && !answered.length) return null;

  const send = async (q: Discussion, answer: { choice: number } | { text: string }) => {
    // Unsaved edits go first: the answer raises the file's revision.
    await session.flush();
    const r = await api.answerQuestion(path, q.id, answer);
    session.questionAnswered(path, r.item);
    setNote(r.delivered ? `${whoLabel(r.item.askedBy)}에게 답을 보냈어요.` : '세션이 지금은 받지 못해서 답을 문서에 남겨 뒀어요.');
  };

  return (
    <section id={QUESTIONS_ID} data-doc-questions="" aria-labelledby={headId} className="mx-auto w-full max-w-3xl scroll-mt-4 px-6 pt-6">
      <h2 id={headId} className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold text-muted-foreground">
        {open.length ? (
          <>
            답을 기다리는 질문 <span className="num tabular-nums text-foreground">{open.length}</span>
          </>
        ) : (
          '질문'
        )}
      </h2>
      {open.length > 0 && (
        <ol className="flex flex-col gap-2">
          {open.map((q) => (
            <li key={q.id}>
              <QuestionCard q={q} plan={plan} onSend={send} />
            </li>
          ))}
        </ol>
      )}
      <p role="status" className="min-h-0 px-1 pt-1 text-xs text-muted-foreground empty:hidden">
        {note}
      </p>
      {answered.length > 0 && (
        <div className="mt-1">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showAnswered}
            aria-controls={answeredId}
            onClick={() => setShowAnswered((v) => !v)}
            className={cn('text-muted-foreground', FOCUS_RING)}
          >
            <ChevronRight className={cn('transition-transform', showAnswered && 'rotate-90')} aria-hidden />
            답한 질문 <span className="num tabular-nums">{answered.length}</span>
          </Button>
          <ul id={answeredId} hidden={!showAnswered} className="mt-1 flex flex-col divide-y rounded-md border">
            {answered.map((q) => (
              <AnsweredRow key={q.id} q={q} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Meta({ q, plan }: { q: Discussion; plan?: Plan }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{whoLabel(q.askedBy)}</span>
      <span aria-hidden>·</span>
      <span>{anchorLabel(q.anchor)}</span>
      {q.step && q.status === 'open' && (
        <>
          <span aria-hidden>·</span>
          <span>{stepLine(q.step, plan)}</span>
        </>
      )}
    </p>
  );
}

function QuestionCard({ q, plan, onSend }: { q: Discussion; plan: Plan | undefined; onSend: (q: Discussion, a: { choice: number } | { text: string }) => Promise<void> }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const textId = useId();
  const answer = answerOf(q, choice, text);
  const submit = async () => {
    if (!answer || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSend(q, answer);
    } catch (e) {
      setError(e instanceof Error && e.message ? `답을 보내지 못했어요: ${e.message}` : '답을 보내지 못했어요.');
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };
  return (
    <article
      data-question={q.id}
      aria-label={`${whoLabel(q.askedBy)}의 질문`}
      className="rounded-md border border-l-2 border-l-[var(--step-blocked)] bg-card px-4 py-3 text-card-foreground"
    >
      <Meta q={q} plan={plan} />
      <p className="mt-1 text-sm leading-6 whitespace-pre-wrap">{q.question}</p>
      {q.choices && q.choices.length > 0 && (
        <ToggleGroup
          variant="outline"
          size="sm"
          aria-label="선택지"
          value={choice === null ? '' : String(choice)}
          onValueChange={(v) => {
            setChoice(Number(v));
            setText('');
          }}
          disabled={busy}
          className="mt-2 w-full flex-col items-stretch gap-1"
        >
          {q.choices.map((c, i) => (
            <ToggleGroupItem
              key={i}
              value={String(i)}
              className={cn('h-auto min-h-8 justify-start py-1.5 text-left font-normal whitespace-normal aria-pressed:border-foreground/40 aria-pressed:bg-accent max-md:min-h-11', FOCUS_RING)}
            >
              {c}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <label htmlFor={textId} className="sr-only">
        직접 답 쓰기
      </label>
      <Textarea
        id={textId}
        value={text}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value) setChoice(null);
        }}
        onKeyDown={onKey}
        placeholder={q.choices?.length ? '또는 직접 써 주세요' : '답을 써 주세요'}
        className="mt-2 min-h-10 resize-none"
        rows={1}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {error && (
          <p role="alert" className="mr-auto text-xs text-destructive">
            {error}
          </p>
        )}
        <Button size="sm" onClick={() => void submit()} disabled={!answer || busy} className={cn('max-md:min-h-11', FOCUS_RING)}>
          {busy ? '보내는 중이에요…' : '답하기'}
        </Button>
      </div>
    </article>
  );
}

function AnsweredRow({ q }: { q: Discussion }) {
  return (
    <li data-question={q.id} data-answered="" className="px-4 py-2.5">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground whitespace-pre-wrap">{q.question}</p>
        <span className="shrink-0 rounded-sm border px-1.5 text-[11px] leading-5 text-muted-foreground">{answeredLine(q)}</span>
      </div>
      <p className="mt-0.5 text-sm whitespace-pre-wrap">{q.answer}</p>
      <div className="mt-0.5">
        <Meta q={q} />
      </div>
    </li>
  );
}
