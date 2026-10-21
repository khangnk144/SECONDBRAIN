import { VaultError } from '../vault/vault-types.js';

/** Why a backup could not be made or restored (`details.reason` of 400 `VALIDATION`). */
export type BackupRefusal =
  | 'bad-archive'
  | 'unsafe-entry'
  | 'too-large'
  | 'target-not-empty'
  | 'target-inside-vault'
  | 'overlaps-app'
  | 'target-invalid'
  | 'bad-form';

const MESSAGES: Record<BackupRefusal, string> = {
  'bad-archive': 'This file is not a backup the app can read (damaged or not a zip).',
  'unsafe-entry': 'The backup contains a file name that could write outside the chosen folder.',
  'too-large': 'The backup is larger than the app accepts.',
  'target-not-empty': 'Choose a folder that does not exist yet or is empty.',
  'target-inside-vault': 'Choose a folder outside the open vault.',
  'overlaps-app': "Choose a folder outside the app's own folders.",
  'target-invalid': 'Choose a full folder path whose parent folder exists and can be written.',
  'bad-form': 'Send the fields "target" and "open" first, then one backup file named "file".',
};

export class BackupRefusedError extends Error {
  constructor(readonly reason: BackupRefusal) {
    super(MESSAGES[reason]);
    this.name = 'BackupRefusedError';
  }
}

export const refuse = (reason: BackupRefusal): BackupRefusedError => new BackupRefusedError(reason);

/** The API form: 400 `VALIDATION` with `details.reason`. */
export function toValidationError(error: BackupRefusedError): VaultError {
  return new VaultError('VALIDATION', error.message, { reason: error.reason });
}
