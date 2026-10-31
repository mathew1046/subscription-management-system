'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/client';
import { credentials, registration, resetComplete, resetRequest } from '@/lib/contracts';
import { Button, Field, Notice, Panel } from '@/components/ui';

type Mode = 'login' | 'signup' | 'forgot' | 'reset';
const passwordHelp = 'Use at least 9 characters, including an uppercase letter, a lowercase letter and a special character (for example, ! or @). Maximum 128 UTF-8 bytes.';
const titles = { login: 'Welcome back', signup: 'Create your account', forgot: 'Reset your password', reset: 'Choose a new password' };
const labels = { login: 'Sign in', signup: 'Create account', forgot: 'Request reset link', reset: 'Save new password' };

export function AuthForm({ mode }: { mode: Mode }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [complete, setComplete] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [tokenState, setTokenState] = useState<'loading' | 'ready' | 'invalid'>('loading');
  const [expiredSession, setExpiredSession] = useState(false);
  const token = useRef('');
  const inFlight = useRef(false);

  useEffect(() => {
    if (mode === 'reset') {
      token.current = new URLSearchParams(window.location.search).get('token') || '';
      setTokenState(resetComplete.shape.token.safeParse(token.current).success ? 'ready' : 'invalid');
    }
    if (mode === 'login') setExpiredSession(new URLSearchParams(window.location.search).get('reason') === 'session-expired');
    return () => { token.current = ''; };
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || complete || uncertain || (mode === 'reset' && tokenState !== 'ready')) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = String(fields.get('email') || '');
    const password = String(fields.get('password') || '');
    const parsed = mode === 'signup'
      ? registration.safeParse({ name: String(fields.get('name') || ''), email, password })
      : mode === 'login' ? credentials.safeParse({ email, password })
      : mode === 'forgot' ? resetRequest.safeParse({ email })
      : resetComplete.safeParse({ token: token.current, password });
    setError('');
    setMessage('');
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        next[key] = key === 'password' && mode !== 'login' ? passwordHelp
          : key === 'email' ? 'Enter a valid email address (up to 254 characters).'
          : key === 'name' ? 'Enter your name (up to 200 characters).'
          : key === 'token' ? 'This reset link is invalid. Request a new link.' : 'Enter your password (up to 128 characters).';
      }
      setErrors(next);
      setError('Check the highlighted fields. Your entries have been kept.');
      form.querySelector<HTMLInputElement>(`[name="${Object.keys(next)[0]}"]`)?.focus();
      return;
    }
    setErrors({});
    inFlight.current = true;
    setBusy(true);
    try {
      if (mode === 'login') {
        const user = await api.login(credentials.parse({ email, password }));
        setComplete(true);
        window.location.assign(user.role === 'customer' ? '/portal/subscriptions' : '/');
        return;
      }
      if (mode === 'signup') {
        await api.signup(registration.parse({ name: String(fields.get('name') || ''), email, password }));
        setMessage('Account created. Sign in to continue. Your agreements will appear when staff create them for your customer record.');
      } else if (mode === 'forgot') {
        await api.forgotPassword(resetRequest.parse({ email }).email);
        setMessage('If an account exists for this email address, a reset link has been queued for email delivery. Check your inbox and spam folder. Queueing does not guarantee delivery.');
      } else {
        await api.resetPassword(token.current, password);
        token.current = '';
        const url = new URL(window.location.href);
        url.searchParams.delete('token');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
        setMessage('Password updated. All previous sessions have ended. Sign in with your new password.');
      }
      form.reset();
      setShowPassword(false);
      setComplete(true);
    } catch (cause) {
      const ambiguous = cause instanceof ApiError && (cause.code === 'UNAVAILABLE' || cause.code === 'TIMEOUT' || cause.status >= 500);
      if (ambiguous) {
        setUncertain(true);
        setError('The result could not be confirmed. Do not submit again yet. Try signing in to check your account, or explicitly reload this page before deciding whether another request is needed.');
      } else if (cause instanceof ApiError && cause.code === 'INVALID_TOKEN') {
        token.current = '';
        setTokenState('invalid');
        setError('This reset link is invalid, expired or already used. Request a new reset link.');
      } else if (cause instanceof ApiError && cause.status === 401) {
        setError(mode === 'login' ? 'The email address or password is incorrect. Check your entries or request a password reset.' : 'Your session has expired. Sign in again before continuing.');
        if (mode !== 'login') window.location.replace('/login?reason=session-expired');
      } else setError(cause instanceof Error ? cause.message : 'The request failed. Your entries have been kept. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const invalidReset = mode === 'reset' && tokenState === 'invalid';
  return <div className="auth"><Panel title={titles[mode]}>
    <h1 className="sr-only">{titles[mode]}</h1>
    {expiredSession && <Notice>Your session expired. Sign in again to continue.</Notice>}
    {mode === 'forgot' && !complete && <p>Enter your account email to request a one-use link. Reset links expire after 30 minutes.</p>}
    {mode === 'signup' && !complete && <p>Create a customer account. You will sign in separately after signup.</p>}
    {mode === 'reset' && tokenState === 'loading' ? <Notice>Reading your reset link…</Notice> : invalidReset ? <Notice error>This reset link is missing, invalid, expired or already used. Request a new link below.</Notice> : !complete && <form onSubmit={submit} noValidate aria-busy={busy}>
      <fieldset disabled={busy || uncertain}>
        {mode === 'signup' && <><Field label="Full name" name="name" autoComplete="name" required maxLength={200} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'auth-name-error' : undefined} />{errors.name && <p className="field-error" id="auth-name-error">{errors.name}</p>}</>}
        {mode !== 'reset' && <><Field label="Email address" name="email" type="email" autoComplete={mode === 'login' ? 'username' : 'email'} autoCapitalize="none" spellCheck={false} required maxLength={254} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'auth-email-error' : undefined} />{errors.email && <p className="field-error" id="auth-email-error">{errors.email}</p>}</>}
        {mode !== 'forgot' && <>
          <Field label={mode === 'reset' ? 'New password' : 'Password'} name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required aria-invalid={!!errors.password} aria-describedby={mode === 'login' ? (errors.password ? 'auth-password-error' : undefined) : 'auth-password-help auth-password-error'} />
          <Button type="button" variant="ghost" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide password' : 'Show password'}</Button>
          {mode !== 'login' && <p className="field-help" id="auth-password-help">{passwordHelp}</p>}
          <p className="field-error" id="auth-password-error">{errors.password || ''}</p>
        </>}
      </fieldset>
      <Button type="submit" disabled={busy || uncertain}>{busy ? 'Please wait…' : labels[mode]}</Button>
    </form>}
    {error && <Notice error>{error}</Notice>}
    {message && <Notice>{message}</Notice>}
    {uncertain && <Button type="button" variant="secondary" onClick={() => window.location.reload()}>Reload before another request</Button>}
    <nav className="actions" aria-label="Account options">
      {(mode !== 'login' || complete || uncertain) && <Link href="/login">Sign in</Link>}
      {mode === 'login' && <Link href="/signup">Create account</Link>}
      {mode !== 'forgot' && <Link href="/forgot-password">{mode === 'reset' ? 'Request a new reset link' : 'Forgot password?'}</Link>}
    </nav>
  </Panel></div>;
}
