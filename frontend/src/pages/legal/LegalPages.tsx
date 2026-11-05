import { Store } from 'lucide-react';
import { ReactNode, useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import LegalLinks from '../../components/layout/LegalLinks';
import { BUSINESS, isPlaceholder, LEGAL_LINKS } from '../../lib/legal';

/** A business detail; unfilled ones are highlighted so they get noticed before launch. */
function V({ k }: { k: keyof typeof BUSINESS }) {
  const v = BUSINESS[k];
  return isPlaceholder(v) ? <mark className="rounded bg-warn-bg-2 px-1 text-warn-text">{v}</mark> : <>{v}</>;
}

function Email({ k }: { k: 'supportEmail' | 'grievanceEmail' }) {
  const v = BUSINESS[k];
  return isPlaceholder(v) ? (
    <V k={k} />
  ) : (
    <a href={`mailto:${v}`} className="text-ink underline underline-offset-2">
      {v}
    </a>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 text-[16px] font-semibold text-ink">{children}</h2>;
}

function Layout({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · ${BUSINESS.brand}`;
    return () => {
      document.title = BUSINESS.brand;
    };
  }, [title]);
  return (
    <div className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-[760px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5 text-ink">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-ink text-on-ink">
              <Store size={16} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="text-[16px] font-semibold">{BUSINESS.brand}</span>
          </Link>
          <nav aria-label="Policies" className="flex flex-wrap gap-1">
            {LEGAL_LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) => `rounded-md px-2.5 py-1 text-[13px] ${isActive ? 'bg-ink text-on-ink' : 'text-ink-2 hover:bg-hover'}`}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="rounded-2xl border border-line bg-surface px-5 py-7 text-[14.5px] leading-relaxed text-ink-2 shadow-soft sm:px-10 sm:py-10 [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-2 [&_li]:mt-1.5 [&_p]:mt-3 [&_strong]:text-ink [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          <h1 className="text-[24px] font-semibold text-ink">{title}</h1>
          <p className="!mt-1 text-[13px] text-ink-3">Last updated {BUSINESS.lastUpdated}</p>
          {children}
        </main>
        <LegalLinks className="mt-6" />
      </div>
    </div>
  );
}

function Contact() {
  return (
    <ul>
      <li>
        <strong>Business:</strong> <V k="legalName" />, <V k="address" />
      </li>
      <li>
        <strong>Support:</strong> <Email k="supportEmail" />
      </li>
      <li>
        <strong>Grievance Officer:</strong> <V k="grievanceOfficer" />, <Email k="grievanceEmail" />
      </li>
    </ul>
  );
}

export function PrivacyPage() {
  return (
    <Layout title="Privacy Policy">
      <p>
        This policy explains what personal data {BUSINESS.brand} collects, why, and the choices you have. It is written to follow India’s Digital
        Personal Data Protection Act, 2023 (DPDP Act) and the rules made under it.
      </p>

      <H>Who is responsible</H>
      <p>
        {BUSINESS.brand} is run by <V k="legalName" />. We decide how account data is used, so for that data we are the “Data Fiduciary”.
      </p>
      <p>
        Shops use {BUSINESS.brand} to keep details of their own customers, guests and staff. For that data the <strong>shop</strong> is the Data
        Fiduciary and we only process it on the shop’s behalf. If you are a shop’s customer, please contact the shop first; they can correct or
        delete your details in {BUSINESS.brand}.
      </p>

      <H>What we collect</H>
      <ul>
        <li>
          <strong>Your account:</strong> your name, email and password (stored only as a secure hash), and when you accepted these policies.
        </li>
        <li>
          <strong>Your shop:</strong> shop name, address, phone, email, GSTIN and logo, which print on your invoices.
        </li>
        <li>
          <strong>What you enter:</strong> customers (name, mobile, and optionally email, address, notes), orders, invoices, payments, products,
          staff (name, mobile, wage, attendance) and expenses.
        </li>
        <li>
          <strong>Guests of a shop:</strong> when ordering from a table QR code or booking a table: name and mobile (email is optional). This goes to
          that shop.
        </li>
        <li>
          <strong>Security data:</strong> IP address, used briefly to stop repeated failed log-ins and abuse.
        </li>
      </ul>
      <p>
        We collect only what the app needs to work. We do <strong>not</strong> use analytics, advertising or tracking tools, and we never sell
        personal data.
      </p>

      <H>Why we use it</H>
      <ul>
        <li>To run your account: billing, invoices, stock, reports and everything else you use in the app.</li>
        <li>To send emails you ask for, such as password reset links.</li>
        <li>To keep the service secure and to follow the law.</li>
      </ul>
      <p>
        We rely on your consent, given when you create an account, and on uses the law allows. You can withdraw consent at any time by deleting
        your account; this does not affect what was done before.
      </p>

      <H>Who we share it with</H>
      <p>Only with service providers that host and run {BUSINESS.brand} for us, under their own data-protection terms:</p>
      <ul>
        <li>Vercel (website hosting)</li>
        <li>Render (application servers)</li>
        <li>Supabase (database)</li>
        <li>Brevo or Resend (sending emails)</li>
      </ul>
      <p>
        These providers may store data outside India. When you tap a WhatsApp, Google Maps or Google review button, that app opens with the details
        shown; we do not send data to them ourselves. We may share data if the law or a government authority requires it.
      </p>

      <H>How long we keep it</H>
      <ul>
        <li>Your account and shop data: while your account is open.</li>
        <li>
          When you delete your account, every branch only you own is deleted with all its data at once. Copies in our providers’ backups expire on
          their normal schedule.
        </li>
        <li>
          When a shop deletes a customer who has orders, the customer’s name, mobile, email, address and notes are erased. The sale itself stays,
          because tax law requires shops to keep sales records.
        </li>
      </ul>

      <H>Your rights</H>
      <p>Under the DPDP Act you can:</p>
      <ul>
        <li>see what personal data we hold about you;</li>
        <li>correct or update it (most of it you can change yourself in Settings);</li>
        <li>
          have it erased: delete your account any time from <strong>Settings → Privacy → Delete account</strong>;
        </li>
        <li>raise a complaint with our Grievance Officer, and if not satisfied, with the Data Protection Board of India;</li>
        <li>nominate someone to use these rights for you if you die or cannot act.</li>
      </ul>
      <p>
        Write to <Email k="grievanceEmail" />. We reply within 30 days.
      </p>

      <H>Security</H>
      <p>
        Data travels over encrypted connections (HTTPS). Passwords are stored as hashes we cannot read. Each branch can see only its own data, and
        only owners can delete records or change settings.
      </p>

      <H>Children</H>
      <p>{BUSINESS.brand} accounts are for adults (18+) running a business.</p>

      <H>Changes</H>
      <p>If we change this policy we will update the date above, and tell account holders by email or in the app before major changes apply.</p>

      <H>Contact</H>
      <Contact />
    </Layout>
  );
}

export function TermsPage() {
  return (
    <Layout title="Terms and Conditions">
      <p>
        These terms are an agreement between you and <V k="legalName" /> (“we”) for using {BUSINESS.brand}. By creating an account you accept them
        and our <Link to="/privacy">Privacy Policy</Link>.
      </p>

      <H>The service</H>
      <p>
        {BUSINESS.brand} is software for shops to manage customers, orders, invoices, payments, stock, staff and reports. We may improve or change
        features over time.
      </p>

      <H>Your account</H>
      <ul>
        <li>You must be 18 or older and able to make a contract for your business.</li>
        <li>Give correct details and keep your password secret. You are responsible for what happens under your account and your staff logins.</li>
        <li>Tell us at once if you think someone else has used your account.</li>
      </ul>

      <H>Your data and your customers</H>
      <ul>
        <li>The data you enter stays yours. You allow us to store and process it only to provide the service.</li>
        <li>
          You are responsible for having a lawful reason to keep your customers’, guests’ and staff’s details, for telling them how you use them, and
          for deleting them when asked or no longer needed.
        </li>
        <li>
          Invoices, GST figures and reports are worked out from what you enter. Check them, and confirm tax matters with your accountant before
          filing. You are responsible for your own tax and legal compliance.
        </li>
        <li>Only send WhatsApp messages and offers to people who agreed to hear from you.</li>
      </ul>

      <H>Fair use</H>
      <p>Do not use {BUSINESS.brand} to:</p>
      <ul>
        <li>break any law, or store data you have no right to hold;</li>
        <li>send spam, or post fake reviews or misleading claims;</li>
        <li>try to access other shops’ data, overload the service, or copy or reverse-engineer it.</li>
      </ul>

      <H>Free trial and payment</H>
      <p>
        New accounts get a <V k="trialDays" />-day free trial. After that, continuing needs a paid plan at the price shown before you pay. See the{' '}
        <Link to="/refunds">Refund and Cancellation Policy</Link>.
      </p>

      <H>Availability</H>
      <p>
        We work to keep {BUSINESS.brand} running and your data safe, but it is provided “as is”. There may be short interruptions for maintenance
        or reasons outside our control. Keep your own copies of important records (CSV and PDF exports are available).
      </p>

      <H>Liability</H>
      <p>
        To the extent the law allows, we are not liable for indirect losses such as lost profit or business. Our total liability for any claim is
        limited to what you paid us in the 3 months before it arose. Nothing here limits rights you have under consumer law.
      </p>

      <H>Ending the agreement</H>
      <p>
        You can stop at any time by deleting your account in Settings. We may suspend or close accounts that break these terms, after telling you
        why where we can.
      </p>

      <H>Law and disputes</H>
      <p>
        These terms are governed by the laws of India. Please contact us first so we can try to resolve any problem. Otherwise, the courts at{' '}
        <V k="jurisdiction" /> have jurisdiction.
      </p>

      <H>Changes</H>
      <p>We may update these terms. We will tell account holders before major changes take effect; using the service after that means you accept them.</p>

      <H>Contact and grievances</H>
      <Contact />
    </Layout>
  );
}

export function RefundPage() {
  return (
    <Layout title="Refund and Cancellation Policy">
      <H>Free trial</H>
      <p>
        Every new account starts with a <V k="trialDays" />
        -day free trial. Nothing is charged during the trial. If you don’t choose a paid plan, your account simply stops at the end of the trial;
        you can still delete it from Settings.
      </p>

      <H>Paid plans</H>
      <ul>
        <li>The price, billing period and taxes are shown before you pay. Plans are paid in advance.</li>
        <li>You can cancel any time. You keep access until the end of the period you have paid for, and you are not charged again.</li>
      </ul>

      <H>Refunds</H>
      <p>We give a full refund when:</p>
      <ul>
        <li>you were charged twice or charged by mistake;</li>
        <li>you were charged after you had cancelled; or</li>
        <li>the service was unavailable for most of a period you paid for because of a fault on our side.</li>
      </ul>
      <p>
        Otherwise, payments for a period already started are not refunded. Ask for a refund by writing to <Email k="supportEmail" /> within 30
        days of the charge. Approved refunds go back to the original payment method within 7 working days.
      </p>

      <H>Purchases from shops</H>
      <p>
        Shops use {BUSINESS.brand} to bill their own customers. Refunds for things you bought from a shop are decided by that shop, under its own
        policy; please contact the shop.
      </p>

      <H>Contact</H>
      <Contact />
    </Layout>
  );
}

const STORAGE: [string, string][] = [
  ['Sign-in', 'Keeps you logged in on this device until you log out.'],
  ['Theme', 'Remembers light or dark mode.'],
  ['Layout', 'Remembers the sidebar, which table columns you show, and which numbers you hid.'],
  ['Daily summary', 'Remembers the day’s summary so it shows once.'],
  ['Guest details', 'When a guest orders from a table or books one, remembers their name and mobile on their own phone for next time.'],
  ['Table game', 'Keeps a guest in the same game session while they play.'],
];

export function CookiesPage() {
  return (
    <Layout title="Cookie Policy">
      <p>
        {BUSINESS.brand} does <strong>not</strong> use cookies for tracking, analytics or advertising, and loads no third-party trackers.
      </p>
      <p>
        To work, it saves a few small items in your browser’s storage on your own device. These are strictly necessary for features you use, so no
        consent banner is needed. Nothing here is shared with anyone.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-line-strong">
              <th className="py-2 pr-4 font-medium text-ink">What</th>
              <th className="py-2 font-medium text-ink">Why</th>
            </tr>
          </thead>
          <tbody>
            {STORAGE.map(([what, why]) => (
              <tr key={what} className="border-b border-line align-top">
                <td className="py-2 pr-4 text-ink">{what}</td>
                <td className="py-2">{why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        You can clear these at any time in your browser’s settings (site data). You will then need to log in again. If we ever add analytics, we
        will ask for your consent first and update this page.
      </p>
      <H>Contact</H>
      <Contact />
    </Layout>
  );
}
