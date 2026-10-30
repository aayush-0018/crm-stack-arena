import { Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { receiptsApi, returnsApi } from '../../api/endpoints';
import { ReceiptView, ReturnView } from '../../components/documents/DocumentViews';
import BackButton from '../../components/ui/BackButton';
import Button, { ButtonLink } from '../../components/ui/Button';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { downloadBlob } from '../../lib/download';
import { useAsync } from '../../lib/hooks';

/** Print / PDF actions shared by the receipt and return pages. */
function usePdf(fetch: () => Promise<Blob>, fileName: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      downloadBlob(await fetch(), fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the PDF');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, download };
}

function Missing({ what, error, retry }: { what: string; error?: Error; retry: () => void }) {
  return error instanceof ApiError && error.status === 404 ? (
    <EmptyState title={`${what} not found`} action={<ButtonLink to="/orders">Back to orders</ButtonLink>} />
  ) : (
    <ErrorState error={error ?? `Could not load the ${what.toLowerCase()}`} onRetry={retry} />
  );
}

export function ReceiptPage() {
  const { id = '' } = useParams();
  const receipt = useAsync(() => receiptsApi.get(id), [id]);
  const r = receipt.data;
  const pdf = usePdf(() => receiptsApi.pdf(id), `${r?.receiptNumber ?? 'receipt'}.pdf`);
  if (receipt.loading && !r) return <LoadingState label="Loading receipt…" />;
  if (receipt.error || !r) return <Missing what="Receipt" error={receipt.error} retry={receipt.reload} />;
  const firstOrder = r.allocations[0];
  return (
    <>
      <PageTop
        leading={<BackButton to={firstOrder ? `/orders/${firstOrder.orderId}` : '/orders'} label="Back" />}
        title={r.receiptNumber}
        actions={
          <>
            {r.customerId && (
              <ButtonLink to={`/customers/${r.customerId}`} variant="ghost">
                {r.customerSnapshot.name}
              </ButtonLink>
            )}
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer size={15} /> Print
            </Button>
            <Button variant="secondary" onClick={pdf.download} loading={pdf.busy}>
              <Download size={15} /> PDF
            </Button>
          </>
        }
      />
      {pdf.error && (
        <div className="no-print border-b border-line px-4 py-3 sm:px-6">
          <Alert tone="error">{pdf.error}</Alert>
        </div>
      )}
      <div className="print-plain bg-wash px-3 py-6 sm:px-8 sm:py-10">
        <ReceiptView receipt={r} />
      </div>
    </>
  );
}

export function ReturnPage() {
  const { id = '' } = useParams();
  const doc = useAsync(() => returnsApi.get(id), [id]);
  const r = doc.data;
  const pdf = usePdf(() => returnsApi.pdf(id), `${r?.returnNumber ?? 'return'}.pdf`);
  if (doc.loading && !r) return <LoadingState label="Loading return…" />;
  if (doc.error || !r) return <Missing what="Return" error={doc.error} retry={doc.reload} />;
  return (
    <>
      <PageTop
        leading={<BackButton to={`/orders/${r.orderId}`} label="Back to order" />}
        title={r.returnNumber}
        actions={
          <>
            <ButtonLink to={`/orders/${r.orderId}`} variant="ghost">
              Order {r.orderNumber}
            </ButtonLink>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer size={15} /> Print
            </Button>
            <Button variant="secondary" onClick={pdf.download} loading={pdf.busy}>
              <Download size={15} /> PDF
            </Button>
          </>
        }
      />
      {pdf.error && (
        <div className="no-print border-b border-line px-4 py-3 sm:px-6">
          <Alert tone="error">{pdf.error}</Alert>
        </div>
      )}
      <div className="print-plain bg-wash px-3 py-6 sm:px-8 sm:py-10">
        <ReturnView doc={r} />
      </div>
    </>
  );
}
