import { useDialogStore, type DialogRequest } from '../../lib/dialogs/dialog-requests';
import { ConfirmDialogView } from './confirm-dialog-view';
import { PickFolderDialogView } from './pick-folder-dialog-view';
import { PromptDialogView } from './prompt-dialog-view';
import { TemplatePickerView } from './template-picker-view';

/** Renders the first queued dialog; the others wait their turn. */
export function DialogHost() {
  const request = useDialogStore((state) => state.queue[0]);
  if (!request) return null;
  return <DialogView key={request.id} request={request} />;
}

function DialogView({ request }: { request: DialogRequest }) {
  const close = () => useDialogStore.getState().close(request.id);
  switch (request.kind) {
    case 'confirm':
      return (
        <ConfirmDialogView
          options={request.options}
          onDone={(value) => {
            close();
            request.resolve(value);
          }}
        />
      );
    case 'prompt':
      return (
        <PromptDialogView
          options={request.options}
          onDone={(value) => {
            close();
            request.resolve(value);
          }}
        />
      );
    case 'pick-folder':
      return (
        <PickFolderDialogView
          options={request.options}
          onDone={(value) => {
            close();
            request.resolve(value);
          }}
        />
      );
    case 'template':
      return (
        <TemplatePickerView
          options={request.options}
          onDone={(value) => {
            close();
            request.resolve(value);
          }}
        />
      );
  }
}
