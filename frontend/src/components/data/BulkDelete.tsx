import { Trash2 } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import Button from '../ui/Button';
import { ConfirmDialog } from '../ui/Modal';

/** "Delete" in a list's selection bar. Owners only; deletes one by one and reports the result. */
export default function BulkDelete({
  ids,
  noun,
  warning,
  remove,
  onDone,
}: {
  ids: (number | string)[];
  noun: [singular: string, plural: string];
  warning: ReactNode;
  remove: (id: number | string) => Promise<unknown>;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (user?.role !== 'owner' || ids.length === 0) return null;
  const label = `${ids.length} ${ids.length === 1 ? noun[0] : noun[1]}`;

  const run = async () => {
    let ok = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await remove(id);
        ok++;
      } catch (e) {
        failed.push(e instanceof Error ? e.message : String(e));
      }
    }
    setOpen(false);
    if (failed.length) toast('error', `Deleted ${ok}, ${failed.length} failed: ${failed[0]}`);
    else toast('success', `Deleted ${label}`);
    onDone();
  };

  return (
    <>
      <Button size="sm" variant="secondary" className="text-danger hover:text-danger" onClick={() => setOpen(true)}>
        <Trash2 size={14} /> Delete
      </Button>
      <ConfirmDialog
        open={open}
        title={`Delete ${label}?`}
        danger
        confirmLabel={`Delete ${label}`}
        onClose={() => setOpen(false)}
        onConfirm={run}
        message={warning}
      />
    </>
  );
}
