'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/client';
import { id as subscriptionId, lifecycleInput, type SubscriptionDetail } from '@/lib/contracts';
import { Button, ConfirmDialog, Field, Notice } from '@/components/ui';
import { PortalGate } from '@/features/portal-finance-ui/shared';
import { SubscriptionState, subscriptionPermissions, utcToday } from './presentation';

type Action = 'pause' | 'resume' | 'renew' | 'close';
type Intent = { action: Action; end_date?: string };
const actionLabels: Record<Action, string> = { pause: 'Pause subscription', resume: 'Resume subscription', renew: 'Renew subscription', close: 'Close subscription' };

function failureMessage(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 401) {
      window.location.replace('/login?reason=session-expired');
      return 'Your session expired. Sign in again to continue.';
    }
    if (cause.code === 'BILLING_DUE') return 'Invoices are due for processing. Contact staff to process billing, then reload this agreement before trying to pause or close it.';
    if (cause.status === 404 || cause.status === 403) return 'This agreement was not found or is not available to your account. Return to your subscription list or contact staff.';
  }
  return cause instanceof Error ? cause.message : 'Unable to complete the request. Reload the agreement before trying again.';
}

function nextDate(value: string) {
  if (value === '9999-12-31') return value;
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function SubscriptionView({ id }: { id: string }) {
  return <PortalGate><SubscriptionDetailScreen key={id} id={id} /></PortalGate>;
}

function SubscriptionDetailScreen({ id }: { id: string }) {
  const [record, setRecord] = useState<SubscriptionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [intent, setIntent] = useState<Intent | null>(null);
  const [renewEnd, setRenewEnd] = useState('');
  const [dateError, setDateError] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const [today, setToday] = useState(utcToday);
  const inFlight = useRef(false);
  const readSequence = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => setToday(utcToday()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const reload = useCallback(async () => {
    if (inFlight.current) return;
    const sequence = ++readSequence.current;
    setLoading(true);
    setError('');
    try {
      if (!subscriptionId.safeParse(id).success) throw new Error('This agreement link is invalid. Return to your subscription list.');
      const value = await api.subscription(id);
      if (sequence !== readSequence.current) return;
      setRecord(value);
      setNeedsReload(false);
      setIntent(null);
      setToday(utcToday());
    } catch (cause) {
      if (sequence === readSequence.current) {
        setError(failureMessage(cause));
        setNeedsReload(true);
      }
    } finally {
      if (sequence === readSequence.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
    return () => { readSequence.current += 1; };
  }, [reload]);

  function openAction(action: Action) {
    if (!record || busy || loading || needsReload || !subscriptionPermissions(record)[action]) return;
    setDialogError('');
    setError('');
    setSuccess('');
    if (action === 'renew') {
      const parsed = lifecycleInput.safeParse({ action, end_date: renewEnd });
      if (!parsed.success || renewEnd <= record.end_date) {
        setDateError(`Choose a valid end date strictly after ${record.end_date}.`);
        document.getElementById('renew-end')?.focus();
        return;
      }
      setDateError('');
    }
    setIntent(action === 'renew' ? { action, end_date: renewEnd } : { action });
  }

  async function confirmAction() {
    if (!record || !intent || inFlight.current || needsReload || loading) return;
    if (!subscriptionPermissions(record)[intent.action]) {
      setDialogError('The date or agreement state no longer permits this action. Cancel and reload the agreement.');
      return;
    }
    const parsed = lifecycleInput.safeParse(intent);
    if (!parsed.success || (intent.action === 'renew' && (!intent.end_date || intent.end_date <= record.end_date))) {
      setDialogError('Choose a valid renewal date after the current end date.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setDialogError('');
    setError('');
    setSuccess('');
    let confirmed = false;
    try {
      const updated = await api.transition(id, parsed.data);
      confirmed = true;
      setRecord(current => current ? { ...current, ...updated } : current);
      setNeedsReload(true);
      setIntent(null);
      setSuccess(intent.action === 'renew' ? `Agreement extended to ${updated.end_date} (exclusive, UTC).` : intent.action === 'pause' ? 'Subscription paused.' : intent.action === 'resume' ? 'Subscription resumed. The updated billing schedule is shown below.' : 'Subscription closed. This agreement cannot be reopened or renewed.');
      const refreshed = await api.subscription(id);
      setRecord(refreshed);
      setNeedsReload(false);
      setToday(utcToday());
    } catch (cause) {
      const ambiguous = cause instanceof ApiError && (cause.code === 'UNAVAILABLE' || cause.code === 'TIMEOUT' || cause.status >= 500);
      if (confirmed || ambiguous) {
        setIntent(null);
        setNeedsReload(true);
        setError(confirmed ? `The change was saved, but the latest details could not be loaded. Reload this agreement before another action. ${failureMessage(cause)}` : 'The change may have been saved, but its result could not be confirmed. Actions are locked. Explicitly reload the agreement to reconcile its current state before deciding whether another change is needed.');
      } else {
        setDialogError(failureMessage(cause));
        // A conflict can mean another actor changed the record. Require a read before another write.
        if (cause instanceof ApiError && (cause.status === 409 || cause.status === 401 || cause.status === 403 || cause.status === 404)) {
          setIntent(null);
          setNeedsReload(true);
          setError(failureMessage(cause));
        }
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const permissions = record ? subscriptionPermissions(record, today) : null;
  const disabled = busy || loading || needsReload;
  const description = record && intent ? intent.action === 'close'
    ? `Close ${record.number}? Closure is irreversible: this agreement cannot be reopened or renewed. No automatic refund or invoice cancellation is performed.`
    : intent.action === 'renew' ? `Extend ${record.number} from ${record.end_date} to ${intent.end_date} (exclusive, UTC)? Saved plan terms and billing charges continue. Renewal does not resume a paused agreement. The extension cannot be undone here.`
    : intent.action === 'pause' ? `Pause ${record.number}? Billing pauses under the saved plan policy. Existing invoices remain payable; this does not cancel them or provide a refund.`
    : `Resume ${record.number}? Billing resumes under the saved plan terms. Prepaid coverage is preserved; if it has ended, a new billing period starts on resume.` : '';

  return <>
    <div className="page-heading"><div><Link className="text-link" href="/portal/subscriptions">Back to subscriptions</Link><h1 className="page-title">{record?.number || 'Subscription details'}</h1><p className="page-description">Saved agreement terms and permitted self-service changes. All dates use UTC; end dates are exclusive.</p></div><Button type="button" variant="secondary" disabled={busy || loading} onClick={() => { setSuccess(''); void reload(); }}>{loading ? 'Loading…' : needsReload ? 'Reload and reconcile agreement' : 'Reload agreement'}</Button></div>
    {error && <Notice error>{error}</Notice>}
    {success && <Notice>{success}</Notice>}
    {loading && <Notice>Loading the latest agreement…</Notice>}
    {record && permissions && <div aria-busy={busy || loading}>
      <div className="actions"><SubscriptionState subscription={record} today={today} /><span className="text-muted">Saved stage: {record.status}</span></div>
      <ol className="lifecycle" aria-label="Saved agreement lifecycle">{['Draft', 'Quotation', 'Confirmed', 'Active', 'Closed'].map(stage => <li key={stage} className="lifecycle-step" aria-current={stage === record.status ? 'step' : undefined}>{stage}{stage === record.status ? ' (current)' : ''}</li>)}</ol>
      {record.status === 'Active' && record.end_date <= today && <Notice>This agreement has expired and is not currently active, even if its saved lifecycle stage is Active. Expired agreements cannot be resumed or renewed. Contact staff for a new agreement.</Notice>}
      {record.status === 'Active' && record.start_date > today && record.end_date > today && <Notice>This agreement is scheduled, not currently active. Billing cannot start before {record.start_date} (UTC).</Notice>}
      {record.billing_error && <Notice error>Billing needs staff attention: {record.billing_error}. Contact staff; self-service does not run billing.</Notice>}
      {permissions.billingDue && <Notice>Billing is due for processing. Pause and close are unavailable until staff process due invoices. Contact staff, then reload this agreement.</Notice>}
      {needsReload && <Notice>Actions are locked until you successfully reload and reconcile the agreement above. Reloading reads the saved state; it does not repeat the change.</Notice>}
      <div className="detail-grid">
        <section><h2>Agreement dates</h2><dl className="detail-list">
          <div><dt>Start date</dt><dd>{record.start_date}</dd></div><div><dt>End date (exclusive)</dt><dd>{record.end_date}</dd></div>
          <div><dt>Quotation valid through</dt><dd>{record.quote_valid_until}</dd></div><div><dt>Next billing cursor</dt><dd>{record.next_billing_date}{record.paused ? ' (billing paused)' : record.status === 'Closed' ? ' (closed; no further billing)' : ''}</dd></div>
          <div><dt>Billing anchor</dt><dd>{record.billing_anchor}</dd></div><div><dt>Payment terms</dt><dd>{record.payment_terms_days} days from invoice issue</dd></div>
          <div><dt>Close reason</dt><dd>{record.close_reason || 'Not closed'}</dd></div>
        </dl></section>
        <section><h2>Saved plan terms</h2><dl className="detail-list">
          <div><dt>Plan</dt><dd>{record.plan_snapshot.name}</dd></div><div><dt>Recurring base fee</dt><dd>{record.currency} {record.plan_snapshot.price} + product lines</dd></div>
          <div><dt>Cadence</dt><dd>{record.plan_snapshot.cadence}</dd></div><div><dt>Minimum quantity</dt><dd>{record.plan_snapshot.min_quantity}</dd></div>
          <div><dt>Pause permitted</dt><dd>{record.plan_snapshot.allow_pause ? 'Yes' : 'No'}</dd></div><div><dt>Renewal permitted</dt><dd>{record.plan_snapshot.allow_renew ? 'Yes' : 'No'}</dd></div>
          <div><dt>Early close permitted</dt><dd>{record.plan_snapshot.allow_close ? 'Yes' : 'No'}</dd></div><div><dt>Automatic expiry closure</dt><dd>{record.plan_snapshot.auto_close ? 'Yes' : 'No'}</dd></div>
        </dl></section>
      </div>
      <section className="form-section"><h2>Quoted charges</h2><p>Saved prices and taxes, calculated by the server before invoice-time discounts. The tax-free plan base fee is added to product lines. Each final shortened billing period is charged in full; no proration or automatic refunds apply. Issued invoices are authoritative for amounts due.</p>
        <div className="table-wrap" role="region" aria-label="Saved quotation lines — scroll horizontally to see all columns" tabIndex={0}><table>
          <caption className="sr-only">Saved product lines in {record.currency}</caption><thead><tr><th scope="col">Description</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Subtotal</th><th scope="col">Tax rate</th><th scope="col">Tax</th><th scope="col">Total</th></tr></thead>
          <tbody>{record.lines.map(line => <tr key={line.id}><th scope="row">{line.description}</th><td>{line.quantity}</td><td>{record.currency} {line.unit_price}</td><td>{record.currency} {line.subtotal}</td><td>{line.tax_rate}%</td><td>{record.currency} {line.tax_amount}</td><td>{record.currency} {line.total}</td></tr>)}</tbody>
        </table></div>
        <dl className="detail-list"><div><dt>Plan base fee (tax-free)</dt><dd>{record.currency} {record.plan_snapshot.price}</dd></div><div><dt>Quoted subtotal, including base fee</dt><dd>{record.currency} {record.quote_totals.subtotal}</dd></div><div><dt>Quoted tax</dt><dd>{record.currency} {record.quote_totals.tax_total}</dd></div><div><dt>Quoted recurring total</dt><dd>{record.currency} {record.quote_totals.total}</dd></div></dl>
      </section>
      <section className="form-section"><h2>Manage agreement</h2>
        {record.status !== 'Active' ? <p>{record.status === 'Closed' ? 'This agreement is closed and cannot be reopened or renewed.' : 'Self-service changes are available only after staff activate this agreement.'}</p> : <>
          <p>Availability follows the saved plan policy, current agreement state and UTC dates. The server validates each change again.</p>
          <div className="actions">
            {!record.paused && <Button type="button" variant="secondary" disabled={disabled || !permissions.pause} onClick={() => openAction('pause')}>Pause subscription</Button>}
            {record.paused && <Button type="button" variant="secondary" disabled={disabled || !permissions.resume} onClick={() => openAction('resume')}>Resume subscription</Button>}
            <Button type="button" variant="danger" disabled={disabled || !permissions.close} onClick={() => openAction('close')}>Close subscription</Button>
          </div>
          {!record.plan_snapshot.allow_pause && !record.paused && <p className="field-help">This agreement’s saved plan does not permit pausing.</p>}
          {!record.plan_snapshot.allow_close && <p className="field-help">This agreement’s saved plan does not permit early closure.</p>}
          {permissions.renew ? <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); openAction('renew'); }} noValidate>
            <div className="toolbar"><Field id="renew-end" label="New end date (exclusive, UTC)" type="date" value={renewEnd} min={nextDate(record.end_date)} max="9999-12-31" required disabled={disabled} onChange={event => { setRenewEnd(event.target.value); setDateError(''); }} aria-invalid={!!dateError} aria-describedby="renew-help renew-error" /><Button type="submit" variant="secondary" disabled={disabled}>Review renewal</Button></div>
            <p id="renew-help" className="field-help">Choose a date strictly after {record.end_date}. Renewal extends the saved terms; a paused agreement stays paused.</p><p id="renew-error" className="field-error">{dateError}</p>
          </form> : <p className="field-help">{!record.plan_snapshot.allow_renew ? 'This agreement’s saved plan does not permit renewal.' : 'Renewal requires a started, nonexpired Active agreement.'}</p>}
        </>}
      </section>
      <Link className="text-link" href="/portal/invoices">View invoices</Link>
    </div>}
    <ConfirmDialog open={!!intent} onOpenChange={open => { if (!open && !busy) { setIntent(null); setDialogError(''); } }} title={intent ? actionLabels[intent.action] : 'Confirm change'} description={description} onConfirm={confirmAction} pending={busy} confirmLabel={intent ? actionLabels[intent.action] : 'Confirm change'} error={dialogError} />
  </>;
}
