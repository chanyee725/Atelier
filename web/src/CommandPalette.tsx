import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Command as CommandPrimitive } from 'cmdk';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandShortcut } from './components/ui/command';
import { DialogContent } from './components/ui/dialog';
import { Kbd } from './components/ui/kbd';
import { FolderClosed, X } from 'lucide-react';
import { cn } from './lib/utils';
import { filterCommands, groupCommands, type Command as Cmd } from './commands';

export { filterCommands } from './commands';
export type { Command } from './commands';

type Props = {
  commands: Cmd[];
  onClose: () => void;
  /** Project the user is in: its name is shown as a chip, and its files (under its path) are listed first. */
  scope?: { path: string; name: string } | null;
  /** Start with only this section (G P opens the menu on projects). */
  onlyGroup?: Cmd['group'];
};

/** Documents of the current project shown before the user types. */
const SCOPE_DOCS = 6;
/** Documents shown before the user types when the menu opened on 문서 only (`/`, #793). */
const FILE_DOCS = 12;
/** The chip of a menu opened on one section: its label, and what the empty list says. */
const ONLY: Partial<Record<NonNullable<Cmd['group']>, { chip: string; placeholder: string; empty: string }>> = {
  project: { chip: '프로젝트만', placeholder: '프로젝트 이름을 입력해요', empty: '맞는 프로젝트가 없어요. 프로젝트만을 풀면 모든 명령에서 찾아요.' },
  file: { chip: '문서만', placeholder: '파일 이름을 입력해요', empty: '맞는 파일이 없어요. 문서만을 풀면 모든 명령에서 찾아요.' },
};

