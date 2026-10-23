// Windows steps of the executable (F29.1): GUI subsystem patch, icon file, version info, and an
// opt-in structural check of a cross-built exe (SB_TEST_WIN_NODE=<node.exe of the same version>).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ResEdit from 'resedit';
import { describe, expect, it } from 'vitest';
import { buildExe } from './build-exe.js';
import {
  PeFormatError,
  readSubsystem,
  setGuiSubsystem,
  SUBSYSTEM_CONSOLE,
  SUBSYSTEM_GUI,
} from './lib/build-exe/pe-subsystem.js';
import { buildIco, pngSize } from './lib/build-exe/windows-resources.js';
import { appRoot } from './lib/script-utils.js';

/** The smallest header the patcher reads: MZ, e_lfanew, PE signature, COFF, optional header. */
function fakePe(magic: number, subsystem: number): Buffer {
  const image = Buffer.alloc(0x200);
  image.write('MZ', 0, 'latin1');
  image.writeUInt32LE(0x80, 0x3c);
  image.write('PE\0\0', 0x80, 'latin1');
  image.writeUInt16LE(magic, 0x80 + 24);
  image.writeUInt16LE(subsystem, 0x80 + 24 + 68);
  return image;
}

describe('no console window: PE subsystem (F29.1)', () => {
  it('flips console to GUI for PE32+ and PE32, touching only those two bytes', () => {
    for (const magic of [0x20b, 0x10b]) {
      const image = fakePe(magic, SUBSYSTEM_CONSOLE);
      const before = Buffer.from(image);
      expect(setGuiSubsystem(image)).toBe(SUBSYSTEM_CONSOLE);
      expect(readSubsystem(image)).toBe(SUBSYSTEM_GUI);
      const changed = [...image].flatMap((byte, index) => (byte !== before[index] ? [index] : []));
      expect(changed).toEqual([0x80 + 24 + 68]);
      expect(setGuiSubsystem(image)).toBe(SUBSYSTEM_GUI); // idempotent
    }
  });

  it('refuses anything that is not a console or GUI Windows program', () => {
    expect(() => setGuiSubsystem(Buffer.from('#!/bin/sh\n'.padEnd(256)))).toThrow(PeFormatError);
    const elfLike = fakePe(0x20b, SUBSYSTEM_CONSOLE);
    elfLike.write('XX', 0x80, 'latin1');
    expect(() => setGuiSubsystem(elfLike)).toThrow(PeFormatError);
    expect(() => setGuiSubsystem(fakePe(0x999, SUBSYSTEM_CONSOLE))).toThrow(PeFormatError);
    expect(() => setGuiSubsystem(fakePe(0x20b, 10 /* EFI application */))).toThrow(PeFormatError);
  });
});

describe('exe icon from the PWA icons (F29.1)', () => {
  it('writes an ICO with the PNG as it is, readable by resedit', () => {
    const png = readFileSync(path.join(appRoot, 'web/public/icons/icon-192.png'));
    expect(pngSize(png)).toEqual({ width: 192, height: 192 });
    const ico = buildIco([png]);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    expect(ico[6]).toBe(192);
    expect(ico.readUInt16LE(6 + 6)).toBe(32);
    expect(ico.readUInt32LE(6 + 8)).toBe(png.length);
    expect(ico.subarray(22)).toEqual(png);
    const parsed = ResEdit.Data.IconFile.from(ico);
    expect(parsed.icons).toHaveLength(1);
    expect(parsed.icons[0]?.data.width).toBe(192);
  });

  it('refuses icons above 256 px and files that are not PNG', () => {
    const big = Buffer.from(readFileSync(path.join(appRoot, 'web/public/icons/icon-512.png')));
    expect(() => buildIco([big])).toThrow('above 256 px');
    expect(() => pngSize(Buffer.from('GIF89a........................'))).toThrow('Not a PNG');
  });

  it('sets resources before injecting the blob and the subsystem after it', () => {
    const source = readFileSync(path.join(appRoot, 'scripts/lib/build-exe/make-sea.ts'), 'utf8');
    const resources = source.indexOf('applyWindowsResources(readFileSync');
    const inject = source.indexOf('await inject(');
    const subsystem = source.indexOf('setGuiSubsystem(image)');
    expect(resources).toBeGreaterThan(0);
    expect(resources).toBeLessThan(inject);
    expect(inject).toBeLessThan(subsystem);
  });
});

const winNode = process.env.SB_TEST_WIN_NODE;
describe.skipIf(!winNode)('cross-built Windows exe, structure only (F29.1)', () => {
  it('has the GUI subsystem, our icon and version, the SEA blob, the fuse set, no stale signature', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'sb-win-exe-'));
    try {
      const exe = await buildExe([
        '--skip-build',
        '--target',
        'win32',
        '--node',
        winNode!,
        '--out',
        out,
      ]);
      expect(path.basename(exe)).toBe('Second Brain.exe');
      const image = readFileSync(exe);
      expect(readSubsystem(image)).toBe(SUBSYSTEM_GUI);
      const fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
      expect(
        image
          .subarray(image.indexOf(fuse) + fuse.length, image.indexOf(fuse) + fuse.length + 2)
          .toString(),
      ).toBe(':1');
      const pe = ResEdit.NtExecutable.from(image);
      expect(pe.newHeader.optionalHeaderDataDirectory.get(4).size).toBe(0); // no certificate
      const res = ResEdit.NtExecutableResource.from(pe);
      expect(res.entries.some((entry) => entry.type === 10 && entry.id === 'NODE_SEA_BLOB')).toBe(
        true,
      );
      const [group] = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
      expect(group?.icons.map((icon) => icon.width)).toEqual([192]);
      const [version] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
      const strings = version?.getStringValues(version.getAllLanguagesForStringValues()[0]!);
      expect(strings).toMatchObject({
        ProductName: 'Second Brain',
        OriginalFilename: 'Second Brain.exe',
      });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});
