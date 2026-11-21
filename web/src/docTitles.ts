// The names the sidebar shows for documents, kept out of Sidebar.tsx so tests can import them.
export const displayName = (n: { name: string; title?: string }) => n.title || n.name.replace(/\.dpx\.json$/, '');
