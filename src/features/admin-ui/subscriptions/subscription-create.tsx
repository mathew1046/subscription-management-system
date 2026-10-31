'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import type {z} from 'zod';
import {api, ApiError} from '@/lib/client';
import {id, subscriptionInput, type QuotationTemplate, type SubscriptionDetail} from '@/lib/contracts';
import {Button, Field, Notice} from '@/components/ui';
import {LineEditor, LookupSelect, useAdminSession} from '@/features/admin-ui/shared';
import {addDays, errorMessage, utcToday} from './presentation';
import {SubscriptionQuote} from './subscription-quote';

type Input = z.input<typeof subscriptionInput>;

export function SubscriptionCreate({templateId}: {templateId?: string}) {
  const router = useRouter();
  const session = useAdminSession();
  const allowed = session.user?.role === 'admin' || session.user?.role === 'staff';
  const [input, setInput] = useState<Input>(() => ({customer_id: '', plan_id: '', start_date: utcToday(), end_date: '', quote_valid_until: addDays(utcToday(), 14), payment_terms_days: 14, lines: [{product_id: '', variant_id: null, quantity: 1, tax_id: null}]}));
  const [templateLoading, setTemplateLoading] = useState(Boolean(templateId));
  const [templateName, setTemplateName] = useState('');
  const [templateError, setTemplateError] = useState('');
  const [templateRevision, setTemplateRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [createdId, setCreatedId] = useState('');
  const [created, setCreated] = useState<SubscriptionDetail | null>(null);

  useEffect(() => {
    if (!templateId || !allowed) return;
    let current = true;
    setTemplateLoading(true);
    setTemplateError('');
    async function loadTemplate() {
      if (!id.safeParse(templateId).success) throw new Error('The template reference is not a valid UUID. Start a new subscription without a template.');
      let page = 1;
      let template: QuotationTemplate | undefined;
      while (current) {
        const result = await api.list('quotation-templates', {page, page_size: 100});
        template = result.items.find(item => item.id.toLowerCase() === templateId?.toLowerCase());
        if (template || !result.has_more) break;
        page += 1;
      }
      if (!current) return;
      if (!template) throw new Error('This quotation template was not found. Choose another template or start a blank subscription.');
      setInput(previous => ({...previous, plan_id: template.plan_id, quote_valid_until: addDays(utcToday(), template.valid_days), lines: template.lines.map(line => ({...line}))}));
      setTemplateName(template.name);
    }
    loadTemplate().catch(reason => {if (current) setTemplateError(errorMessage(reason));}).finally(() => {if (current) setTemplateLoading(false);});
    return () => {current = false;};
  }, [templateId, allowed, templateRevision]);

  async function loadCreated(subscriptionId: string) {
    const detail = await api.subscription(subscriptionId);
    setCreated(detail);
    return detail;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !allowed || createdId || uncertain || templateLoading || templateError) return;
    setError('');
    const validated = subscriptionInput.safeParse(input);
    if (!validated.success) {
      setError(validated.error.issues.map(issue => `${issue.path.join(' › ') || 'Subscription'}: ${issue.message}`).join(' · '));
      return;
    }
    if (validated.data.end_date <= utcToday() || validated.data.quote_valid_until < utcToday()) {
      setError('The end date must be after today, and quotation validity cannot be in the past (UTC).');
      return;
    }
    lock.current = true;
    setPending(true);
    let savedId = '';
    try {
      const subscription = await api.createSubscription(validated.data);
      savedId = subscription.id;
      setCreatedId(subscription.id);
      await loadCreated(subscription.id);
      router.push(`/admin/subscriptions/${subscription.id}`);
    } catch (reason) {
      if (savedId) setError(`The draft was created, but its quote could not be loaded. Do not create it again. ${errorMessage(reason)}`);
      else {
        setError(errorMessage(reason));
        if (reason instanceof ApiError && (reason.code === 'UNAVAILABLE' || reason.status >= 500)) setUncertain(true);
      }
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  async function reloadQuote() {
    if (lock.current || !createdId) return;
    lock.current = true;
    setPending(true);
    setError('');
    try {await loadCreated(createdId);} catch (reason) {setError(errorMessage(reason));}
    finally {lock.current = false; setPending(false);}
  }

  if (session.loading) return <Notice>Loading your workspace…</Notice>;
  if (session.error) return <><Notice error>{session.error}</Notice><Button onClick={session.reload}>Reload session</Button></>;
  if (!allowed) return <Notice error>Administrator or staff access is required to create subscriptions.</Notice>;

  if (created) return <>
    <header className="page-heading"><div><h1 className="page-title">Draft created</h1><p className="page-description">{created.number} is saved. Review its server-calculated quotation before continuing.</p></div></header>
    <Notice>Subscription {created.number} was created successfully.</Notice>
    <SubscriptionQuote subscription={created} />
    <div className="form-actions"><Button onClick={() => router.push(`/admin/subscriptions/${created.id}`)}>Open subscription</Button><Link className="button secondary" href="/admin/subscriptions">Back to subscriptions</Link></div>
  </>;

  const disabled = pending || Boolean(createdId) || uncertain || templateLoading || Boolean(templateError);
  return <>
    <header className="page-heading"><div><Link className="text-link" href="/admin/subscriptions">Back to subscriptions</Link><h1 className="page-title">New subscription</h1><p className="page-description">Prepare a draft agreement. Prices, taxes and plan policies are snapshotted when you save.</p></div></header>
    {templateLoading && <Notice>Loading quotation template…</Notice>}
    {templateName && <Notice>Copied from “{templateName}”. Review all dates, selections and quantities before saving.</Notice>}
    {templateError && <><Notice error>{templateError}</Notice><div className="actions"><Button variant="secondary" onClick={() => setTemplateRevision(value => value + 1)}>Reload template</Button><Link className="text-link" href="/admin/subscriptions/new">Start without a template</Link></div></>}
    {error && <Notice error>{error}</Notice>}
    {uncertain && <Notice error>The creation result is unknown. Check the subscription list before starting another draft; this form is locked to avoid creating a duplicate.</Notice>}
    {createdId && <div className="actions"><Link className="button" href={`/admin/subscriptions/${createdId}`}>Open saved draft</Link><Button variant="secondary" disabled={pending} onClick={reloadQuote}>{pending ? 'Loading quote…' : 'Reload saved quote'}</Button></div>}
    <form onSubmit={submit} aria-busy={pending}>
      <section className="form-section" aria-labelledby="agreement-heading"><h2 id="agreement-heading">Agreement</h2><div className="form-grid">
        <LookupSelect resource="customers" label="Customer" value={input.customer_id} onChange={(value: string) => setInput(previous => ({...previous, customer_id: value}))} disabled={disabled} />
        <LookupSelect resource="plans" label="Recurring plan" value={input.plan_id} onChange={(value: string) => setInput(previous => ({...previous, plan_id: value}))} disabled={disabled} />
      </div><p className="text-muted">The plan base fee is additional to product lines. A zero base fee means line-only pricing. Existing plan minimum quantities and availability are checked by the server.</p></section>
      <section className="form-section" aria-labelledby="dates-heading"><h2 id="dates-heading">Dates & payment terms</h2><div className="form-grid">
        <Field label="Start date (UTC)" type="date" required value={input.start_date} onChange={event => setInput(previous => ({...previous, start_date: event.target.value}))} disabled={disabled} />
        <Field label="End date — exclusive (UTC)" type="date" required min={input.start_date ? addDays(input.start_date, 1) : undefined} value={input.end_date} onChange={event => setInput(previous => ({...previous, end_date: event.target.value}))} disabled={disabled} />
        <Field label="Quotation valid through (UTC)" type="date" required min={utcToday()} value={input.quote_valid_until} onChange={event => setInput(previous => ({...previous, quote_valid_until: event.target.value}))} disabled={disabled} />
        <Field label="Payment terms (days from invoice issue)" type="number" required min={0} max={365} step={1} value={input.payment_terms_days ?? ''} onChange={event => setInput(previous => ({...previous, payment_terms_days: event.target.value === '' ? undefined : Number(event.target.value)}))} disabled={disabled} />
      </div><p className="text-muted">Billing periods include their start date and exclude their end date. A shortened final period is billed in full; no proration or refunds. Zero payment-term days means due on issue.</p></section>
      <section className="form-section" aria-labelledby="lines-heading"><h2 id="lines-heading">Product lines</h2><LineEditor value={input.lines} onChange={(lines: Input['lines']) => setInput(previous => ({...previous, lines}))} disabled={disabled} /><p className="text-muted">Quote totals are available after saving. Invoice-time discounts are evaluated by the server, not previewed here.</p></section>
      <div className="form-actions"><Button type="submit" disabled={disabled}>{pending ? 'Saving draft…' : 'Create draft & view quote'}</Button><Link className="button secondary" href="/admin/subscriptions">{uncertain ? 'Check subscription list' : 'Cancel'}</Link></div>
    </form>
  </>;
}
