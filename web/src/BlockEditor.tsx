import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, tooltips, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { linter, lintGutter, forceLinting, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { dslLanguage, highlightFor } from './dsl/language';
import { analyzeDiagram } from './dsl/adapter';
import { syncSpec, userCode } from './codeSync';
import { dslCompletionSource } from './dsl/completion';

/** What the code panel asks of the editor: the line the caret is on (0-based), or null before it was focused. */
export type BlockEditorHandle = { cursorLine: () => number | null };

type Props = { code: string; type: string; dark: boolean; onChange: (code: string) => void; ref?: Ref<BlockEditorHandle> };

const baseTheme = EditorView.theme({
  '&': { fontSize: 'var(--text-xs)', background: 'var(--muted)', color: 'var(--foreground)' },
  '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--foreground)', padding: '6px 0' },
  '.cm-gutters': { background: 'transparent', color: 'var(--muted-foreground)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { background: 'color-mix(in oklab, var(--foreground) 5%, transparent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { minHeight: '8rem' },
  '.cm-tooltip.cm-tooltip-autocomplete': { background: 'var(--popover)', color: 'var(--popover-foreground)', border: 'none', borderRadius: '8px', boxShadow: 'var(--shadow-pop)', padding: '4px 4px var(--menu-end)' },
  '.cm-tooltip-autocomplete ul li': { borderRadius: '4px', padding: '2px 6px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--accent)', color: 'var(--accent-foreground)' },
  '.cm-completionDetail': { color: 'var(--muted-foreground)', marginLeft: '0.75em', fontStyle: 'normal' },
});

export function BlockEditor({ code, type, dark, onChange, ref }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const focused = useRef(false);
  useImperativeHandle(ref, () => ({
    cursorLine: () => {
      const v = view.current;
      return v && focused.current ? v.state.doc.lineAt(v.state.selection.main.head).number - 1 : null;
    },
  }));
  const hl = useRef(new Compartment());
  const typeRef = useRef(type);
  const onChangeRef = useRef(onChange);
  typeRef.current = type;
  onChangeRef.current = onChange;

  useEffect(() => {
    // Error markers come from the parser (via the adapter). Re-lint when the type changes.
    const lint = linter(
      (v): CmDiagnostic[] => {
        const doc = v.state.doc;
        const len = doc.length;
        return analyzeDiagram(typeRef.current, doc.toString()).diagnostics.map((d) => {
          const from = Math.min(d.offset, len);
          const to = Math.min(Math.max(d.offset + d.length, from + 1), len);
          return { from, to: Math.max(from, to), severity: d.severity, message: d.message };
        });
      },
      { delay: 300 },
    );
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          indentOnInput(),
          dslLanguage,
          hl.current.of(highlightFor(dark)),
          baseTheme,
          tooltips({ parent: document.body }),
          autocompletion({ override: [dslCompletionSource(() => typeRef.current)], icons: false }),
          lintGutter(),
          lint,
          keymap.of([indentWithTab, ...completionKeymap, ...defaultKeymap, ...historyKeymap]),
          EditorView.focusChangeEffect.of((_, focus) => {
            if (focus) focused.current = true;
            return null;
          }),
          EditorView.updateListener.of((u) => {
            // An outside change synced in below is not a user edit: no onChange, so it is not saved back (#547).
            const next = userCode(u);
            if (next != null) onChangeRef.current(next);
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // The editor is created once per block; code/dark changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view.current) forceLinting(view.current);
  }, [type]);

  useEffect(() => {
    view.current?.dispatch({ effects: hl.current.reconfigure(highlightFor(dark)) });
  }, [dark]);

  useEffect(() => {
    const v = view.current;
    const spec = v && syncSpec(v.state, code);
    if (v && spec) v.dispatch(spec);
  }, [code]);

  return <div ref={host} className="overflow-hidden rounded-md border border-input transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50" />;
}
