import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { apiOrigin } from '../api/client';

/** The link in bill emails: opens the invoice PDF from the API (whose address can differ from this site's). */
export default function BillPage() {
  const { token = '' } = useParams();
  const url = `${apiOrigin()}/api/public/invoices/${encodeURIComponent(token)}/pdf`;
  useEffect(() => {
    window.location.replace(url);
  }, [url]);
  return (
    <div className="theme-light flex min-h-screen items-center justify-center bg-[#faf8f4] px-6 text-center text-[15px] text-[#5e574c]">
      <p>
        Opening your bill… <a href={url} className="underline">Tap here</a> if it doesn't open.
      </p>
    </div>
  );
}
