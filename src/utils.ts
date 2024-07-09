export function assert(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function $assert<T>(condition: T, message?: string): NonNullable<T> {
  assert(condition, message);
  return condition;
}

export function assertInstance<T>(
  value: any,
  constructor: new (...args: any[]) => T,
  message?: string,
): asserts value is T {
  if (!(value instanceof constructor)) {
    throw new Error(message);
  }
}

export function $assertInstance<T>(
  value: any,
  constructor: new (...args: any[]) => T,
  message?: string,
): T {
  assertInstance(value, constructor, message);
  return value;
}

const SELECTOR_MARKS = ['.', '#'] as const;
type SelectorMark = (typeof SELECTOR_MARKS)[number];

/**
 * Query elements by selector and infer the return type by the template string of the selector.
 * @example querySelector('div') // => HTMLDivElement
 * @example querySelector('span.foo') // => HTMLSpanElement
 * @example querySelector('canvas#bar') // => HTMLCanvasElement
 */
export function querySelector<S extends string, Mark extends SelectorMark>(
  selector: S,
): S extends `${infer Name extends keyof HTMLElementTagNameMap}${Mark}${string}`
  ? HTMLElementTagNameMap[Name]
  : HTMLElement {
  const el = document.querySelector(selector);
  assert(el instanceof HTMLElement, `Element not found: ${selector}`);
  return el as any;
}

export { querySelector as $ };
