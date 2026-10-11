type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
type Child = Node | string | null | undefined | false;

/** Petit utilitaire de création d'éléments DOM. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs)) {
    if (val === undefined || val === false) continue;
    if (k.startsWith('on') && typeof val === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), val as EventListener);
    } else if (k === 'class') {
      el.className = String(val);
    } else if (k === 'html') {
      el.innerHTML = String(val);
    } else if (k in el && typeof val !== 'string') {
      (el as unknown as Record<string, unknown>)[k] = val;
    } else {
      el.setAttribute(k, val === true ? '' : String(val));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.firstChild.remove();
}

/** Regroupe les appels successifs en un seul par image. */
export function perFrame(fn: () => void): () => void {
  let pending = 0;
  return () => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      fn();
    });
  };
}
