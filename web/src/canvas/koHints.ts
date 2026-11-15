// Excalidraw's ko-KR locale lacks some hint strings (they fall back to English: "Enter 키를 눌러 텍스트 추가하기 Hold Ctrl
// and Arrow key to create a flowchart", crop, search and arrow hints, #527), and the ones it has are formal and long.
// The build replaces the locale's whole `hints` object with this one, so every hint on the canvas is Korean, 해요체.
// "CtrlOrCmd" and "{{arrowShortcut}}" are filled in by Excalidraw (Ctrl or ⌘, the arrow tool's key).

export const KO_HINTS: Readonly<Record<string, string>> = {
  canvasPanning: '캔버스를 옮기려면 마우스 휠이나 스페이스바를 누른 채 드래그하거나 손 도구를 써요.',
  linearElement: '여러 점을 잇으려면 클릭하고, 직선은 바로 드래그해요.',
  arrowTool: '여러 점을 잇으려면 클릭하고, 직선은 드래그해요. {{arrowShortcut}} 키를 다시 누르면 화살표 종류가 바뀌어요.',
  freeDraw: '클릭한 채 드래그하고, 다 그렸으면 놓아요.',
  text: '팁: 선택 도구로 빈 곳을 더블 클릭해도 텍스트를 넣을 수 있어요.',
  embeddable: '클릭하고 드래그해서 웹사이트 임베드를 만들어요.',
  text_selected: '더블 클릭하거나 Enter 키를 눌러 텍스트를 고쳐요.',
  text_editing: 'Esc나 CtrlOrCmd+Enter를 눌러 편집을 끝내요.',
  linearElementMulti: '마지막 점을 클릭하거나 Esc, Enter 키를 눌러 끝내요.',
  lockAngle: 'Shift 키를 누른 채 돌리면 각도가 고정돼요.',
  resize: 'Shift 키를 누른 채 크기를 바꾸면 비율이 유지돼요.\nAlt 키를 누르면 가운데를 기준으로 바뀌어요.',
  resizeImage: 'Shift 키를 누르면 비율 없이 자유롭게 바꿀 수 있어요.\nAlt 키를 누르면 가운데를 기준으로 바뀌어요.',
  rotate: 'Shift 키를 누른 채 돌리면 각도가 고정돼요.',
  lineEditor_info: '꼭짓점을 고치려면 CtrlOrCmd 키를 누른 채 더블 클릭하거나 CtrlOrCmd+Enter를 눌러요.',
  lineEditor_pointSelected: 'Delete 키로 꼭짓점을 지우고, CtrlOrCmd+D로 복제하고, 드래그해서 옮겨요.',
  lineEditor_nothingSelected: '꼭짓점을 골라 고쳐요. Shift 키로 여러 개를 고르고,\nAlt 키를 누른 채 클릭하면 꼭짓점이 늘어요.',
  placeImage: '클릭해서 이미지를 놓거나, 드래그해서 크기를 정해요.',
  publishLibrary: '내 라이브러리를 게시해요.',
  bindTextToElement: 'Enter 키를 눌러 텍스트를 넣어요.',
  createFlowchart: 'CtrlOrCmd 키를 누른 채 방향키를 누르면 순서도가 이어져요.',
  deepBoxSelect: 'CtrlOrCmd 키를 누르면 묶음 안의 요소를 골라요. 드래그는 되지 않아요.',
  eraserRevert: 'Alt 키를 누르면 지우려던 요소가 되돌아와요.',
  firefox_clipboard_write: '설정 페이지(about:config)에서 "dom.events.asyncClipboard.clipboardItem"을 "true"로 바꾸면 이 기능을 쓸 수 있어요.',
  disableSnapping: 'CtrlOrCmd 키를 누르면 다른 요소에 맞추지 않아요.',
  enterCropEditor: '이미지를 더블 클릭하거나 Enter 키를 눌러 자를 수 있어요.',
  leaveCropEditor: '이미지 밖을 클릭하거나 Enter, Esc 키를 눌러 자르기를 끝내요.',
  dismissSearch: 'Esc 키를 눌러 검색을 닫아요.',
};

/** The locale's hints object: opens at the key `canvasPanning:` (first key, minified or readable) and ends at its `}`. */
function hintsSpan(code: string): [number, number] | null {
  const at = code.search(/[{,]\s*canvasPanning\s*:/);
  if (at < 0) return null;
  const start = code.lastIndexOf('{', at + 1);
  let quote = '';
  for (let i = start + 1; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') return null; // a nested object: not the flat hints object
    else if (c === '}') return [start, i + 1];
  }
  return null;
}

/**
 * The ko-KR locale chunk with its hints replaced by KO_HINTS: null when `code` is not that chunk. Throws when the
 * hints object is not found exactly once, so a dependency update cannot silently bring the English hints back.
 */
export function patchKoHints(code: string): string | null {
  // Only the Korean locale: its `canvasPanning` text starts with 캔버스 (written as \u escapes in the chunk).
  if (!/canvasPanning\s*:\s*["']\\uCE94\\uBC84\\uC2A4/.test(code)) return null;
  const span = hintsSpan(code);
  if (!span) return null;
  const rest = code.slice(span[1]);
  if (hintsSpan(rest) !== null) throw new Error('excalidraw-assets: the ko-KR hints object was found more than once; update patchKoHints');
  return code.slice(0, span[0]) + JSON.stringify(KO_HINTS) + rest;
}
