/**
 * Windows build without a console window (F29.1): flips the PE optional header's `Subsystem`
 * field from console (3) to GUI (2). Same offset for PE32 and PE32+: the field is 68 bytes into
 * the optional header, which follows the 4-byte `PE\0\0` signature and the 20-byte COFF header.
 * The PE checksum is not used for user-mode programs and the signature is already gone
 * (`resedit` drops it), so nothing else changes.
 */
export const SUBSYSTEM_GUI = 2;
export const SUBSYSTEM_CONSOLE = 3;
const PE32_MAGIC = 0x10b;
const PE32_PLUS_MAGIC = 0x20b;

export class PeFormatError extends Error {}

/** Offset of the Subsystem field, after checking the headers. */
export function subsystemOffset(image: Uint8Array): number {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  if (image.length < 0x40 || view.getUint16(0, true) !== 0x5a4d) {
    throw new PeFormatError('Not a Windows program (no MZ header).');
  }
  const pe = view.getUint32(0x3c, true);
  if (pe + 24 + 70 > image.length || view.getUint32(pe, true) !== 0x00004550) {
    throw new PeFormatError('Not a Windows program (no PE signature).');
  }
  const optional = pe + 24;
  const magic = view.getUint16(optional, true);
  if (magic !== PE32_MAGIC && magic !== PE32_PLUS_MAGIC) {
    throw new PeFormatError(`Unknown optional header magic 0x${magic.toString(16)}.`);
  }
  return optional + 68;
}

export function readSubsystem(image: Uint8Array): number {
  const offset = subsystemOffset(image);
  return new DataView(image.buffer, image.byteOffset, image.byteLength).getUint16(offset, true);
}

/** Sets the GUI subsystem in place; returns the previous value. */
export function setGuiSubsystem(image: Uint8Array): number {
  const offset = subsystemOffset(image);
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const previous = view.getUint16(offset, true);
  if (previous !== SUBSYSTEM_CONSOLE && previous !== SUBSYSTEM_GUI) {
    throw new PeFormatError(`Unexpected subsystem ${previous}.`);
  }
  view.setUint16(offset, SUBSYSTEM_GUI, true);
  return previous;
}
