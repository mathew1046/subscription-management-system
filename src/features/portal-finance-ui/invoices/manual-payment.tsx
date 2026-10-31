'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {z} from 'zod';
import {api, ApiError} from '@/lib/client';
import {paymentInput, type InvoiceDetail, type Payment} from '@/lib/contracts';
import {Button, ConfirmDialog, Field, Notice, Panel, Select, Textarea} from '@/components/ui';
import {compareMoney, errorMessage, methods, SignInRecovery, utcToday} from './helpers';
import {paymentStorageKey, readPaymentIntent, replacePaymentIntent, restorePaymentIntent, withPaymentIntentLock, type PaymentIntent as Intent, type PaymentRecovery} from './payment-intent';

type Payload = z.output<typeof paymentInput>;
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

function definitelyRejected(cause: unknown): boolean {
  if (!(cause instanceof ApiError)) return false;
  // Only known API rejections before commit qualify. Unknown errors (including
  // intermediary timeouts and malformed responses) retain uncertainty.
  return (cause.status === 400 && ['VALIDATION', 'OVERPAYMENT'].includes(cause.code))
    || (cause.status === 401 && cause.code === 'UNAUTHENTICATED')
    || (cause.status === 403 && ['FORBIDDEN', 'ORIGIN'].includes(cause.code))
    || (cause.status === 404 && cause.code === 'NOT_FOUND')
    || (cause.status === 409 && cause.code === 'INVALID_TRANSITION')
    || (cause.status === 429 && cause.code === 'RATE_LIMIT');
}

export function ManualPayment(props: Props) {
  // A different authenticated actor/invoice gets a separate component lifetime.
  return <ScopedManualPayment key={paymentStorageKey(props.userId, props.invoice.id)} {...props}/>;
}

