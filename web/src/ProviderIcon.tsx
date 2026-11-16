// A provider's mark (E531, #621), for every place that names a provider: sidebar rows, the 모델 연결 dialog, model
// pickers, model tags and usage rows. The id → icon map is providerIcons.ts.
// Decorative: aria-hidden, the provider's name stays in the text or the accessible name beside it. Inline SVG filled
// with currentColor, so it follows the text token in light, dark, monitoring and forced-colors.
import { cn } from './lib/utils';
import { providerIcon } from './providerIcons';

export { PROVIDER_ICONS, providerIcon } from './providerIcons';

/** Sized by `className` (default 1em, following the text it sits in). Renders nothing for an unknown id. */
export function ProviderIcon({ provider, className }: { provider: string | null | undefined; className?: string }) {
  const Icon = providerIcon(provider);
  if (!Icon) return null;
  return <Icon aria-hidden focusable="false" data-provider-icon={provider} className={cn('size-[1em] shrink-0', className)} />;
}
