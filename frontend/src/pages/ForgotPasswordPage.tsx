import { MailCheck } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { authApi } from '../api/endpoints';
import Button from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { Alert } from '../components/ui/States';
import { AuthLayout } from './LoginPage';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) return setError('Enter a valid email');
    setError(null);
    setFormError(null);
    setBusy(true);
    try {
      await authApi.forgotPassword(value);
      setSentTo(value);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthLayout title="Check your email">
        <div className="space-y-4 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#e6f2e1] text-[#2e7031]">
            <MailCheck size={20} />
          </span>
          <p className="text-[14px] text-ink-2">
            If an account exists for <strong className="text-ink">{sentTo}</strong>, we've sent a link to reset its password. It works once and
            expires in 30 minutes.
          </p>
          <p className="text-[13px] text-ink-3">Not there after a minute? Check your spam folder.</p>
          <div className="flex flex-col gap-2 pt-1">
            <Button variant="secondary" onClick={() => setSentTo(null)}>
              Use a different email
            </Button>
            <Link to="/login" className="text-[13.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
              Back to log in
            </Link>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password">
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-[13.5px] text-ink-3">Enter the email you sign in with and we'll send you a link to choose a new password.</p>
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField label="Email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} error={error ?? undefined} />
        <Button type="submit" className="w-full" loading={busy}>
          Send reset link
        </Button>
        <p className="text-center text-[13.5px] text-ink-3">
          Remembered it?{' '}
          <Link to="/login" className="text-ink underline-offset-2 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
