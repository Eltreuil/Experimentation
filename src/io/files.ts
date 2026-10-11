import { normalize } from '../model/project';
import type { ProjectData } from '../model/types';

const AUTOSAVE_KEY = 'openbim-studio:autosave';

export function download(filename: string, content: BlobPart, mime: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadDataURL(filename: string, dataUrl: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_ -]+/gu, '').trim().replace(/\s+/g, '_') || 'projet';
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export async function readProjectFile(file: File): Promise<ProjectData> {
  const text = await file.text();
  return normalize(JSON.parse(text));
}

export function autosave(data: ProjectData): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
  } catch {
    // Stockage indisponible (navigation privée, quota) : on ignore.
  }
}

export function loadAutosave(): ProjectData | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
