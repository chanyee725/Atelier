// The sidebar's 테마 row: a small menu with 라이트, 다크, 시스템 (the only setting left). Radix's radio menu gives
// roving arrow keys, Esc and focus return; the chosen item also shows a check, so it is not colour alone.
import { Check, Palette } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { SidebarMenuButton } from './components/ui/sidebar';
import { useMenuState } from './lib/menuEscape';
import type { ThemePref } from './theme';

export const THEME_CHOICES: { id: ThemePref; label: string }[] = [
  { id: 'light', label: '라이트' },
  { id: 'dark', label: '다크' },
  { id: 'system', label: '시스템' },
];

export function ThemeMenu({ pref, onPref }: { pref: ThemePref; onPref: (t: ThemePref) => void }) {
  const menu = useMenuState();
  return (
    <DropdownMenu {...menu}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton data-testid="theme-trigger" aria-label="테마" title="테마 바꾸기">
          <Palette aria-hidden />
          <span className="truncate">테마</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{THEME_CHOICES.find((t) => t.id === pref)?.label}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-36" aria-label="테마">
        <DropdownMenuRadioGroup value={pref} onValueChange={(v) => onPref(v as ThemePref)}>
          {THEME_CHOICES.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.id} className="justify-between max-md:min-h-11">
              {t.label}
              <Check aria-hidden className="size-4 opacity-0 in-data-[state=checked]:opacity-100" />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
