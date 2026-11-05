import { useState } from 'react';
import { ApiError } from '../../api/client';
import { complaintsApi, type ComplaintTopic } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { BUSINESS } from '../../lib/legal';
import Button from '../ui/Button';
import { SelectField, TextAreaField, TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Alert } from '../ui/States';

/** A small "Complaints" link that opens a short form. Saved and emailed to the Grievance Officer. */
export default function ComplaintLink({ className = '', label = 'Complaints' }: { className?: string; label?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ topic: 'other' as ComplaintTopic, name: '', email: '', message: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  const show = () => {
    setForm({ topic: 'other', name: user?.name ?? '', email: user?.email ?? '', message: '' });
    setErrors({});
    setError(null);
    setReference(null);
    setOpen(true);
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const send = async () => {
    const err: Record<string, string> = {};
    if (!form.name.trim()) err.name = 'Enter your name';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) err.email = 'Enter a valid email';
    if (form.message.trim().length < 10) err.message = 'Please describe the problem (at least 10 characters)';
    setErrors(err);
    if (Object.keys(err).length) return;
    setBusy(true);
    setError(null);
    try {
      setReference((await complaintsApi.send(form)).reference);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      else setError(e instanceof ApiError ? e.message : `Could not send. Please email ${BUSINESS.grievanceEmail}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={show} className={`underline-offset-2 hover:text-ink hover:underline ${className}`}>
        {label}
      </button>
      <Modal
        open={open}
        title={reference ? 'Complaint sent' : 'Raise a complaint'}
        onClose={() => !busy && setOpen(false)}
        footer={
          reference ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={send} loading={busy}>
                Send
              </Button>
            </>
          )
        }
      >
        {reference ? (
          <p className="text-[14px] text-ink-2">
            Thank you. Your reference is <strong className="text-ink">{reference}</strong>. We reply by email within 30 days.
          </p>
        ) : (
          <form
            className="space-y-3.5 text-left"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            {error && <Alert tone="error">{error}</Alert>}
            <SelectField label="About" value={form.topic} onChange={set('topic')}>
              <option value="privacy">Privacy / my personal data</option>
              <option value="billing">Billing or refund</option>
              <option value="other">Something else</option>
            </SelectField>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <TextField label="Your name" required value={form.name} maxLength={80} onChange={set('name')} error={errors.name} />
              <TextField label="Email for our reply" required type="email" value={form.email} maxLength={254} onChange={set('email')} error={errors.email} />
            </div>
            <TextAreaField label="What went wrong?" required value={form.message} maxLength={2000} onChange={set('message')} error={errors.message} rows={4} />
            <p className="text-[12px] text-ink-3">Goes to our Grievance Officer, {BUSINESS.grievanceOfficer}.</p>
            <button type="submit" hidden />
          </form>
        )}
      </Modal>
    </>
  );
}
