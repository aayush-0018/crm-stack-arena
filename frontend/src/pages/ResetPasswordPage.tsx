import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { authApi } from '../api/endpoints';
import { ButtonLink } from '../components/ui/Button';
import Button from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { Alert, LoadingState } from '../components/ui/States';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { AuthLayout } from './LoginPage';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const toast = useToast();
  const { signIn } = useAuth();
  const [check, setCheck] = useState<{ valid: boolean; email?: string } | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return setCheck({ valid: false });
    authApi
      .checkResetToken(token)
      .then(setCheck)
      .catch(() => setCheck({ valid: false }));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v: Record<string, string> = {};
    if (password.length < 8) v.password = 'Use at least 8 characters';
    if (again !== password) v.again = "Passwords don't match";
    setErrors(v);
    if (Object.keys(v).length) return;
    setFormError(null);
    setBusy(true);
    try {
      signIn(await authApi.resetPassword(token, password));
      toast('success', 'Password changed. Other devices have been signed out.');
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_TOKEN') setCheck({ valid: false });
      else setFormError(err instanceof Error ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  };

  if (!check) return <LoadingState label="Checking your link…" />;

  if (!check.valid) {
    return (
      <AuthLayout title="Link expired">
        <div className="space-y-4 text-center">
          <p className="text-[14px] text-ink-2">This reset link is invalid, already used, or older than 30 minutes. Request a new one — it only takes a moment.</p>
          <ButtonLink to="/forgot-password" className="w-full">
            Send a new link
          </ButtonLink>
          <Link to="/login" className="block text-[13.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            Back to log in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={submit} noValidate className="space-y-4">
        {check.email && <p className="text-[13.5px] text-ink-3">For {check.email}</p>}
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint="At least 8 characters"
        />
        <TextField label="Repeat new password" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} error={errors.again} />
        <Button type="submit" className="w-full" loading={busy}>
          Change password and log in
        </Button>
        <p className="text-center text-[12.5px] text-ink-3">This signs you out on every other device.</p>
      </form>
    </AuthLayout>
  );
}
