/**
 * Icon and version information of the Windows executable (F29.1), written with `resedit` into
 * the copied `node.exe` BEFORE the SEA blob is injected (changing resources afterwards would
 * move the injected resource). The old Authenticode signature is dropped: it no longer matches.
 * The icon is made from the PWA icons (PNG entries inside the ICO, read by Windows since Vista).
 */
import * as ResEdit from 'resedit';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngSize(png: Uint8Array): { width: number; height: number } {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a PNG file.');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** An ICO file holding the PNGs as they are (sizes up to 256 px; 256 is written as 0). */
export function buildIco(pngs: readonly Uint8Array[]): Buffer {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, index) => {
    const { width, height } = pngSize(png);
    if (width > 256 || height > 256) throw new Error(`Icon ${width}×${height} is above 256 px.`);
    const entry = 6 + 16 * index;
    header.writeUInt8(width === 256 ? 0 : width, entry);
    header.writeUInt8(height === 256 ? 0 : height, entry + 1);
    header.writeUInt8(0, entry + 2); // no palette
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4); // planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.byteLength, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.byteLength;
  });
  return Buffer.concat([header, ...pngs.map((png) => Buffer.from(png))]);
}

export interface ExeIdentity {
  /** `major.minor.patch` (server/package.json). */
  version: string;
  ico: Buffer;
  fileName: string;
}

function versionParts(version: string): [number, number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
  return [major, minor, patch, 0];
}

/** Returns the executable with the app's icon and version strings. */
export function applyWindowsResources(image: Uint8Array, identity: ExeIdentity): Buffer {
  const exe = ResEdit.NtExecutable.from(image, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const icons = ResEdit.Data.IconFile.from(identity.ico).icons.map((item) => item.data);
  // Replace node's own main icon group (Explorer shows the first one), or add group 1.
  const [group] = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    group?.id ?? 1,
    group?.lang ?? 1033,
    icons,
  );

  const info =
    ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] ??
    ResEdit.Resource.VersionInfo.createEmpty();
  const [major, minor, patch, build] = versionParts(identity.version);
  const dotted = `${major}.${minor}.${patch}.${build}`;
  info.setFileVersion(major, minor, patch, build);
  info.setProductVersion(major, minor, patch, build);
  const languages = info.getAllLanguagesForStringValues();
  for (const language of languages.length > 0 ? languages : [{ lang: 1033, codepage: 1200 }]) {
    info.setStringValues(language, {
      CompanyName: 'Second Brain',
      FileDescription: 'Second Brain',
      FileVersion: dotted,
      InternalName: 'second-brain',
      LegalCopyright: '',
      OriginalFilename: identity.fileName,
      ProductName: 'Second Brain',
      ProductVersion: dotted,
    });
  }
  info.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  return Buffer.from(exe.generate());
}
