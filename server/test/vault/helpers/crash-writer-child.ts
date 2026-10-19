/**
 * Child process for the kill test: opens the vault and rewrites one large file through the vault
 * service in an endless loop until the parent kills it. Version i is SIZE copies of one letter, so
 * the parent can tell a whole version from a torn one.
 * Usage: node --import tsx crash-writer-child.ts <vault root> <vault path> <size>
 */
import { openVault } from '../../../src/vault/open-vault.js';

const [root, file, size] = process.argv.slice(2);
const { vault } = await openVault({ root: root! });
let { revision } = await vault.read(file!);
process.stdout.write('ready\n');
for (let i = 0; ; i += 1) {
  const content = String.fromCharCode(65 + (i % 26)).repeat(Number(size));
  ({ revision } = await vault.write(file!, content, revision));
}
