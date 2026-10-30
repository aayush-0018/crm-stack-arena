import { Check, Copy, Download, Mail, MessageCircle, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiOrigin } from '../../api/client';
import { invoicesApi } from '../../api/endpoints';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../lib/date';
import { formatINR } from '../../lib/money';
import type { Invoice, InvoiceShare, ShareChannel } from '../../types';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import { controlClass } from '../ui/Field';
import { Modal } from '../ui/Modal';
import Spinner from '../ui/Spinner';
import { Alert } from '../ui/States';

const CHANNEL_LABEL: Record<ShareChannel, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  share: 'Shared PDF file',
  link: 'Copied link',
  download: 'Downloaded PDF',
};

const fileName = (inv: Invoice) => `${inv.invoiceNumber}${inv.revision > 1 ? `-R${inv.revision}` : ''}.pdf`;

/** Native share sheet with a real PDF file — phones (Android, iOS) and Safari on Mac. */
const canShareFiles = () => {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
};

function defaultMessage(inv: Invoice, url: string) {
  const first = inv.customerSnapshot.name.split(' ')[0];
  const balance = inv.totalPaise - inv.amountPaidPaise;
  return [
    `Namaste ${first} ji,`,
    '',
    `Here is your invoice ${inv.invoiceNumber} from ${inv.shopSnapshot.name} for ${formatINR(inv.totalPaise)}.`,
    balance > 0 ? `Balance due: ${formatINR(balance)}.` : 'Paid in full. Thank you!',
    '',
    `Download the PDF: ${url}`,
  ].join('\n');
}

/**
 * Sends an issued invoice to its customer. Every channel opens the customer's own app
 * (WhatsApp, mail, share sheet) — this app never sends messages itself.
 * The PDF travels as a private link that unlocks this one invoice only.
 */
