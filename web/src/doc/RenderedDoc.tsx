// A document drawn read-only the way the app shows it (history preview, the live view's 작업 보기 #905).
import { useEffect, useState } from 'react';
import type { DpxFile } from '../api';
import { documentToMarkdown } from '../export/markdown';

type Drawn = { html: string | null; rest: string[] };

/**
 * A version drawn the way the app shows it: the document with its diagrams in place, then the blocks the
 * document does not embed and the free-form drawing. Same renderers as the app, loaded on use.
 * `keep`: a newer content keeps the last drawing on screen until it is drawn (a live preview must not flicker).
 */
export function RenderedDoc({ v, idPrefix, dark, keep = false }: { v: Pick<DpxFile, 'document' | 'blocks' | 'canvas'>; idPrefix: string; dark: boolean; keep?: boolean }) {
  const [out, setOut] = useState<Drawn | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    if (!keep) setOut(null);
    setFailed(false);
    (async () => {
      const [{ renderBlock }, { versionHtml }] = await Promise.all([import('../canvas/render'), import('./previewHtml')]);
      const pictures = new Map<string, string>();
      for (const b of v.blocks) pictures.set(b.id, (await renderBlock({ ...b, id: `${idPrefix}:${b.id}` }, dark ? 'dark' : 'light')).svg);
      const doc = versionHtml(v.document, pictures);
      const html = doc?.html ?? null;
      const embedded = new Set(doc?.embedded ?? []);
      const rest = v.blocks.filter((b) => !embedded.has(b.id)).map((b) => pictures.get(b.id) ?? '');
      const elements = ((v.canvas as { elements?: unknown[] } | null)?.elements ?? []).filter((e) => !(e as { isDeleted?: boolean }).isDeleted && (e as { type?: string }).type !== 'image');
      if (elements.length) {
        const { exportToSvg } = await import('@excalidraw/excalidraw');
        const el = await exportToSvg({ elements: elements as never, appState: { exportBackground: false, exportWithDarkMode: dark }, files: null, exportPadding: 8 });
        rest.push(el.outerHTML);
      }
      if (live) setOut({ html, rest });
    })().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [v, idPrefix, dark, keep]);
  const picture = 'max-w-full overflow-auto rounded-md border p-2 [&_svg]:h-auto [&_svg]:max-w-full';
  // Until it is drawn (or when it cannot be), the text of the document still shows.
  const text = (
    <pre className="font-sans text-sm break-words whitespace-pre-wrap">{documentToMarkdown('', v.document, v.blocks).trim()}</pre>
  );
  return (
    <>
      {out?.html != null ? (
        // The HTML comes from the editor's schema serializer and our own renderers, not from raw file text.
        <div className="doc-editor min-h-0! [&_figure]:my-3 [&_figure_svg]:h-auto [&_figure_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: out.html }} />
      ) : (
        text
      )}
      {failed && <p className="text-sm text-muted-foreground">그림을 그리지 못했어요</p>}
      {!!out?.rest.length && (
        <div className="flex flex-col gap-3" aria-label="그림 미리보기">
          {out.rest.map((s, i) => (
            <div key={i} className={picture} dangerouslySetInnerHTML={{ __html: s }} />
          ))}
        </div>
      )}
    </>
  );
}
