/**
 * "Mở bằng ứng dụng khác" (SPEC F15): opens a vault file with the OS default app. Programs and
 * scripts are never started this way – "open" on Windows would run them – so their extensions are
 * refused (Microsoft's list of file types that are unsafe to open from an attachment, plus the
 * Unix and macOS script types, plus the macro-enabled Office types: opening one may run its VBA).
 */
import type { RevealCommand } from '../api/reveal-command.js';
import { extensionOf } from './attachment-kinds.js';

const MACRO_ENABLED_OFFICE = 'docm dotm xlsm xltm xlam pptm potm ppam sldm';

const EXECUTABLE_EXTENSIONS = new Set(
  (
    `${MACRO_ENABLED_OFFICE} ` +
    'ade adp app application appref-ms appx appxbundle asp aspx asx bas bat bgi cab cer chm cmd ' +
    'cnt com command cpl crt csh der desktop diagcab dll exe fxp gadget grp hlp hpj hta htc inf ' +
    'ins isp its jar jnlp js jse ksh lnk mad maf mag mam maq mar mas mat mau mav maw mcf mda mdb ' +
    'mde mdt mdw mdz msc msh msh1 msh2 mshxml msh1xml msh2xml msi msix msixbundle msp mst msu ops ' +
    'osd pcd pif pl plg prf prg printerexport ps1 ps1xml ps2 ps2xml psc1 psc2 psd1 psdm1 psm1 py ' +
    'pyc pyo pyw pyz pyzw reg run scf scr sct search-ms settingcontent-ms sh shb shs sys terminal ' +
    'theme tool url vb vbe vbp vbs vhd vhdx vsmacros vsw webloc webpnp website workflow ws wsb ' +
    'wsc wsf wsh xbap xll xnk'
  ).split(' '),
);

/** True for program and script files, which are never opened with the OS from the app. */
export function isExecutableFileName(name: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(extensionOf(name));
}

/**
 * - Windows: `explorer.exe "<path>"` opens the file with its associated app; the argument is
 *   passed verbatim in quotes (Windows paths cannot contain `"`), like the reveal command.
 * - macOS: `open <path>`; elsewhere `xdg-open <path>` (absolute paths never start with `-`).
 */
export function openExternalCommand(
  platform: NodeJS.Platform,
  absolutePath: string,
): RevealCommand {
  if (platform === 'win32') {
    return { command: 'explorer.exe', args: [`"${absolutePath}"`], windowsVerbatimArguments: true };
  }
  if (platform === 'darwin') return { command: 'open', args: [absolutePath] };
  return { command: 'xdg-open', args: [absolutePath] };
}