function ScopedManualPayment({invoice, userId, disabled, beginMutation, endMutation, refresh, onLockChange}: Props) {
  const storageKey = paymentStorageKey(userId, invoice.id);
  const [draft, setDraft] = useState<Draft>({amount: '', method: 'bank_transfer', paid_on: utcToday(), note: ''});
  const [intent, setIntent] = useState<Intent | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [failure, setFailure] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [validation, setValidation] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const lifetime = useRef({alive: false, blocked: false});
  const intentRef = useRef<Intent | null>(null);
  const rawRef = useRef<string | null>(null);
  const renderedRaw = rawRef.current;

  function adopt(saved: PaymentRecovery) {
    rawRef.current = saved.raw; intentRef.current = saved.intent; setIntent(saved.intent);
    if (saved.intent) {
      const {amount, method, paid_on, note} = saved.intent.payload;
      setDraft({amount, method, paid_on, note});
    }
  }
  useEffect(() => {
    const life = {alive: true, blocked: false}; lifetime.current = life;
    function changed(event: StorageEvent) {
      if (event.storageArea !== localStorage || (event.key !== storageKey && event.key !== null)) return;
      life.blocked = true; setDialog(false);
      setStorageError('Payment recovery changed in another tab. Reload this page to read the current intent. No stale action may overwrite or clear it.');
    }
    window.addEventListener('storage', changed);
    void withPaymentIntentLock(storageKey, async () => {
      if (!life.alive || life.blocked) return;
      const saved = restorePaymentIntent(userId, invoice.id);
      if (!life.alive || life.blocked) return;
      adopt(saved);
      if (saved.intent) setMessage(saved.intent.state === 'review' ? 'Your never-submitted payment review was restored. No request was sent automatically.' : 'The original payment key and exact fields were restored. Reconcile the server ledger before starting another payment. An absent key does not prove failure; no request is sent automatically.');
    }, true).catch(cause => {
      if (life.alive) {life.blocked = true; setStorageError(`Payment recovery is locked: ${errorMessage(cause)} Enable durable local storage and reload; do not delete an unknown intent or replace its key.`);}
    }).finally(() => {if (life.alive) setReady(true);});
    return () => {life.alive = false; window.removeEventListener('storage', changed);};
    // The keyed component owns one actor/invoice, including all async callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {onLockChange(!ready || pending || Boolean(storageError) || Boolean(intent));}, [ready, pending, storageError, intent, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);

  async function operate(action: (current: Intent | null, save: (next: Intent | null) => void, check: () => void) => Promise<void>) {
    const life = lifetime.current, expectedRaw = renderedRaw;
    if (!ready || disabled || storageError || inFlight.current || !life.alive || life.blocked || !beginMutation()) return;
    inFlight.current = true; setPending(true);
    try {
      await withPaymentIntentLock(storageKey, async () => {
        let raw = expectedRaw;
        const check = () => {
          if (!life.alive || life.blocked) throw new Error('This payment view is no longer current. Reload recovery; keep the original request.');
          if (rawRef.current !== raw) throw new Error('This payment action belongs to an older review. Reload the current recovery before continuing.');
          readPaymentIntent(userId, invoice.id, raw);
        };
        check();
        const current = readPaymentIntent(userId, invoice.id, raw).intent;
        const save = (next: Intent | null) => {
          check();
          const saved = replacePaymentIntent(userId, invoice.id, raw, next);
          raw = saved.raw; adopt(saved);
        };
        await action(current, save, check);
      });
    } catch (cause) {
      if (life.alive) {life.blocked = true; setDialog(false); setStorageError(`Payment recovery stopped: ${errorMessage(cause)} Reload before continuing; preserve the original key and payment details.`);}
    } finally {
      inFlight.current = false; endMutation();
      if (life.alive) setPending(false);
    }
  }

  async function latest(check: () => void): Promise<InvoiceDetail> {
    const value = await refresh();
    check();
    if (!value || value.id !== invoice.id) throw new Error('A current server ledger could not be read. No saved payment can be released or replaced.');
    return value;
  }

  function reconcileSnapshot(current: Intent, ledger: InvoiceDetail, save: (next: Intent) => void): 'completed' | 'conflict' | null {
    const found = ledger.payments.find(payment => payment.request_key.toLowerCase() === current.payload.request_key.toLowerCase());
    if (!found) return null; // Absence never disproves an earlier in-flight write.
    const state = matches(found, current.payload) ? 'completed' : 'conflict';
    save({...current, state}); setDialog(false);
    setFailure(null);
    setMessage(state === 'completed' ? 'The current server ledger contains this exact key and matching payment details. Do not submit it again.' : 'The server ledger contains this key with different details. Keep the original intent for operator reconciliation; do not replace its key.');
    return state;
  }

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
    void operate(async (current, save) => {
      if (current) throw new Error('A preserved payment already exists. Reconcile it before starting another.');
      save({version: 1, user_id: userId, state: 'review', payload: {...parsed.data, request_key: crypto.randomUUID()}});
      setDialog(true);
    });
  }

  async function submit() {
    await operate(async (current, save, check) => {
      if (!current || (current.state !== 'review' && current.state !== 'uncertain')) return;
      const ledger = await latest(check);
      if (reconcileSnapshot(current, ledger, save)) return;
      if (current.state === 'review' && (ledger.status !== 'Confirmed' || compareMoney(current.payload.amount, ledger.balance) > 0)) {
        setDialog(false); setFailure(new Error('This never-submitted review no longer fits the current confirmed balance. Return to editing.')); return;
      }
      setFailure(null); setMessage('');
      // Hold the lock and verify durable uncertainty BEFORE the POST. If this
      // view disappears, leave that original request intact for exact recovery.
      save({...current, state: 'uncertain'});
      let payment: Payment;
      try {payment = await api.recordPayment(current.payload);}
      catch (cause) {
        check();
        const keyMismatch = cause instanceof ApiError && cause.code === 'IDEMPOTENCY_MISMATCH';
        const uncertain = current.state === 'uncertain' || !definitelyRejected(cause) || keyMismatch;
        save({...current, state: keyMismatch ? 'conflict' : uncertain ? 'uncertain' : 'rejected'});
        setDialog(false); setFailure(cause);
        setMessage(keyMismatch ? 'Request-key conflict. Preserve every field for operator reconciliation.' : uncertain ? 'Outcome uncertain. Only this unchanged payload and original key may be resubmitted deliberately. No automatic retry occurs.' : 'The API definitely rejected this first attempt. Refresh the ledger before deliberately revising it.');
        const fresh = await latest(check);
        reconcileSnapshot(intentRef.current!, fresh, save);
        return;
      }
      check();
      if (!matches(payment, current.payload)) throw new Error('The payment response does not match the preserved intent. Reconcile its original key; do not replace it.');
      save({...current, state: 'completed'}); setDialog(false);
      setMessage('Payment confirmed by the API. Read the current server ledger before finishing this intent.');
      const fresh = await latest(check);
      reconcileSnapshot(intentRef.current!, fresh, save);
    });
  }

  async function reconcile() {
    await operate(async (current, save, check) => {
      if (!current) return;
      const ledger = await latest(check);
      if (!reconcileSnapshot(current, ledger, save)) setMessage('This server ledger does not contain the original key. That is not proof of failure. Preserve the intent; an uncertain payment may only be resubmitted with the exact original fields and key.');
    });
  }

  async function clear() {
    await operate(async (current, save, check) => {
      if (!current || current.state === 'uncertain' || current.state === 'conflict') return;
      const ledger = await latest(check);
      const state = reconcileSnapshot(current, ledger, save);
      if (state === 'conflict' || (current.state === 'completed' && state !== 'completed')) {
        setMessage('The saved payment cannot be released without matching current server ledger evidence. Preserve its key and reconcile again.'); return;
      }
      if (current.state !== 'completed' && state === 'completed') return;
      // Only never-submitted review, definite first-attempt rejection, or a
      // completed request matched by the just-read ledger can be released.
      save(null); setDialog(false); setFailure(null); setMessage(''); setValidation({});
      if (current.state === 'completed') setDraft({amount: '', method: 'bank_transfer', paid_on: utcToday(), note: ''});
    });
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
      <p><small>The original key and exact fields are saved in this browser profile’s local storage, scoped to your user and invoice, including after tab closure. Tabs coordinate through Web Locks. This cannot coordinate another browser, profile or device, or survive cleared browser data. Do not record this same receipt elsewhere while recovery is unresolved. No session or password token is stored.</small></p>
      <div className="actions">
        {(intent.state === 'review' || intent.state === 'uncertain') && <Button disabled={locked || Boolean(recorded) || keyConflict} onClick={() => setDialog(true)}>{intent.state === 'uncertain' ? 'Review exact resubmission' : 'Continue payment review'}</Button>}
        <Button variant="secondary" disabled={locked} onClick={() => void reconcile()}>Refresh and reconcile ledger</Button>
        {intent.state === 'review' && <Button variant="secondary" disabled={locked} onClick={() => void clear()}>Return to editing</Button>}
        {intent.state === 'rejected' && <Button variant="secondary" disabled={locked} onClick={() => void clear()}>Revise rejected payment</Button>}
        {intent.state === 'completed' && recorded && <Button variant="secondary" disabled={locked} onClick={() => void clear()}>Finish recorded payment</Button>}
      </div>
      {intent.state === 'completed' && !recorded && <Notice>The API confirmed this payment, but this invoice snapshot has not yet reconciled it. Refresh before starting a new payment.</Notice>}
      {intent.state === 'uncertain' && <Notice error>Do not create a replacement request key, change the amount or enter the same payment in another tab. Only this exact request can be resubmitted safely.</Notice>}
      {keyConflict && <Notice error>This request key conflicts with recorded payment data. Resubmission is locked; an operator must reconcile the original intent. Changing the key could duplicate a payment.</Notice>}
    </section>}
    <ConfirmDialog open={dialog} onOpenChange={setDialog} title={intent?.state === 'uncertain' ? 'Resubmit the exact payment request?' : 'Record this received payment?'} description={intent ? `${invoice.number}: ${invoice.currency} ${intent.payload.amount}, ${methods[intent.payload.method]}, paid ${intent.payload.paid_on} (UTC). Note: ${intent.payload.note || '(empty)'}. Request key: ${intent.payload.request_key}. ${intent.state === 'uncertain' ? 'The earlier request may already have committed. This sends only the unchanged payload with the same key, never a new payment intent.' : 'This records funds already received. Payments cannot be edited or reversed here.'}` : ''} confirmLabel={intent?.state === 'uncertain' ? 'Resubmit exact request' : 'Record payment'} pending={pending} onConfirm={submit}/>
  </Panel>;
}
