// Which component fills each section of the 설정 modal (#624). Sections take no props: they read the shared load
// state through useSettingsLoad() (context.ts) and their values from the session stream store.
import type { ComponentType } from 'react';
import { SectionPending } from './SectionFrame';
import GeneralSection from './sections/GeneralSection';
import type { SectionId } from './model';

const pending = (title: string): ComponentType => () => <SectionPending title={title} />;

export const SECTION_COMPONENTS: Record<SectionId, ComponentType> = {
  general: GeneralSection,
  providers: pending('모델 연결'),
  roles: pending('역할별 모델'),
  team: pending('관리자와 팀'),
  limits: pending('사용 한도'),
  folders: pending('작업 폴더'),
  stuck: pending('멈춤 감지'),
};
