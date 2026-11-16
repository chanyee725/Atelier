// Provider id → icon (E531, #621): the one map every view reads, through <ProviderIcon> (ProviderIcon.tsx). A new
// provider gets its icon here once. All three come from react-icons' Remix set (one set), imported per icon so the
// bundle only carries these; Vite bundles them, nothing is fetched at run time. Other UI icons stay lucide.
import type { IconType } from 'react-icons';
import { RiClaudeFill, RiGeminiFill, RiOpenaiFill } from 'react-icons/ri';

/** Provider id (the server's /api/providers/<id>) → its icon. */
export const PROVIDER_ICONS: Readonly<Record<string, IconType>> = {
  claude: RiClaudeFill,
  openai: RiOpenaiFill,
  gemini: RiGeminiFill,
};

/** The icon for a provider id, or null for one without a mark (it then shows its name only). */
export const providerIcon = (id: string | null | undefined): IconType | null =>
  id && Object.hasOwn(PROVIDER_ICONS, id) ? PROVIDER_ICONS[id] : null;
