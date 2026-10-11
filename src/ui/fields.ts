import { formatLength, parseLength } from '../model/project';
import type { Units } from '../model/types';
import { h } from './dom';

export function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'prop-row', title: hint }, h('span', { class: 'prop-label' }, label), control);
}

export function readonlyField(value: string): HTMLElement {
  return h('span', { class: 'prop-readonly' }, value);
}

function commitOnChange(input: HTMLInputElement, commit: () => void): void {
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = input.defaultValue;
      input.blur();
    }
    e.stopPropagation();
  });
}

export function lengthField(value: number, units: Units, onCommit: (m: number) => void, opts: { min?: number } = {}): HTMLElement {
  const input = h('input', { type: 'text', class: 'prop-input num', value: formatLength(value, units) });
  input.defaultValue = input.value;
  commitOnChange(input, () => {
    const v = parseLength(input.value, units);
    if (v === null || (opts.min !== undefined && v < opts.min)) {
      input.value = input.defaultValue;
      input.classList.add('invalid');
      setTimeout(() => input.classList.remove('invalid'), 600);
      return;
    }
    onCommit(v);
  });
  return h('span', { class: 'unit-input' }, input, h('span', { class: 'unit' }, units));
}

export function numberField(value: number, onCommit: (v: number) => void, opts: { min?: number; max?: number; step?: number; suffix?: string } = {}): HTMLElement {
  const input = h('input', { type: 'number', class: 'prop-input num', value: String(value), step: String(opts.step ?? 1) });
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  input.defaultValue = input.value;
  commitOnChange(input, () => {
    const v = parseFloat(input.value.replace(',', '.'));
    if (Number.isNaN(v)) {
      input.value = input.defaultValue;
      return;
    }
    onCommit(Math.min(opts.max ?? Infinity, Math.max(opts.min ?? -Infinity, v)));
  });
  return opts.suffix ? h('span', { class: 'unit-input' }, input, h('span', { class: 'unit' }, opts.suffix)) : input;
}

export function textField(value: string, onCommit: (v: string) => void): HTMLInputElement {
  const input = h('input', { type: 'text', class: 'prop-input', value });
  input.defaultValue = value;
  commitOnChange(input, () => onCommit(input.value));
  return input;
}

export function selectField<T extends string>(value: T, options: { value: T; label: string }[], onChange: (v: T) => void): HTMLSelectElement {
  const sel = h('select', { class: 'prop-input' }, ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  sel.addEventListener('change', () => onChange(sel.value as T));
  sel.addEventListener('keydown', (e) => e.stopPropagation());
  return sel;
}

export function checkField(value: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const input = h('input', { type: 'checkbox', class: 'prop-check', checked: value });
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

export function colorField(value: string, onChange: (v: string) => void): HTMLInputElement {
  const input = h('input', { type: 'color', class: 'prop-color', value });
  input.addEventListener('change', () => onChange(input.value));
  return input;
}
