// 설정 > 일반 (#624): the theme and browser notifications (this browser only, work with Dispatch off) and the answer
// style switch (a team setting, saved through POST /api/settings `team`; read-only with Dispatch off, #620).
import { useId, useState } from 'react';
import { api } from '../../dispatch/store';
import { turnAlertsOff, turnAlertsOn, useAlertStatus } from '../../dispatch/lib/notify';
import { useDispatch } from '../../dispatch/store';
import { cn } from '../../lib/utils';
import { useSettingsLoad } from '../context';
import { LoadNote, OffNote, ThemeField } from '../DispatchOff';
import { SectionFrame } from '../SectionFrame';
import { TEAM_TOGGLES } from '../model';

const REPLY = TEAM_TOGGLES.find((f) => f.id === 'replyStyle')!;
const ALERT_NOTE = {
  unsupported: '이 브라우저는 알림을 지원하지 않아요.',
  denied: '브라우저에서 알림을 막아 두었어요. 브라우저 사이트 설정에서 허용해 주세요.',
  off: '',
  on: '',
} as const;

export default function GeneralSection() {
  const { load, retry } = useSettingsLoad();
  const alerts = useAlertStatus();
  const alertsHint = useId();
  const replyHint = useId();
  const offId = useId();
  const saved = useDispatch((s) => s.settings.team.replyStyle) !== false;
  const [pending, setPending] = useState<boolean | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: '' });
  const off = load.kind === 'off';
  const ready = load.kind === 'ok';
  const reply = pending ?? saved;

  // Saved at once, like the theme: one switch needs no 저장 button.
  const setReply = async (v: boolean) => {
    setPending(v);
    setNote({ text: '' });
    try {
      await api('POST', '/api/settings', { team: { replyStyle: v } });
      setNote({ text: '저장했어요.' });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : '저장하지 못했어요.', bad: true });
    } finally {
      setPending(null);
    }
  };

  return (
    <SectionFrame title="일반" hint="화면 테마와 알림은 이 브라우저에만 저장돼요." testId="settings-section-general">
      <ThemeField />
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">브라우저 알림</h4>
        <div className="flex items-start gap-2">
          <input
            id="settings-alerts"
            type="checkbox"
            {...({ switch: '' } as object)}
            aria-describedby={alertsHint}
            checked={alerts === 'on'}
            disabled={alerts === 'unsupported' || alerts === 'denied'}
            onChange={(e) => void (e.target.checked ? turnAlertsOn() : turnAlertsOff())}
            className="mt-0.5 size-4 shrink-0 accent-primary max-md:size-5"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <label htmlFor="settings-alerts" className="text-sm">
              세션 알림 받기
            </label>
            <span id={alertsHint} className="text-xs text-muted-foreground">
              {ALERT_NOTE[alerts] || '세션이 답을 기다리거나 멈추거나 한도에 닿으면 알려 줘요. 세션 화면을 열어 둔 동안만 울려요.'}
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">답변 스타일</h4>
        <LoadNote load={load} onRetry={retry} />
        {off && <OffNote id={offId} status={load.status} />}
        <div className={cn('flex items-start gap-2', !ready && 'opacity-60')}>
          <input
            id="settings-reply-style"
            type="checkbox"
            {...({ switch: '' } as object)}
            aria-describedby={off ? `${replyHint} ${offId}` : replyHint}
            checked={reply}
            disabled={!ready || pending !== null}
            onChange={(e) => void setReply(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-primary max-md:size-5"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <label htmlFor="settings-reply-style" className="text-sm">
              {REPLY.label}
            </label>
            <span id={replyHint} className="text-xs text-muted-foreground">
              {REPLY.hint}
            </span>
          </div>
        </div>
        <p role="status" className={cn('min-h-4 text-xs', note.bad ? 'text-destructive' : 'text-muted-foreground')}>
          {note.text}
        </p>
      </div>
    </SectionFrame>
  );
}
