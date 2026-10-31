'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {z} from 'zod';
import {api, ApiError} from '@/lib/client';
import {paymentInput, type InvoiceDetail, type Payment} from '@/lib/contracts';
import {Button, ConfirmDialog, Field, Notice, Panel, Select, Textarea} from '@/components/ui';
import {ambiguous, compareMoney, errorMessage, methods, SignInRecovery, utcToday} from './helpers';

type Payload = z.output<typeof paymentInput>;
const savedIntent = z.object({
  version: z.literal(1), user_id: z.string().uuid(),
  state: z.enum(['review', 'uncertain', 'conflict', 'rejected', 'completed']),
  payload: paymentInput,
}).strict();
type Intent = z.output<typeof savedIntent>;
type Draft = Pick<Payload, 'amount' | 'method' | 'paid_on' | 'note'>;
type Props = {
  invoice: InvoiceDetail; userId: string; disabled: boolean;
  beginMutation: () => boolean; endMutation: () => void;
  refresh: () => Promise<InvoiceDetail | null>;
  onLockChange: (locked: boolean) => void;
};

function matches(payment: Payment, payload: Payload) {
  return payment.request_key.toLowerCase() === payload.request_key.toLowerCase()
    && payment.invoice_id.toLowerCase() === payload.invoice_id.toLowerCase()
    && compareMoney(payment.amount, payload.amount) === 0 && payment.method === payload.method
    && payment.paid_on === payload.paid_on && payment.note === payload.note;
}

