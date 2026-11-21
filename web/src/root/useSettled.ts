import { useEffect, useState } from 'react';

/** `value` once it has stopped changing for `ms`; a new `reset` key (another file) takes the live value at once. */
export function useSettled<T>(value: T, ms: number, reset: string): T {
  const [v, setV] = useState({ value, reset });
  useEffect(() => {
    const t = setTimeout(() => setV({ value, reset }), ms);
    return () => clearTimeout(t);
  }, [value, ms, reset]);
  return v.reset === reset ? v.value : value;
}
