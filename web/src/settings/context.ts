import { createContext, useContext } from 'react';
import type { SettingsLoad } from './model';

/** Window event fired after a model connect, cancel or disconnect, so the sidebar rows reload at once. */
export const MODELS_CHANGED = 'drawing:models-changed';

/**
 * What the 설정 modal knows about the session settings, for the prop-less section components (#624): `load` says
 * whether they are in, off (with the reason) or failed, and `retry` reconnects the session stream after a failure.
 */
export type SettingsCtx = { load: SettingsLoad; retry: () => void };
export const SettingsContext = createContext<SettingsCtx>({ load: { kind: 'loading' }, retry: () => {} });
export const useSettingsLoad = () => useContext(SettingsContext);