export function ManualPayment({invoice, userId, disabled, beginMutation, endMutation, refresh, onLockChange}: Props) {
  const storageKey = `brightloop:manual-payment:v1:${userId}:${invoice.id}`;
  const [draft, setDraft] = useState<Draft>({amount: '', method: 'bank_transfer', paid_on: utcToday(), note: ''});
  const [intent, setIntent] = useState<Intent | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [failure, setFailure] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [validation, setValidation] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false), mounted = useRef(false);
  const intentRef = useRef<Intent | null>(null);

  function store(next: Intent): boolean {
    try {
      const serialized = JSON.stringify(next);
      sessionStorage.setItem(storageKey, serialized);
      if (sessionStorage.getItem(storageKey) !== serialized) throw new Error('Storage did not retain the payment intent.');
      setStorageError('');
      return true;
    } catch {
      setStorageError('Payment-intent storage is unavailable. No new request can be sent safely. Enable session storage and reload; keep any existing request key and exact payment details.');
      return false;
    }
  }
  function adopt(next: Intent | null) {intentRef.current = next; setIntent(next);}
  function clear(): boolean {
    try {
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error('Could not clear intent.');
      setStorageError(''); adopt(null); setFailure(null); setMessage(''); setValidation({});
      return true;
    } catch {setStorageError('The saved payment intent could not be cleared. Reload after enabling session storage; do not create a replacement request key.'); return false;}
  }
  useEffect(() => {
    mounted.current = true;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw !== null) {
        const parsed = savedIntent.safeParse(JSON.parse(raw));
        if (!parsed.success || parsed.data.user_id !== userId || parsed.data.payload.invoice_id !== invoice.id) throw new Error('Invalid saved intent.');
        const saved = parsed.data;
        intentRef.current = saved; setIntent(saved);
        setDraft({amount: saved.payload.amount, method: saved.payload.method, paid_on: saved.payload.paid_on, note: saved.payload.note});
        setMessage(saved.state === 'uncertain' ? 'A previous payment request may have committed. Its exact payload is preserved below. Refresh and reconcile, or deliberately resubmit only this same request.' : saved.state === 'conflict' ? 'This saved request key conflicts with recorded data. An operator must reconcile it; do not replace the key.' : saved.state === 'review' ? 'Your payment review was restored. No request was sent for this saved review.' : saved.state === 'completed' ? 'The API previously confirmed this payment. Refresh the ledger before starting another payment.' : 'A rejected payment was restored with all fields preserved. Review the invoice before revising it.');
      }
    } catch {
      setStorageError('The saved payment intent cannot be read safely. Payment entry is locked. Do not delete or replace an unknown intent; ask an operator to reconcile the invoice and original request key.');
    }
    setReady(true);
    return () => {mounted.current = false;};
    // This component is mounted for a single authenticated user and invoice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {onLockChange(!ready || Boolean(storageError) || Boolean(intent));}, [ready, storageError, intent, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);

  // Reconcile only against a backend-returned ledger. Absence is not proof of failure:
  // the original request could still be in flight, so an uncertain key is never discarded.
  useEffect(() => {
    const current = intentRef.current;
    if (!current || current.state === 'review' || current.state === 'completed') return;
    const recorded = invoice.payments.find(payment => payment.request_key.toLowerCase() === current.payload.request_key.toLowerCase());
    if (!recorded) return;
    if (!matches(recorded, current.payload)) {
      setFailure(new Error('The ledger contains this request key with different payment details. Do not replace the key or resubmit. An operator must reconcile this conflict.'));
      return;
    }
    const completed: Intent = {...current, state: 'completed'};
    adopt(completed); store(completed);
    setFailure(null); setMessage('Payment found in the server ledger with this exact request key and matching details. It has been recorded; do not submit it again.');
    // Re-run only for a new server invoice snapshot or a restored intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice, ready]);

  function review(event: FormEvent) {
    event.preventDefault();
    if (!ready || disabled || inFlight.current || intentRef.current || storageError) return;
    setFailure(null); setMessage('');
    const parsed = paymentInput.omit({request_key: true}).safeParse({...draft, invoice_id: invoice.id});
    const errors: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) {const field = String(issue.path[0] || 'form'); if (!errors[field]) errors[field] = issue.message;}
    if (draft.paid_on > utcToday()) errors.paid_on = 'Payment date cannot be in the future (UTC).';
    if (new TextEncoder().encode(draft.note).length > 2000) errors.note = 'Use at most 2,000 UTF-8 bytes for the note.';
    if (parsed.success && compareMoney(parsed.data.amount, invoice.balance) > 0) errors.amount = 'Amount exceeds the latest outstanding balance. Refresh if another payment changed it.';
    if (invoice.status !== 'Confirmed') errors.form = 'Only confirmed invoices with an outstanding balance accept new payments.';
    setValidation(errors);
    if (!parsed.success || Object.keys(errors).length) return;
    let key: string;
    try {key = crypto.randomUUID();} catch {setFailure(new Error('A secure payment request key could not be generated. Use a secure browser context and try again.')); return;}
    const next: Intent = {version: 1, user_id: userId, state: 'review', payload: {...parsed.data, request_key: key}};
    if (!store(next)) return;
    adopt(next); setDialog(true);
  }

  async function submit() {
    const current = intentRef.current;
    if (!current || (current.state !== 'review' && current.state !== 'uncertain') || disabled || storageError || inFlight.current) return;
    if (failure instanceof ApiError && failure.code === 'IDEMPOTENCY_MISMATCH') return;
    const existing = invoice.payments.find(payment => payment.request_key.toLowerCase() === current.payload.request_key.toLowerCase());
    if (existing) {setDialog(false); setFailure(new Error('This request key is already in the ledger. Reconcile the saved payment before submitting anything else.')); return;}
    if (current.state === 'review' && (invoice.status !== 'Confirmed' || compareMoney(current.payload.amount, invoice.balance) > 0)) {
      setDialog(false); setFailure(new Error('This payment no longer fits the latest confirmed balance. Return to editing; the saved review has not been submitted.')); return;
    }
    if (!beginMutation()) return;
    inFlight.current = true; setPending(true); setFailure(null); setMessage('');
    // Save BEFORE the write. A reload at any later point must assume it committed.
    const attempted: Intent = {...current, state: 'uncertain'};
    if (!store(attempted)) {inFlight.current = false; setPending(false); setDialog(false); endMutation(); return;}
    adopt(attempted);
    const wasUncertain = current.state === 'uncertain';
    try {
      const payment = await api.recordPayment(current.payload);
      if (!mounted.current) return;
      if (!matches(payment, current.payload)) throw new Error('The payment response did not match the preserved intent. Reconcile the ledger before doing anything else.');
      const completed: Intent = {...current, state: 'completed'};
      adopt(completed); store(completed);
      setDialog(false);
      setMessage('Payment recorded by the API. Refreshing the invoice balance, payment ledger and saved status.');
      await refresh();
    } catch (cause) {
      if (!mounted.current) return;
      // A definite rejection of an exact retry cannot disprove an earlier ambiguous write.
      // Key mismatches always require reconciliation, even on the first attempt.
      const keyMismatch = cause instanceof ApiError && cause.code === 'IDEMPOTENCY_MISMATCH';
      const uncertain = wasUncertain || ambiguous(cause) || keyMismatch;
      const next: Intent = {...current, state: keyMismatch ? 'conflict' : uncertain ? 'uncertain' : 'rejected'};
      adopt(next); store(next); setDialog(false); setFailure(cause);
      setMessage(keyMismatch ? 'Request-key conflict. Keep the key and every field unchanged for operator reconciliation. Do not retry or create a replacement intent.' : uncertain ? 'Outcome uncertain. Keep this request key and every field unchanged. A refresh may find the payment; if it does not, only an exact resubmission is safe. There is no automatic retry.' : 'The API rejected this request. All fields are preserved. Refresh the balance before deliberately revising the rejected payment.');
      await refresh();
    } finally {
      inFlight.current = false; endMutation();
      if (mounted.current) setPending(false);
    }
  }

  async function reconcile() {
    if (disabled || inFlight.current) return;
    setMessage('Refreshing the server ledger. An absent request key does not by itself prove that an earlier request failed.');
    await refresh();
  }
  const locked = disabled || pending || !ready || Boolean(storageError);
  const editable = !intent;
  const canStart = invoice.status === 'Confirmed' && compareMoney(invoice.balance, '0') > 0;
  const recorded = intent ? invoice.payments.find(payment => matches(payment, intent.payload)) : undefined;
  const keyConflict = intent?.state === 'conflict' || (failure instanceof ApiError && failure.code === 'IDEMPOTENCY_MISMATCH') || Boolean(intent && invoice.payments.some(payment => payment.request_key.toLowerCase() === intent.payload.request_key.toLowerCase() && !matches(payment, intent.payload)));
  const fieldError = (name: string) => validation[name] ? <span className="field-error" id={`payment-${name}-error`} role="alert">{validation[name]}</span> : null;
  const aria = (name: string) => ({'aria-invalid': Boolean(validation[name]), 'aria-describedby': validation[name] ? `payment-${name}-error` : undefined});
  return <Panel title="Record a manual payment">
    <p>Record money already received. This form does not charge a card, move funds, refund or reverse a payment.</p>
    <dl className="detail-list"><div><dt>Invoice</dt><dd>{invoice.number}</dd></div><div><dt>Due (UTC)</dt><dd>{invoice.due_on}</dd></div><div><dt>Outstanding balance</dt><dd><strong>{invoice.currency} {invoice.balance}</strong></dd></div></dl>
    {!ready && <Notice>Restoring any saved payment intent…</Notice>}
    {storageError && <Notice error>{storageError}</Notice>}
    {message && <Notice>{message}</Notice>}
    {failure !== null && <><Notice error>{errorMessage(failure)}</Notice><SignInRecovery cause={failure}/></>}
    {validation.form && <Notice error>{validation.form}</Notice>}
    {!canStart && !intent && <Notice>{invoice.status === 'Draft' ? 'Confirm this draft invoice before recording payments.' : invoice.status === 'Cancelled' ? 'Cancelled invoices cannot accept payments.' : 'There is no payable confirmed balance on this invoice.'}</Notice>}
    <form onSubmit={review} aria-label={`Manual payment for ${invoice.number}`}>
      <fieldset disabled={locked || !editable || !canStart}>
        <legend>Payment received</legend>
        <div className="form-grid">
          <div><Field label={`Amount (${invoice.currency})`} type="text" inputMode="decimal" placeholder="0.00" required maxLength={15} value={draft.amount} onChange={event => setDraft({...draft, amount: event.target.value})} {...aria('amount')}/>{fieldError('amount')}</div>
          <Select label="Method" value={draft.method} onChange={event => setDraft({...draft, method: event.target.value as Payload['method']})}>{Object.entries(methods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
          <div><Field label="Paid on (UTC)" type="date" required max={utcToday()} value={draft.paid_on} onChange={event => setDraft({...draft, paid_on: event.target.value})} {...aria('paid_on')}/>{fieldError('paid_on')}</div>
          <div><Textarea label="Note (optional)" maxLength={2000} value={draft.note} onChange={event => setDraft({...draft, note: event.target.value})} {...aria('note')}/>{fieldError('note')}</div>
        </div>
        <p><small>Use a positive decimal amount with at most two decimal places and 12 whole digits. The backend validates the balance and prevents overpayment.</small></p>
        {editable && <Button type="submit">Review payment</Button>}
      </fieldset>
    </form>
    {intent && <section className="form-section" aria-label="Preserved payment intent">
      <h3>{intent.state === 'conflict' ? 'Preserved request — key conflict' : intent.state === 'uncertain' ? 'Preserved request — outcome uncertain' : intent.state === 'completed' ? 'Recorded payment request' : intent.state === 'rejected' ? 'Rejected payment request' : 'Review payment request'}</h3>
      <dl className="detail-list"><div><dt>Request key</dt><dd>{intent.payload.request_key}</dd></div><div><dt>Amount</dt><dd>{invoice.currency} {intent.payload.amount}</dd></div><div><dt>Method</dt><dd>{methods[intent.payload.method]}</dd></div><div><dt>Paid on (UTC)</dt><dd>{intent.payload.paid_on}</dd></div><div><dt>Exact note</dt><dd style={{whiteSpace: 'pre-wrap'}}>{intent.payload.note || '(empty)'}</dd></div></dl>
      <p><small>The request key and these exact fields are saved in this tab’s session storage, scoped to your user and invoice. Do not close this tab while the outcome is uncertain. No session or password token is stored.</small></p>
      <div className="actions">
        {(intent.state === 'review' || intent.state === 'uncertain') && <Button disabled={locked || Boolean(recorded) || keyConflict} onClick={() => setDialog(true)}>{intent.state === 'uncertain' ? 'Review exact resubmission' : 'Continue payment review'}</Button>}
        <Button variant="secondary" disabled={locked} onClick={() => void reconcile()}>Refresh and reconcile ledger</Button>
        {intent.state === 'review' && <Button variant="secondary" disabled={locked} onClick={() => {if (clear()) setDialog(false);}}>Return to editing</Button>}
        {intent.state === 'rejected' && <Button variant="secondary" disabled={locked} onClick={() => clear()}>Revise rejected payment</Button>}
        {intent.state === 'completed' && recorded && <Button variant="secondary" disabled={locked} onClick={() => {if (clear()) setDraft({amount: '', method: 'bank_transfer', paid_on: utcToday(), note: ''});}}>Finish recorded payment</Button>}
      </div>
      {intent.state === 'completed' && !recorded && <Notice>The API confirmed this payment, but this invoice snapshot has not yet reconciled it. Refresh before starting a new payment.</Notice>}
      {intent.state === 'uncertain' && <Notice error>Do not create a replacement request key, change the amount or enter the same payment in another tab. Only this exact request can be resubmitted safely.</Notice>}
      {keyConflict && <Notice error>This request key conflicts with recorded payment data. Resubmission is locked; an operator must reconcile the original intent. Changing the key could duplicate a payment.</Notice>}
    </section>}
    <ConfirmDialog open={dialog} onOpenChange={setDialog} title={intent?.state === 'uncertain' ? 'Resubmit the exact payment request?' : 'Record this received payment?'} description={intent ? `${invoice.number}: ${invoice.currency} ${intent.payload.amount}, ${methods[intent.payload.method]}, paid ${intent.payload.paid_on} (UTC). Note: ${intent.payload.note || '(empty)'}. Request key: ${intent.payload.request_key}. ${intent.state === 'uncertain' ? 'The earlier request may already have committed. This sends only the unchanged payload with the same key, never a new payment intent.' : 'This records funds already received. Payments cannot be edited or reversed here.'}` : ''} confirmLabel={intent?.state === 'uncertain' ? 'Resubmit exact request' : 'Record payment'} pending={pending} onConfirm={submit}/>
  </Panel>;
}
