/**
 * Test doubles for the PDF viewer: a pdf.js stand-in (documents with N pages of one size, render
 * tasks that finish at once, a text layer that writes the page's text) and an
 * IntersectionObserver whose visible pages the test chooses.
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';

export interface FakePage {
  pageNumber: number;
  getViewport: (options: { scale: number }) => {
    width: number;
    height: number;
    scale: number;
    rotation: number;
    rawDims: { pageWidth: number; pageHeight: number; pageX: number; pageY: number };
  };
  render: ReturnType<typeof vi.fn>;
  streamTextContent: () => unknown;
}

export interface FakeDoc {
  numPages: number;
  getPage: ReturnType<typeof vi.fn>;
  loadingTask: { destroy: ReturnType<typeof vi.fn> };
}

export function fakeDocument(numPages: number, width = 600, height = 800): FakeDoc {
  const pages = new Map<number, FakePage>();
  const pageOf = (pageNumber: number): FakePage => {
    let page = pages.get(pageNumber);
    if (!page) {
      page = {
        pageNumber,
        getViewport: ({ scale }) => ({
          width: width * scale,
          height: height * scale,
          scale,
          rotation: 0,
          rawDims: { pageWidth: width, pageHeight: height, pageX: 0, pageY: 0 },
        }),
        render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
        streamTextContent: () => ({ items: [`Trang ${pageNumber}`] }),
      };
      pages.set(pageNumber, page);
    }
    return page;
  };
  return {
    numPages,
    getPage: vi.fn(async (pageNumber: number) => pageOf(pageNumber)),
    loadingTask: { destroy: vi.fn(async () => undefined) },
  };
}

/** Named like pdf.js's own errors (the viewer only looks at `name`). */
export function pdfError(name: 'InvalidPDFException' | 'PasswordException'): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

export class FakeTextLayer {
  static instances: FakeTextLayer[] = [];
  container: HTMLElement;
  constructor(options: { container: HTMLElement; textContentSource: { items: string[] } }) {
    this.container = options.container;
    this.source = options.textContentSource;
    FakeTextLayer.instances.push(this);
  }
  private source: { items: string[] };
  render() {
    const span = document.createElement('span');
    span.textContent = this.source.items.join(' ');
    this.container.append(span);
    return Promise.resolve();
  }
  cancel() {}
}

export function fakePdfJs(open: () => Promise<FakeDoc>) {
  return {
    getDocument: vi.fn((_params: unknown) => {
      const task = { promise: open(), destroy: vi.fn(async () => undefined) };
      task.promise.catch(() => undefined);
      return task;
    }),
    TextLayer: FakeTextLayer,
  };
}

/** IntersectionObserver stand-in: `show([3, 4])` reports those page frames as on screen. */
export class FakeIntersectionObserver {
  static current: FakeIntersectionObserver | null = null;
  private elements = new Set<Element>();
  constructor(private callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.current = this;
  }
  observe(element: Element) {
    this.elements.add(element);
  }
  unobserve(element: Element) {
    this.elements.delete(element);
  }
  disconnect() {
    this.elements.clear();
  }
  takeRecords() {
    return [];
  }
  static show(pages: number[]) {
    const observer = FakeIntersectionObserver.current;
    if (!observer) throw new Error('no IntersectionObserver yet');
    const entries = [...observer.elements].map((target) => {
      const page = Number((target as HTMLElement).dataset.page);
      const visible = pages.includes(page);
      return {
        target,
        isIntersecting: visible,
        intersectionRect: { height: visible ? 400 : 0 },
      } as unknown as IntersectionObserverEntry;
    });
    act(() => observer.callback(entries, observer as unknown as IntersectionObserver));
  }
}

export function installViewerFakes(): void {
  FakeTextLayer.instances = [];
  FakeIntersectionObserver.current = null;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
}
