import { useRef } from 'react';
import type { Block } from '../api';
import { BlockEditor, type BlockEditorHandle } from '../BlockEditor';
import { BlockProps } from '../BlockProps';
import { Button } from '../components/ui/button';
import { NativeSelect } from '../components/ui/native-select';
import { setLineIcon } from '../dsl/iconPick';
import { DIAGRAM_TYPES, TEMPLATES, isDiagramType, type DiagramType } from '../dsl/templates';
import { analyzeDiagram } from '../dsl/adapter';
import { askConfirm } from '../appDialog';
import { IconPicker } from './IconPicker';

type Props = {
  block: Block;
  dark: boolean;
  /** The block is drawn with its saved layout left out (design §4.2). */
  reset: boolean;
  onPatch: (p: Partial<Block>) => void;
  onClose: () => void;
};

/** The "다이어그램 코드" panel: a block's type, code and properties. */
export function BlockCodePanel({ block, dark, reset, onPatch, onClose }: Props) {
  const editorRef = useRef<BlockEditorHandle>(null);
  return (
    <aside
      aria-label="다이어그램 코드"
      className="absolute right-3 top-16 bottom-3 z-10 flex w-[min(28rem,calc(100%-1.5rem))] flex-col gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-(--shadow-pop)"
      // CodeMirror marks Escape it already used (closing the autocomplete popup) as handled; leave the panel open then.
      onKeyDown={(e) => e.key === 'Escape' && !e.defaultPrevented && onClose()}
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="shrink-0 whitespace-nowrap text-sm font-semibold">다이어그램 코드</span>
        <NativeSelect aria-label="종류" value={block.type} onChange={(e) => onPatch({ type: e.target.value })}>
          {!isDiagramType(block.type) && <option value={block.type}>{block.type}</option>}
          {DIAGRAM_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
        {isDiagramType(block.type) && (
          <Button
            variant="outline"
            size="sm"
            className="border-input"
            onClick={async () => {
              const t = TEMPLATES[block.type as DiagramType];
              if (!block.code.trim() || block.code === t || (await askConfirm({ title: '지금 코드를 예시로 바꿀까요?', body: '지금 코드는 예시 코드로 덮어써져요.', ok: '바꾸기', danger: true }))) onPatch({ code: t });
            }}
          >
            예시 넣기
          </Button>
        )}
        {(block.type === 'architecture' || block.type === 'flowchart' || block.type === 'sequence' || block.type === 'erd') && (
          <IconPicker onPick={(name) => onPatch({ code: setLineIcon(block.code, editorRef.current?.cursorLine() ?? Number.MAX_SAFE_INTEGER, name).code })} />
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          닫기
        </Button>
      </div>
      <BlockProps type={block.type} code={block.code} onChange={(code) => onPatch({ code })} />
      <div className="min-h-0 flex-1 overflow-auto">
        <BlockEditor ref={editorRef} key={block.id} code={block.code} type={block.type} dark={dark} onChange={(code) => onPatch({ code })} />
      </div>
      {reset && (
        <p className="text-xs text-muted-foreground">
          코드가 많이 바뀌어서 자동 배치로 그려요. 패널을 닫으면 옮긴 배치가 지워져요
        </p>
      )}
      {!analyzeDiagram(block.type, block.code).parsed && (
        <p className="text-xs text-muted-foreground">
          이 종류는 아직 문법 검사를 지원하지 않아요.
        </p>
      )}
    </aside>
  );
}
