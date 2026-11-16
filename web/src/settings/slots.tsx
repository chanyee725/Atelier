// Which component fills each section of the 설정 modal (#624). Sections take no props: they read the shared load
// state through useSettingsLoad() (context.ts) and their values from the session stream store.
import type { ComponentType } from 'react';
import GeneralSection from './sections/GeneralSection';
import { SectionFrame } from './sections/shared';
import StallSection from './sections/StallSection';
import TeamSection from './sections/TeamSection';
import UsageLimitsSection from './sections/UsageLimitsSection';
import WorkspaceSection from './sections/WorkspaceSection';
import type { SectionId } from './model';

/** A placeholder for a section another change fills in. */
const pending =
  (title: string): ComponentType =>
  () => (
    <SectionFrame title={title} testId="settings-section-pending">
      {() => <p className="text-sm text-muted-foreground">준비 중이에요.</p>}
    </SectionFrame>
  );

export const SECTION_COMPONENTS: Record<SectionId, ComponentType> = {
  general: GeneralSection,
  providers: pending('모델 연결'),
  roles: pending('역할별 모델'),
  team: TeamSection,
  limits: UsageLimitsSection,
  folders: WorkspaceSection,
  stuck: StallSection,
};
