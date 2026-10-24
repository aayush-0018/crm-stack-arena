import { Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { invoicesApi } from '../../api/endpoints';
import InvoiceView from '../../components/invoices/InvoiceView';
import BackButton from '../../components/ui/BackButton';
import { InvoiceBadge } from '../../components/ui/Badge';
import Button, { ButtonLink } from '../../components/ui/Button';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { useAsync } from '../../lib/hooks';

export default function InvoicePreviewPage() {
  const { id = '' } = useParams();
  const invoice = useAsync(() => invoicesApi.get(id), [id]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  if (invoice.loading && !invoice.data) return <LoadingState label="Loading invoice…" />;
  if (invoice.error || !invoice.data) {
    const notFound = invoice.error instanceof ApiError && invoice.error.status === 404;
    return notFound ? (
      <EmptyState title="Invoice not found" action={<ButtonLink to="/invoices">Back to invoices</ButtonLink>} />
    ) : (
      <ErrorState error={invoice.error ?? 'Could not load invoice'} onRetry={invoice.reload} />
    );
  }
  const inv = invoice.data;

  const downloadPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const blob = await invoicesApi.pdf(inv.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${inv.invoiceNumber}${inv.revision > 1 ? `-R${inv.revision}` : ''}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Could not generate the PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <>
      <PageTop
        leading={<BackButton to="/invoices" label="Back to invoices" />}
        title={
          <span className="flex items-center gap-2.5">
            {inv.invoiceNumber}
            <InvoiceBadge status={inv.status} />
          </span>
        }
        actions={
          <>
            <ButtonLink to={`/orders/${inv.orderId}`} variant="ghost">
              Order {inv.orderSnapshot.orderNumber}
            </ButtonLink>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer size={15} /> Print
            </Button>
            <Button onClick={downloadPdf} loading={pdfBusy}>
              <Download size={15} /> Download PDF
            </Button>
          </>
        }
      />

      {(inv.status !== 'issued' || pdfError) && (
        <div className="no-print space-y-2 border-b border-line px-4 py-3 sm:px-6">
          {inv.status !== 'issued' && (
            <Alert tone="warning">
              This invoice is {inv.status}.{' '}
              <Link className="underline" to={`/orders/${inv.orderId}`}>
                Open the order
              </Link>{' '}
              to see the current invoice.
            </Alert>
          )}
          {pdfError && (
            <Alert tone="error">
              {pdfError}{' '}
              <button className="font-medium underline" onClick={downloadPdf}>
                Retry
              </button>
            </Alert>
          )}
        </div>
      )}

      <div className="print-plain bg-[#fafaf8] px-3 py-6 sm:px-8 sm:py-10">
        <InvoiceView invoice={inv} />
      </div>
    </>
  );
}
