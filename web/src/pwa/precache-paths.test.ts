import { describe, expect, it } from 'vitest';
import { precachePaths } from './precache-paths';

describe('precache list of the service worker', () => {
  it('lists every emitted file once, sorted, with the base path', () => {
    const files = [
      'assets/index-abc.js',
      'assets/index-def.css',
      'assets/be-vietnam-pro-vietnamese-400-normal-x.woff2',
      'icons/icon-192.png',
      'manifest.webmanifest',
      'favicon.svg',
      'assets/index-abc.js',
    ];
    expect(precachePaths(files)).toEqual([
      '/assets/be-vietnam-pro-vietnamese-400-normal-x.woff2',
      '/assets/index-abc.js',
      '/assets/index-def.css',
      '/favicon.svg',
      '/icons/icon-192.png',
      '/manifest.webmanifest',
    ]);
  });

  it('leaves out the shell page, the worker, source maps and dotfiles', () => {
    expect(
      precachePaths(['index.html', 'sw.js', 'assets/a.js.map', '.vite/manifest.json', 'a/.b', '']),
    ).toEqual([]);
  });

  it('accepts Windows separators and another base', () => {
    expect(precachePaths(['icons\\icon-512.png'], '/app')).toEqual(['/app/icons/icon-512.png']);
  });
});