export default function SendInvoiceModal({
  invoiceId,
  open,
  onClose,
  outdated,
}: {
  invoiceId: number;
  open: boolean;
  onClose: () => void;
  outdated?: boolean;
}) {
  const toast = useToast();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [shares, setShares] = useState<InvoiceShare[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const shareable = canShareFiles();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setCopied(false);
    setConfirmReset(false);
    Promise.all([invoicesApi.get(invoiceId), invoicesApi.shareLink(invoiceId)])
      .then(([invoice, { token }]) => {
        if (cancelled) return;
        const link = `${apiOrigin()}/api/public/invoices/${token}/pdf`;
        setInv(invoice);
        setShares(invoice.shares);
        setUrl(link);
        setMessage(defaultMessage(invoice, link));
        // Fetch the file up front: the share sheet must open straight from the click.
        if (shareable) {
          invoicesApi
            .pdf(invoiceId)
            .then((blob) => !cancelled && setPdfFile(new File([blob], fileName(invoice), { type: 'application/pdf' })))
            .catch(() => undefined);
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId]);

  const log = (channel: ShareChannel, recipient?: string | null) =>
    invoicesApi
      .logShare(invoiceId, channel, recipient)
      .then(setShares)
      .catch(() => undefined);

  const blocked = inv && inv.status !== 'issued';
  const localOnly = url && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url);
  const c = inv?.customerSnapshot;

  const sendWhatsApp = () => {
    if (!c) return;
    // Walk-in sales have no number: WhatsApp then asks who to send it to.
    window.open(`https://wa.me/${c.phone ? `91${c.phone}` : ''}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
    log('whatsapp', c.phone);
  };

  const sendEmail = () => {
    if (!c?.email || !inv) return;
    const a = document.createElement('a');
    a.href = `mailto:${c.email}?subject=${encodeURIComponent(`Invoice ${inv.invoiceNumber} from ${inv.shopSnapshot.name}`)}&body=${encodeURIComponent(message)}`;
    a.click();
    log('email', c.email);
  };

  const shareFile = async () => {
    if (!pdfFile || !inv) return;
    try {
      await navigator.share({ files: [pdfFile], title: `Invoice ${inv.invoiceNumber}`, text: message });
      log('share');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('error', 'Could not open the share sheet');
    }
  };

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      log('link');
    } catch {
      toast('error', 'Could not copy — select the link and copy it manually');
    }
  };

  // Two clicks: links already sent to customers stop working once it's reset.
  const resetLink = async () => {
    if (!confirmReset) return setConfirmReset(true);
    setConfirmReset(false);
    try {
      const { token } = await invoicesApi.resetShareLink(invoiceId);
      const link = `${apiOrigin()}/api/public/invoices/${token}/pdf`;
      if (url) setMessage((m) => m.split(url).join(link));
      setUrl(link);
      setCopied(false);
      toast('success', 'New link ready. The old link no longer opens this invoice.');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not reset the link');
    }
  };

  const download = async () => {
    if (!inv) return;
    try {
      const blob = pdfFile ?? (await invoicesApi.pdf(invoiceId));
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName(inv);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      log('download');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not download the PDF');
    }
  };

  return (
    <Modal open={open} title={inv ? `Send ${inv.invoiceNumber}` : 'Send invoice'} onClose={onClose} wide>
      {error ? (
        <div className="pb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : !inv || !url || !c ? (
        <div className="flex items-center gap-2 py-8 text-ink-3">
          <Spinner className="h-4 w-4" /> Preparing the invoice…
        </div>
      ) : (
        <div className="space-y-4 pb-5">
          <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
            <Avatar name={c.name} size={32} />
            <div className="min-w-0 text-[13.5px]">
              <p className="truncate font-medium text-ink">{c.name}</p>
              <p className="truncate text-ink-3">
                {c.phone}
                {c.email ? ` · ${c.email}` : ''}
              </p>
            </div>
            <span className="ml-auto text-[13.5px] tabular-nums text-ink">{formatINR(inv.totalPaise)}</span>
          </div>

          {blocked && (
            <Alert tone="warning">
              This invoice is {inv.status}, so it can't be sent.{' '}
              <Link to={`/orders/${inv.orderId}`} className="underline" onClick={onClose}>
                Open the order
              </Link>{' '}
              to send the current one.
            </Alert>
          )}
          {!blocked && outdated && (
            <Alert tone="warning">
              The order changed after this invoice was issued, so it shows old amounts. Reissue it from the order first if the customer
              should see the new ones.
            </Alert>
          )}
          {!blocked && localOnly && (
            <Alert tone="info">
              You're running locally, so this link only opens on this computer. Customers can open it once the app is deployed.
            </Alert>
          )}

          {!blocked && (
            <>
              <div>
                <label htmlFor="send-message" className="mb-1.5 block text-[13px] font-medium text-ink-2">
                  Message
                </label>
                <textarea
                  id="send-message"
                  rows={7}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className={controlClass(false, 'resize-none py-2 text-[13.5px] leading-relaxed')}
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button onClick={sendWhatsApp} className="w-full">
                  <MessageCircle size={15} /> Send on WhatsApp
                </Button>
                <Button
                  variant="secondary"
                  onClick={sendEmail}
                  disabled={!c.email}
                  title={c.email ? undefined : 'No email saved for this customer'}
                  className="w-full"
                >
                  <Mail size={15} /> {c.email ? 'Send by email' : 'No email on file'}
                </Button>
                {shareable && (
                  <Button variant="secondary" onClick={shareFile} disabled={!pdfFile} className="w-full sm:col-span-2">
                    <Share2 size={15} /> {pdfFile ? 'Share PDF file…' : 'Preparing PDF…'}
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input readOnly value={url} aria-label="Invoice link" onFocus={(e) => e.target.select()} className={controlClass(false, 'h-8 flex-1 truncate text-[12.5px] text-ink-2')} />
                <Button size="sm" variant="secondary" onClick={copyLink}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy link'}
                </Button>
                <Button size="sm" variant="ghost" onClick={download} aria-label="Download PDF">
                  <Download size={15} />
                </Button>
              </div>
              <p className="-mt-2 text-[12px] text-ink-3">
                Anyone with this link can download this one invoice — no login needed. It doesn't open anything else in your shop.{' '}
                <button type="button" className="text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={resetLink}>
                  {confirmReset ? 'Click again to reset: links already sent will stop working' : 'Reset link'}
                </button>
              </p>
            </>
          )}

          {shares.length > 0 && (
            <div className="border-t border-line pt-3">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Sent</p>
              <ul className="space-y-1 text-[13px]">
                {shares.map((s, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="text-ink">
                      {CHANNEL_LABEL[s.channel]}
                      {s.recipient ? <span className="text-ink-3"> · {s.recipient}</span> : null}
                    </span>
                    <span className="shrink-0 text-ink-3">{formatDateTime(s.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