/** The Ctrl/Cmd+K menu: one search box over every registered command, in sections, keyboard first. */
export function CommandPalette({ commands, onClose, scope, onlyGroup }: Props) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(onlyGroup);
  const list = useMemo(() => {
    const inScope = (c: Cmd) => !!scope && !!c.hint?.startsWith(`${scope.path}/`);
    // With no search, the 문서 section lists the current project's documents (files are otherwise search-only).
    // Opened on 문서 only (`/`), it lists the first documents of the whole tree too, so the box is never blank.
    const files = group === 'file';
    const scoped = !query.trim() ? commands.filter((c) => c.searchOnly && (inScope(c) || (files && c.group === 'file'))).slice(0, files ? FILE_DOCS : SCOPE_DOCS) : [];
    const found = [...scoped, ...filterCommands(commands, query)].filter((c) => !group || c.group === group);
    // Files of the current project come first inside their section.
    return scope ? [...found.filter(inScope), ...found.filter((c) => !inScope(c))] : found;
  }, [commands, query, group, scope]);
  const groups = useMemo(() => groupCommands(list), [list]);
  // Sections reorder the list, so the first row on screen is the first enabled one in section order.
  const first = useMemo(() => groups.flatMap((g) => g.items).find((c) => !c.disabled)?.id ?? '', [groups]);
  const [selected, setSelected] = useState(first);
  // Only a new search resets the selection; the list itself is rebuilt on every app render.
  useEffect(() => setSelected(first), [query]);
  const input = useRef<HTMLInputElement>(null);
  const only = group ? ONLY[group] : undefined;

  // Focus returns to where it was before the menu opened (unless a command moves it itself).
  const opener = useRef<Element | null>(document.activeElement);
  // focus() alone puts the caret back at the document start in an editor, so keep the range too.
  const [saved] = useState<Range | null>(() => {
    const sel = window.getSelection();
    return sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  });
  useEffect(() => {
    const back = opener.current;
    return () => {
      // Skip when focus already moved on to something real (not the menu's own input or body).
      const now = document.activeElement;
      if (back instanceof HTMLElement && back.isConnected && (!now || now === document.body || now === input.current)) {
        back.focus();
        const sel = window.getSelection();
        if (saved && sel && saved.startContainer.isConnected && back.contains(saved.commonAncestorContainer)) {
          sel.removeAllRanges();
          sel.addRange(saved);
        }
      }
    };
  }, []);

  const run = (c: Cmd) => {
    if (c.disabled) return;
    onClose();
    // After the menu closes, so a canvas command sees the canvas focused again.
    setTimeout(c.run, 0);
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        // 600px at 14% from the top (#889 refresh); under 640px it docks to the top edge, full width.
        // A menu opened from the keyboard appears and goes at once: no fade or zoom on it or its backdrop (#889).
        overlayClassName="bg-black/50 data-[state=open]:animate-none data-[state=closed]:animate-none"
        className={cn(
          'top-[14%] w-[min(600px,calc(100%-2rem))] translate-y-0 bg-card text-card-foreground shadow-[0_0_0_1px_var(--border),0_24px_60px_rgb(0_0_0/0.22)]',
          'data-[state=open]:animate-none data-[state=closed]:animate-none',
          'max-sm:top-0 max-sm:w-full max-sm:rounded-t-none max-sm:border-x-0 max-sm:border-t-0 max-sm:pt-[env(safe-area-inset-top)]',
        )}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          input.current?.focus();
        }}
        // The unmount effect above restores focus and the editor selection; Radix would only restore focus.
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (e.isComposing) e.preventDefault();
        }}
      >
        <DialogPrimitive.Title className="sr-only">명령 팔레트</DialogPrimitive.Title>
        <Command shouldFilter={false} loop value={selected} onValueChange={setSelected} label="명령 찾기" className="rounded-none bg-transparent text-card-foreground">
          <div className="flex h-12 items-center gap-1.5 border-b pr-4 [&>div]:h-12 [&>div]:flex-1 [&>div]:gap-2.5 [&>div]:border-b-0 [&>div]:pl-4 [&>div>svg]:text-muted-foreground [&>div>svg]:opacity-100">
            <CommandInput
              ref={input}
              value={query}
              // G P keeps the menu on projects while typing; Backspace in an empty box widens it to everything.
              onValueChange={setQuery}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !query && group && !e.nativeEvent.isComposing) setGroup(undefined);
              }}
              placeholder={only?.placeholder ?? '명령이나 파일 이름을 입력해요'}
              className="h-12 text-[15px]"
            />
            {only && (
              // A real button, so keyboard and screen reader users can widen the search too (#216 review).
              <button
                type="button"
                data-slot="group-chip"
                aria-label={`${only.chip} 찾기 풀기`}
                title="눌러서 모든 명령을 찾아요"
                onClick={() => {
                  setGroup(undefined);
                  input.current?.focus();
                }}
                className="press inline-flex shrink-0 items-center gap-1 rounded-full bg-(--sunken) px-2 py-0.5 text-xs text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-[Highlight]"
              >
                {only.chip}
                <X aria-hidden className="size-3" />
              </button>
            )}
            {scope && (
              <span data-slot="scope-chip" title={`범위: ${scope.name} 프로젝트`} className="inline-flex max-w-40 shrink-0 items-center gap-1 rounded-full bg-(--sunken) px-2 py-0.5 text-xs text-muted-foreground">
                <FolderClosed aria-hidden className="size-3 shrink-0" />
                <span className="sr-only">범위:</span>
                <span className="truncate">{scope.name}</span>
              </span>
            )}
            <Kbd aria-hidden className="h-auto rounded-sm border-0 bg-transparent px-1.5 py-px text-xs font-normal shadow-[inset_0_0_0_1px_var(--line-strong)] max-sm:hidden">
              esc
            </Kbd>
          </div>
          <CommandList className="max-h-[min(400px,60vh)] p-1.5 max-sm:max-h-[min(480px,70dvh)]">
            <CommandEmpty>{only?.empty ?? '맞는 명령이 없어요'}</CommandEmpty>
            {groups.map((g) => (
              <CommandPrimitive.Group
                key={g.id}
                heading={g.label}
                className="[&+&]:mt-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {g.items.map((c) => {
                  const Icon = c.icon;
                  return (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      disabled={c.disabled}
                      onSelect={() => run(c)}
                      data-cmd={c.id}
                      className="h-9 cursor-pointer gap-2.5 rounded-control px-2.5 py-0 max-sm:h-11 data-[selected=true]:bg-(--sunken) data-[selected=true]:text-foreground"
                    >
                      {Icon && <Icon className="size-4 text-muted-foreground" />}
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      {c.hint && <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground tabular-nums">{c.hint}</span>}
                      {c.keys && <CommandShortcut className="ml-0 tracking-normal tabular-nums">{c.keys}</CommandShortcut>}
                    </CommandItem>
                  );
                })}
              </CommandPrimitive.Group>
            ))}
          </CommandList>
        </Command>
        <div className="flex items-center gap-4 border-t px-4 py-2.5 text-xs text-muted-foreground max-sm:hidden" aria-hidden>
          <span>↑↓ 고르기</span>
          <span>↵ 열기</span>
        </div>
      </DialogContent>
    </DialogPrimitive.Root>
  );
}
