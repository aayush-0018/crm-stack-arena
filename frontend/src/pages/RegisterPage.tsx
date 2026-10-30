import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { authApi, shopApi } from '../api/endpoints';
import Button from '../components/ui/Button';
import { PasswordField, TextField } from '../components/ui/Field';
import LogoPicker from '../components/ui/LogoPicker';
import { Alert } from '../components/ui/States';
import { useAuth } from '../context/AuthContext';
import { zodErrors } from '../lib/zod';
import { registerSchema } from '../schemas';
import { AuthLayout } from './LoginPage';

type Values = { shopName: string; name: string; email: string; password: string };

export default function RegisterPage() {
  const { status, signIn, setShop } = useAuth();
  const [logo, setLogo] = useState<string | null>(null);
  const navigate = useNavigate();
  const [values, setValues] = useState<Values>({ shopName: '', name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const set = (k: keyof Values) => (e: { target: { value: string } }) => setValues({ ...values, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const r = registerSchema.safeParse(values);
    if (!r.success) return setErrors(zodErrors(r.error));
    setErrors({});
    setBusy(true);
    try {
      signIn(await authApi.register(r.data));
      if (logo) {
        // The account exists now; a logo hiccup shouldn't block sign-up (it can be added in Settings).
        await shopApi.uploadLogo(logo).then(setShop).catch(() => undefined);
      }
      navigate('/settings', { replace: true, state: { welcome: true } });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setFormError(err.message);
      } else setFormError('Could not create your account. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Create your shop account">
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField label="Shop name" required value={values.shopName} onChange={set('shopName')} error={errors.shopName} />
        <LogoPicker preview={logo} onPick={setLogo} onRemove={() => setLogo(null)} />
        <TextField label="Your name" required value={values.name} onChange={set('name')} error={errors.name} />
        <TextField
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={values.email}
          onChange={set('email')}
          error={errors.email}
        />
        <PasswordField
          label="Password"
          required
          autoComplete="new-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
          hint="At least 8 characters"
        />
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
        <p className="text-center text-[13.5px] text-ink-3">
          Already have an account?{' '}
          <Link to="/login" className="text-ink underline-offset-2 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
