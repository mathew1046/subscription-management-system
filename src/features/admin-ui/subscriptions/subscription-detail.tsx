'use client';

import Link from 'next/link';
import {useEffect, useRef, useState} from 'react';
import type {z} from 'zod';
import {api, ApiError} from '@/lib/client';
import {date, lifecycleInput, type SubscriptionDetail} from '@/lib/contracts';
import {Button, ConfirmDialog, Field, Notice} from '@/components/ui';
import {useAdminSession} from '@/features/admin-ui/shared';
import {addDays, dateLabel, errorMessage, SubscriptionStatus, utcToday} from './presentation';
import {SubscriptionQuote} from './subscription-quote';

type Action = z.input<typeof lifecycleInput>['action'];
type Confirmation = {action: Action | 'billing'; title: string; description: string; label: string};

const stages = [
  ['Draft', 'Prepare the agreement and review its charges.'],
  ['Quotation', 'Issue a quotation within its validity dates.'],
  ['Confirmed', 'Record acceptance before activation.'],
  ['Active', 'Run recurring billing; pause or extend when permitted.'],
  ['Closed', 'The agreement has ended. Closed agreements cannot be renewed.'],
] as const;

export function SubscriptionDetailScreen({id}: {id: string}) {
  const session = useAdminSession();
  const allowed = session.user?.role === 'admin' || session.user?.role === 'staff';
  const [subscription, setSubscription] = useState<SubscriptionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [renewalEnd, setRenewalEnd] = useState('');
  const [billingDueError, setBillingDueError] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [billingResult, setBillingResult] = useState<{processed: number; failed: number} | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let current = true;
    setLoading(true);
    setLoadError('');
    api.subscription(id).then(result => {
      if (current) {setSubscription(result); setNeedsRefresh(false); setBillingDueError(false);}
    }).catch(reason => {if (current) setLoadError(errorMessage(reason));})
      .finally(() => {if (current) setLoading(false);});
    return () => {current = false;};
  }, [allowed, id, revision]);

  async function refreshAfterMutation() {
    try {
      const current = await api.subscription(id);
      setSubscription(current);
      setNeedsRefresh(false);
      setBillingDueError(false);
      setLoadError('');
    } catch (reason) {
      setLoadError(`The action completed, but the latest record could not be loaded. ${errorMessage(reason)}`);
      setNeedsRefresh(true);
    }
  }

  function requestAction(value: Confirmation) {
    setError('');
    setSuccess('');
    setConfirmation(value);
  }

  function requestRenewal() {
    if (!subscription) return;
    if (!date.safeParse(renewalEnd).success || renewalEnd <= subscription.end_date) {
      setError('Choose a valid renewal end date strictly later than the current end date.');
      return;
    }
    requestAction({action: 'renew', title: 'Extend this subscription?', label: 'Confirm renewal', description: `Extend ${subscription.number} from ${dateLabel(subscription.end_date)} to ${dateLabel(renewalEnd)} (exclusive, UTC). Existing prices, policies and billing cadence are retained. A paused agreement stays paused. No proration or refund is calculated.`});
  }

  async function confirm() {
    if (!confirmation || lock.current || !allowed || needsRefresh || loading || loadError) return;
    lock.current = true;
    setPending(true);
    setError('');
    setSuccess('');
    const action = confirmation.action;
    try {
      if (action === 'billing') {
        setBillingResult(null);
        const result = await api.runBilling();
        setBillingResult(result);
        setSuccess('The global due-billing batch completed. Review its counts and the refreshed subscription before taking another action.');
      } else {
        const result = await api.transition(id, action === 'renew' ? {action, end_date: renewalEnd} : {action});
        setSubscription(previous => previous ? {...previous, ...result} : previous);
        const messages: Record<Action, string> = {quote: 'Quotation created.', confirm: 'Quotation confirmed.', activate: 'Subscription activated.', pause: 'Subscription paused.', resume: 'Subscription resumed.', close: 'Subscription closed.', renew: 'Subscription end date extended.'};
        setSuccess(messages[action]);
        if (action === 'renew') setRenewalEnd('');
      }
      setConfirmation(null);
      await refreshAfterMutation();
    } catch (reason) {
      setError(errorMessage(reason));
      if (reason instanceof ApiError && reason.code === 'BILLING_DUE') {
        setBillingDueError(true);
        setConfirmation(null);
      }
      if (reason instanceof ApiError && reason.code === 'UNAVAILABLE') {
        setNeedsRefresh(true);
        setConfirmation(null);
      }
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  if (session.loading) return <Notice>Loading your workspace…</Notice>;
  if (session.error) return <><Notice error>{session.error}</Notice><Button onClick={session.reload}>Reload session</Button></>;
  if (!allowed) return <Notice error>Administrator or staff access is required to manage subscriptions.</Notice>;
  if (loading && !subscription) return <Notice>Loading subscription and quote…</Notice>;
  if (!subscription) return <><Notice error>{loadError || 'This subscription could not be loaded.'}</Notice><div className="actions"><Button variant="secondary" onClick={() => setRevision(value => value + 1)}>Reload subscription</Button><Link className="text-link" href="/admin/subscriptions">Back to subscriptions</Link></div></>;

  const today = utcToday();
  const plan = subscription.plan_snapshot;
  const unexpired = subscription.end_date > today;
  const started = subscription.start_date <= today;
  const active = subscription.status === 'Active';
  const validQuote = subscription.quote_valid_until >= today && unexpired;
  const canPause = active && !subscription.paused && plan.allow_pause && started && unexpired;
  const canResume = active && subscription.paused && unexpired;
  const canRenew = active && plan.allow_renew && started && unexpired;
  const canClose = active && plan.allow_close;
  const billingDue = active && !subscription.paused && subscription.next_billing_date <= today && subscription.next_billing_date < subscription.end_date;
  const disabled = pending || loading || needsRefresh || Boolean(loadError);

  return <>
    <header className="page-heading"><div><Link className="text-link" href="/admin/subscriptions">Back to subscriptions</Link><h1 className="page-title">{subscription.number}</h1><p className="page-description">Subscription agreement · {plan.name}</p><SubscriptionStatus subscription={subscription} /></div><Button variant="secondary" disabled={pending || loading} onClick={() => {setError(''); setRevision(value => value + 1);}}>{loading ? 'Loading…' : 'Reload status'}</Button></header>
    {loadError && <Notice error>{loadError}</Notice>}
    {error && <Notice error>{error}</Notice>}
    {success && <Notice>{success}</Notice>}
    {needsRefresh && <Notice error>The current result needs verification. Reload status before making another change. No mutation will be retried automatically.</Notice>}
    {billingResult && <Notice error={billingResult.failed > 0}>Billing batch: {billingResult.processed} period(s) processed; {billingResult.failed} failed. {billingResult.failed > 0 ? 'Review subscription billing errors before deliberately processing another batch.' : 'Generated invoices are drafts and still require confirmation.'} A bounded batch may leave additional due periods for a later run.</Notice>}
    <section className="form-section" aria-labelledby="lifecycle-heading"><h2 id="lifecycle-heading">Lifecycle</h2>
      <ol className="detail-grid" aria-label="Subscription lifecycle stages">{stages.map(([stage, description]) => <li key={stage} aria-current={subscription.status === stage ? 'step' : undefined}><strong>{stage}{subscription.status === stage ? ' — current stage' : ''}</strong><p className="text-muted">{description}</p></li>)}</ol>
      {subscription.status === 'Active' && !unexpired && <Notice>This agreement has expired. It remains saved as Active until closed, but is not currently active and cannot be renewed or resumed.</Notice>}
      {subscription.status === 'Active' && !started && unexpired && <Notice>Activation is saved, but service and billing do not begin before {dateLabel(subscription.start_date)} (UTC).</Notice>}
      {(subscription.status === 'Draft' || subscription.status === 'Quotation') && !validQuote && <Notice error>The quotation or agreement has expired. It cannot advance to confirmation; create a new agreement rather than reviving this one.</Notice>}
      <div className="actions">
        {subscription.status === 'Draft' && <Button disabled={disabled || !validQuote} onClick={() => requestAction({action: 'quote', title: 'Create quotation?', label: 'Create quotation', description: `Move ${subscription.number} from Draft to Quotation using the saved charges and validity through ${dateLabel(subscription.quote_valid_until)} (UTC). This does not send an email.`})}>Create quotation</Button>}
        {subscription.status === 'Quotation' && <Button disabled={disabled || !validQuote} onClick={() => requestAction({action: 'confirm', title: 'Confirm quotation?', label: 'Confirm quotation', description: `Record acceptance of quotation ${subscription.number}. The agreement becomes Confirmed; recurring billing still requires activation.`})}>Confirm quotation</Button>}
        {subscription.status === 'Confirmed' && <Button disabled={disabled || !unexpired} onClick={() => requestAction({action: 'activate', title: 'Activate subscription?', label: 'Activate subscription', description: `Activate ${subscription.number}. Recurring invoices can be generated from its start date, ${dateLabel(subscription.start_date)} (UTC). This does not collect payment.`})}>Activate subscription</Button>}
        {canPause && <Button variant="secondary" disabled={disabled} onClick={() => requestAction({action: 'pause', title: 'Pause subscription?', label: 'Pause subscription', description: `Pause ${subscription.number} and suspend future billing while paused. All due billing must be processed first. Existing invoices and balances are unchanged.`})}>Pause subscription</Button>}
        {canResume && <Button disabled={disabled} onClick={() => requestAction({action: 'resume', title: 'Resume subscription?', label: 'Resume subscription', description: `Resume ${subscription.number}. Prepaid coverage is preserved; if that period has ended, a new billing period starts on resume. The server determines the next billing date.`})}>Resume subscription</Button>}
        {canClose && <Button variant="danger" disabled={disabled} onClick={() => requestAction({action: 'close', title: unexpired ? 'Close subscription early?' : 'Close expired subscription?', label: 'Close subscription', description: `Close ${subscription.number}${unexpired ? ' before its scheduled end' : ''}. This cannot be undone or renewed. Due billing must be processed first. Existing invoices remain payable; no refund or proration is created.`})}>{unexpired ? 'Close early' : 'Close expired agreement'}</Button>}
      </div>
      {subscription.status === 'Confirmed' && !unexpired && <Notice error>This confirmed agreement has expired and cannot be activated.</Notice>}
      <p className="text-muted">Available controls reflect the saved stage and plan policies. The server rechecks permissions, dates and billing state for every action.</p>
    </section>
    {(billingDueError || billingDue || subscription.billing_error) && <section className="form-section" aria-labelledby="billing-heading"><h2 id="billing-heading">Billing needs attention</h2>
      {billingDueError && <Notice error>BILLING_DUE: the server requires due invoices to be processed before pause or closure. Processing billing does not automatically repeat your original action.</Notice>}
      {subscription.billing_error && <Notice error>Last billing error: {subscription.billing_error}</Notice>}
      <p>Process due billing generates draft invoices for <strong>all due subscriptions</strong>, not only this agreement. It may process multiple missed periods in a bounded batch. It does not collect payments.</p>
      <Button variant="secondary" disabled={disabled} onClick={() => requestAction({action: 'billing', title: 'Process all due billing?', label: 'Process due billing', description: 'This runs a global billing batch for every due subscription, not just the agreement on this page. It may generate multiple draft invoices, consume eligible discount usage and advance billing dates. Review processed/failed counts afterwards. The original pause or close action will not be retried.'})}>Process due billing</Button>
    </section>}
    <section className="form-section" aria-labelledby="terms-heading"><h2 id="terms-heading">Agreement terms</h2><dl className="detail-list">
      <div><dt>Customer reference</dt><dd style={{overflowWrap: 'anywhere'}}>{subscription.customer_id}</dd></div>
      <div><dt>Start date (UTC)</dt><dd>{dateLabel(subscription.start_date)}</dd></div>
      <div><dt>End date — exclusive (UTC)</dt><dd>{dateLabel(subscription.end_date)}</dd></div>
      <div><dt>Quotation valid through (UTC)</dt><dd>{dateLabel(subscription.quote_valid_until)}</dd></div>
      <div><dt>Next billing date (UTC)</dt><dd>{dateLabel(subscription.next_billing_date)}{subscription.status === 'Closed' ? ' — no further billing scheduled' : subscription.paused ? ' — billing paused' : subscription.status !== 'Active' ? ' — awaiting activation' : ''}</dd></div>
      <div><dt>Billing anchor (UTC)</dt><dd>{dateLabel(subscription.billing_anchor)}</dd></div>
      <div><dt>Payment terms</dt><dd>{subscription.payment_terms_days} days from invoice issue</dd></div>
      <div><dt>Pause flag</dt><dd>{subscription.paused ? 'Paused' : 'Not paused'}</dd></div>
      <div><dt>Close reason</dt><dd>{subscription.close_reason === 'cancelled' ? 'Cancelled' : subscription.close_reason === 'expired' ? 'Expired' : 'Not closed'}</dd></div>
    </dl><p className="text-muted">Periods include the start and exclude the end. Shortened final periods are billed in full, without proration or refunds.</p></section>
    <SubscriptionQuote subscription={subscription} />
    <section className="form-section" aria-labelledby="policies-heading"><h2 id="policies-heading">Saved plan policies</h2><p className="text-muted">This snapshot belongs to the agreement. Later catalog changes do not rewrite its terms.</p><dl className="detail-list">
      <div><dt>Plan</dt><dd>{plan.name}</dd></div><div><dt>Cadence</dt><dd>{plan.cadence}</dd></div><div><dt>Minimum quantity</dt><dd>{plan.min_quantity}</dd></div>
      <div><dt>Plan availability at creation</dt><dd>{dateLabel(plan.available_from)} to {plan.available_until ? dateLabel(plan.available_until) : 'no end date'} (UTC)</dd></div>
      <div><dt>Automatically close at expiry</dt><dd>{plan.auto_close ? 'Yes' : 'No'}</dd></div><div><dt>Early closure</dt><dd>{plan.allow_close ? 'Allowed' : 'Not allowed'}</dd></div><div><dt>Pause</dt><dd>{plan.allow_pause ? 'Allowed' : 'Not allowed'}</dd></div><div><dt>Renewal</dt><dd>{plan.allow_renew ? 'Allowed before expiry' : 'Not allowed'}</dd></div>
    </dl></section>
    {canRenew && <section className="form-section" aria-labelledby="renew-heading"><h2 id="renew-heading">Extend agreement</h2><p>Choose a later end date. Saved prices and billing cadence stay unchanged; renewal does not resume a paused agreement.</p><form onSubmit={event => {event.preventDefault(); requestRenewal();}}><div className="form-grid"><Field label="New end date — exclusive (UTC)" type="date" value={renewalEnd} required min={addDays(subscription.end_date, 1)} onChange={event => setRenewalEnd(event.target.value)} disabled={disabled} /></div><div className="form-actions"><Button variant="secondary" type="submit" disabled={disabled}>Review renewal</Button></div></form></section>}
    <ConfirmDialog open={Boolean(confirmation)} onOpenChange={(open: boolean) => {if (!open && !lock.current) {setConfirmation(null); setError('');}}} title={confirmation?.title || 'Confirm action'} description={confirmation?.description || ''} onConfirm={confirm} pending={pending} confirmLabel={confirmation?.label} error={error || undefined} />
  </>;
}
