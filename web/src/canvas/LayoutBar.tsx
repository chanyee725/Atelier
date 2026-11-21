import { Button } from '../components/ui/button';

/** Bottom-centre bar for layout edit mode (design §5.5): what the mode does, or that a block has a moved layout, or why it cannot be edited. */
export function LayoutBar({ editing, broken, moved, notice, convertible, onReset, onDone, onFreeform }: { editing: boolean; broken: boolean; moved: boolean; notice: string | null; convertible: boolean; onReset: () => void; onDone: () => void; onFreeform: () => void }) {
  if (!editing && !notice && !moved && !convertible) return null;
  return (
    <div
      role="status"
      aria-label="레이아웃 안내"
      className="absolute bottom-16 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-xs shadow"
    >
      {(editing || notice || moved) && <span>{editing ? (broken ? '코드 오류를 고치면 옮길 수 있어요' : '노드를 끌어 옮겨요 · Alt를 누르면 맞춤이 꺼져요') : (notice ?? '직접 옮긴 배치예요')}</span>}
      {(editing || (!notice && moved)) && (
        <Button variant="outline" size="sm" disabled={!moved} onClick={onReset}>
          레이아웃 초기화
        </Button>
      )}
      {convertible && !notice && (
        <Button variant="outline" size="sm" onClick={onFreeform}>
          자유 도형으로 바꾸기
        </Button>
      )}
      {editing && (
        <Button variant="outline" size="sm" onClick={onDone}>
          완료
        </Button>
      )}
    </div>
  );
}
