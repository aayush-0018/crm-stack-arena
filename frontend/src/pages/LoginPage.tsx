import { FormEvent, ReactNode, useState } from 'react';
import { Store } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { authApi } from '../api/endpoints';
import Button from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { Alert } from '../components/ui/States';
import { useAuth } from '../context/AuthContext';
import { zodErrors } from '../lib/zod';
import { loginSchema } from '../schemas';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-ink text-white">
            <Store size={19} strokeWidth={1.8} />
          </span>
          <div className="text-center">
            <h1 className="text-[20px] font-semibold text-ink">Shop CRM</h1>
            <p className="mt-0.5 text-[14px] text-ink-3">{title}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 shadow-soft">{children}</div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const r = loginSchema.safeParse(values);
    if (!r.success) return setErrors(zodErrors(r.error));
    setErrors({});
    setBusy(true);
    try {
      signIn(await authApi.login(r.data));
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Log in to your shop">
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(e) => setValues({ ...values, email: e.target.value })}
          error={errors.email}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={(e) => setValues({ ...values, password: e.target.value })}
          error={errors.password}
        />
        <Button type="submit" className="w-full" loading={busy}>
          Log in
        </Button>
        <p className="text-center text-[13.5px] text-ink-3">
          New here?{' '}
          <Link to="/register" className="text-ink underline-offset-2 hover:underline">
            Create your shop
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
