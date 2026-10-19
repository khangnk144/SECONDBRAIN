import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusIsLost, focusOrMain, recoverFocusAfterNavigation } from './focus-recovery';

function page() {
  document.body.innerHTML = `
    <nav class="tab-bar"><button aria-current="page">Bài 1</button></nav>
    <main id="main-content" tabindex="-1"><div id="screen"></div></main>
    <button id="elsewhere">x</button>`;
  return {
    main: document.getElementById('main-content') as HTMLElement,
    screen: document.getElementById('screen') as HTMLElement,
    tab: document.querySelector('.tab-bar button') as HTMLElement,
  };
}

function addEditor(screen: HTMLElement): HTMLElement {
  const editor = document.createElement('div');
  editor.className = 'tiptap ProseMirror';
  editor.setAttribute('contenteditable', 'true');
  editor.tabIndex = 0;
  screen.append(editor);
  return editor;
}

describe('focus recovery after a navigation (WCAG 2.4.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('puts focus in the new note editor once it appears', () => {
    const { screen } = page();
    expect(focusIsLost()).toBe(true);
    recoverFocusAfterNavigation({ expectEditor: true });
    vi.advanceTimersByTime(300);
    const editor = addEditor(screen);
    vi.advanceTimersByTime(60);
    expect(editor).toHaveFocus();
  });

  it('falls back to the active tab when no editor shows up, and to main without a note', () => {
    const { tab, main } = page();
    recoverFocusAfterNavigation({ expectEditor: true, timeoutMs: 500 });
    vi.advanceTimersByTime(600);
    expect(tab).toHaveFocus();

    tab.blur();
    recoverFocusAfterNavigation({ expectEditor: false });
    vi.advanceTimersByTime(1);
    expect(main).toHaveFocus();
  });

  it('never takes focus from an element focused meanwhile, and waits while focus is kept', () => {
    const { screen } = page();
    const editor = addEditor(screen);
    editor.focus();
    recoverFocusAfterNavigation({ expectEditor: true });
    vi.advanceTimersByTime(100);
    // The editor element was swapped out later (the note finished loading): focus follows.
    editor.remove();
    const next = addEditor(screen);
    vi.advanceTimersByTime(60);
    expect(next).toHaveFocus();

    next.blur();
    recoverFocusAfterNavigation({ expectEditor: true });
    (document.getElementById('elsewhere') as HTMLElement).focus();
    addEditor(screen);
    vi.advanceTimersByTime(3_000);
    expect(document.getElementById('elsewhere')).toHaveFocus();
  });

  it('focusOrMain uses the element when it is still on the page, else the main region', () => {
    const { main } = page();
    const gone = document.createElement('button');
    focusOrMain(gone);
    expect(main).toHaveFocus();
    const here = document.getElementById('elsewhere') as HTMLElement;
    focusOrMain(here);
    expect(here).toHaveFocus();
  });
});
