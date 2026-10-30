import { FileUp } from 'lucide-react';
import { ReactNode, useRef, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { downloadCsv, ImportColumn, readImportRows } from '../../lib/csv';
import type { ImportResult } from '../../types';
import Button from '../ui/Button';
import { Modal } from '../ui/Modal';
import Spinner from '../ui/Spinner';

const MAX_ROWS = 1000;

/**
 * Import from a CSV in two steps: pick a file to see a preview (the server checks every row but saves nothing),
 * then import. Rows with problems are listed and skipped; the rest are saved together.
 */
export default function ImportCsvModal({
  open,
  onClose,
  title,
  noun,
  columns,
  example,
  templateName,
  help,
  run,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  noun: [string, string];
  columns: ImportColumn[];
  example: Record<string, string>;
  templateName: string;
  help: ReactNode;
  run: (rows: Record<string, string>[], dryRun: boolean) => Promise<ImportResult>;
  onDone: () => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [rowNumbers, setRowNumbers] = useState<number[]>([]);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFileName(null);
    setRows([]);
    setRowNumbers([]);
    setPreview(null);
    setError(null);
    if (input.current) input.current.value = '';
  };
  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    try {
      const parsed = readImportRows(await file.text(), columns);
      if (parsed.missing.length) {
        setError(`The file needs ${parsed.missing.length > 1 ? 'these columns' : 'this column'}: ${parsed.missing.join(', ')}. Download the template to see the layout.`);
        return;
      }
      if (!parsed.rows.length) return setError('The file has no rows to import.');
      if (parsed.rows.length > MAX_ROWS) return setError(`The file has ${parsed.rows.length.toLocaleString('en-IN')} rows. Import up to ${MAX_ROWS.toLocaleString('en-IN')} at a time.`);
      setRows(parsed.rows);
      setRowNumbers(parsed.rowNumbers);
      setChecking(true);
      setPreview(await run(parsed.rows, true));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file');
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await run(rows, false);
      toast('success', `Imported: ${r.created} added, ${r.updated} updated${r.failed ? `, ${r.failed} skipped` : ''}`);
      onDone();
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import failed. Nothing was saved.');
    } finally {
      setSaving(false);
    }
  };

  const template = () => downloadCsv(templateName, [example], columns.map((c) => ({ header: c.header, value: (r: Record<string, string>) => r[c.key] })));
  const headerOf = (key: string) => columns.find((c) => c.key === key)?.header ?? key;
  const ready = preview ? preview.created + preview.updated : 0;
  const listed = preview?.rows.filter((r) => r.errors || r.note) ?? [];

  return (
    <Modal
      open={open}
      title={title}
      onClose={close}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!ready || checking}>
            {ready ? `Import ${ready} ${ready === 1 ? noun[0] : noun[1]}` : 'Import'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-1">
        <p>{help}</p>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={checking || saving}>
            <FileUp size={14} /> {fileName ? 'Choose another file' : 'Choose CSV file'}
          </Button>
          <button type="button" className="text-[13px] text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={template}>
            Download template
          </button>
        </div>
        {fileName && <p className="truncate text-[13px] text-ink-3">{fileName}</p>}
        {checking && (
          <p className="flex items-center gap-2 text-[13px] text-ink-3">
            <Spinner className="h-3.5 w-3.5" /> Checking every row…
          </p>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        {preview && (
          <div className="rounded-lg border border-line">
            <p className="px-3 py-2 text-[13px] text-ink">
              {preview.created} new · {preview.updated} to update · {preview.failed} with problems
            </p>
            {listed.length > 0 && (
              <ul className="max-h-60 divide-y divide-line overflow-y-auto border-t border-line text-[13px]">
                {listed.map((r) => (
                  <li key={r.row} className="px-3 py-2">
                    <span className="font-medium text-ink">Row {rowNumbers[r.row - 2] ?? r.row}</span>
                    {r.name ? <span className="text-ink-2"> · {r.name}</span> : null}
                    <span className={`block ${r.errors ? 'text-danger' : 'text-ink-3'}`}>
                      {r.errors
                        ? Object.entries(r.errors)
                            .map(([k, v]) => `${headerOf(k)}: ${v}`)
                            .join(' · ')
                        : r.note}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {preview && preview.failed > 0 && <p className="text-[12.5px] text-ink-3">Rows with problems are skipped. Fix them in the file and import it again.</p>}
      </div>
    </Modal>
  );
}
