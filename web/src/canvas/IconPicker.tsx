// Icon picker for the diagram code panel (#734): search the bundled icons and put the picked one on the node at
// the caret. Built on the cmdk Command parts (filtering is ours: thousands of names, at most 60 rows drawn).
import { useEffect, useMemo, useState } from 'react';
import { Shapes } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { allIconNames, loadIcons } from '../../../shared/render/icon-registry.ts';
import { iconFor } from '../../../shared/render/icons.ts';
import { SET_LABEL, searchIcons, type IconEntry } from '../dsl/iconPick';

/** Small inline SVG of an icon (bundled, sanitized data). Logos and vendor art keep their colours. */
function previewSvg(name: string): string {
  const icon = iconFor(name);
  if (icon.art) return `<svg viewBox="${icon.art.vb}" width="20" height="20" aria-hidden="true">${icon.art.body}</svg>`;
  const paint = icon.fill ? `fill="${icon.hex ?? 'currentColor'}"` : 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="${icon.d}" ${paint}/></svg>`;
}

export function IconPicker({ onPick }: { onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<IconEntry[] | null>(null);
  const [, setLoaded] = useState(0);

  useEffect(() => {
    if (open && !entries) void allIconNames().then(setEntries);
  }, [open, entries]);

  const results = useMemo(() => (entries ? searchIcons(entries, query) : []), [entries, query]);

  // Artwork loads per chunk; redraw the rows once the chunks for the visible results are in.
  useEffect(() => {
    if (results.length === 0) return;
    let live = true;
    void loadIcons(results.map((r) => r.name)).then(() => live && setLoaded((n) => n + 1));
    return () => {
      live = false;
    };
  }, [results]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-input" data-icon-picker="">
          <Shapes aria-hidden />
          아이콘
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={8} className="w-80 p-0" onKeyDown={(e) => e.key === 'Escape' && e.stopPropagation()}>
        <Command shouldFilter={false} label="아이콘 찾기">
          <CommandInput value={query} onValueChange={setQuery} placeholder="아이콘 찾기 (postgres, aws-ec2 …)" />
          <CommandList className="max-h-72">
            {entries && <CommandEmpty>맞는 아이콘이 없어요</CommandEmpty>}
            {!entries && <div className="py-6 text-center text-sm text-muted-foreground">불러오는 중…</div>}
            {results.map((r) => (
              <CommandItem
                key={r.name}
                value={r.name}
                onSelect={() => {
                  onPick(r.name);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span className="flex size-5 shrink-0 items-center justify-center" dangerouslySetInnerHTML={{ __html: previewSvg(r.name) }} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{SET_LABEL[r.set]}</span>
              </CommandItem>
            ))}
          </CommandList>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">고른 아이콘은 커서가 있는 줄의 노드에 들어가요</p>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
