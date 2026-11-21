import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { api, type DpxFile } from '../api';
import { parseHash } from '../doc/outline';
import type { Section } from '../projectNav';
import { setHashPath } from './hashRoute';

type Startup = {
  refreshTree: () => Promise<void>;
  load: (p: string, f: DpxFile) => void;
  jumpTo: (id: string | null) => void;
  setProjectName: (name: string | null) => void;
  setSection: Dispatch<SetStateAction<Section>>;
};

/** On first render: the project name, the file list, and the file (and heading) the address names. */
export function useStartup({ refreshTree, load, jumpTo, setProjectName, setSection }: Startup) {
  useEffect(() => {
    api.info().then((i) => setProjectName(i.project || i.workspace || null)).catch(() => {});
    void refreshTree();
    const link = parseHash(window.location.hash);
    if (link)
      api
        .readFile(link.path)
        .then((f) => {
          load(link.path, f);
          setSection({ kind: 'doc' });
          jumpTo(link.heading);
        })
        .catch(() => setHashPath(null));
  }, [refreshTree, load, jumpTo]);
}
