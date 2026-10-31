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
import {archiveDraftIntent, immutableIntent, persistDraftIntent, readDraftIntent, withDraftIntentLock, type DraftIntent, type DraftRecovery} from './draft-intent';

type Input = z.input<typeof subscriptionInput>;

function blankInput(): Input {
  return {customer_id: '', plan_id: '', start_date: utcToday(), end_date: '', quote_valid_until: addDays(utcToday(), 14), payment_terms_days: 14, lines: [{product_id: '', variant_id: null, quantity: 1, tax_id: null}]};
}

export function SubscriptionCreate({templateId}: {templateId?: string}) {
  const router = useRouter();
  const session = useAdminSession();
  const allowed = session.user?.role === 'admin' || session.user?.role === 'staff';
  const [input, setInput] = useState<Input>(blankInput);
  const [templateLoading, setTemplateLoading] = useState(Boolean(templateId));
  const [templateName, setTemplateName] = useState('');
  const [templateError, setTemplateError] = useState('');
  const [templateRevision, setTemplateRevision] = useState(0);
  const [templateSuppressed, setTemplateSuppressed] = useState(false);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [owner, setOwner] = useState('');
  const [recovery, setRecovery] = useState<DraftRecovery | null>(null);
  const [storageError, setStorageError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [createdId, setCreatedId] = useState('');
  const [created, setCreated] = useState<SubscriptionDetail | null>(null);
  const actorId = session.user?.id ?? '';
  const activeActor = useRef(actorId);
  activeActor.current = actorId;

  function restoreRecovery(userId: string, preserveUnsaved = false) {
    const saved = readDraftIntent(userId);
    setRecovery(saved);
    setStorageError('');
    setAcknowledged(false);
    setCreated(null);
    setCreatedId(saved.kind === 'ready' ? saved.intent.subscription_id ?? '' : '');
    if (saved.kind === 'ready') setInput(saved.intent.payload);
    else if (!preserveUnsaved || owner !== userId) setInput(blankInput());
    setTemplateSuppressed(saved.kind !== 'empty' || preserveUnsaved);
    setTemplateName('');
    setTemplateError('');
    setError('');
    setOwner(userId);
  }

  useEffect(() => {
    if (allowed && actorId) restoreRecovery(actorId);
  }, [allowed, actorId]);

  useEffect(() => {
    // A second tab must never quietly replace this form's saved intent.
    function changed(event: StorageEvent) {
      if (event.storageArea === localStorage && (event.key === null || event.key === `brightloop:subscription-create:v1:${actorId}`)) {
        setStorageError('Creation recovery changed in another tab. Reload recovery before continuing.');
      }
    }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [actorId]);

  useEffect(() => {
    if (!templateId || templateSuppressed || !allowed || owner !== actorId || recovery?.kind !== 'empty') {
      setTemplateLoading(false);
      return;
    }
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
  }, [templateId, templateSuppressed, allowed, templateRevision, owner, actorId, recovery]);

  async function loadCreated(subscriptionId: string) {
    const detail = await api.subscription(subscriptionId);
    if (activeActor.current === actorId) setCreated(detail);
    return detail;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !allowed || owner !== actorId || recovery?.kind !== 'empty' || storageError || createdId || templateLoading || templateError) return;
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
    let intent: DraftIntent;
    try {
      intent = immutableIntent({version: 1, actor_id: actorId, request_key: id.parse(crypto.randomUUID()), payload: validated.data, status: 'pending', subscription_id: null});
    } catch {
      setStorageError('A secure creation key could not be generated. No request was sent. Reload recovery before trying again.');
      return;
    }
    await saveIntent(intent, false);
  }

  async function saveIntent(intent: DraftIntent, recovering: boolean) {
    if (lock.current || !allowed || owner !== actorId || !recovery || storageError || createdId) return;
    lock.current = true;
    setPending(true);
    setError('');
    try {
      await withDraftIntentLock(actorId, () => postSavedIntent(intent, recovering));
    } catch (reason) {
      setStorageError(`Creation was blocked before sending. ${errorMessage(reason)}`);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  async function postSavedIntent(intent: DraftIntent, recovering: boolean) {
    if (!recovery || activeActor.current !== actorId) return;
    let savedId = '';
    let raw: string;
    try {
      raw = persistDraftIntent(actorId, intent, recovery.raw);
      setRecovery({kind: 'ready', raw, intent});
    } catch (reason) {
      setStorageError(`The creation attempt could not be saved reliably. No request was sent. ${errorMessage(reason)} Reload recovery before continuing.`);
      return;
    }
    try {
      // The exact validated snapshot and UUID are reused only on a deliberate
      // recovery click. Never revalidate against today's dates or auto-retry.
      const payload = {...intent.payload, request_key: intent.request_key};
      const subscription = await api.createSubscription(payload);
      savedId = id.parse(subscription.id);
      if (activeActor.current !== actorId) return;
      setCreatedId(subscription.id);
      const completed = immutableIntent({...intent, status: 'completed', subscription_id: subscription.id});
      try {
        const completedRaw = persistDraftIntent(actorId, completed, raw);
        setRecovery({kind: 'ready', raw: completedRaw, intent: completed});
      } catch (reason) {
        setStorageError(`The draft is saved as ${subscription.id}, but its recovery record could not be updated. The original request key is retained for exact recovery. ${errorMessage(reason)}`);
      }
      await loadCreated(subscription.id);
      if (activeActor.current === actorId) router.push(`/admin/subscriptions/${subscription.id}`);
    } catch (reason) {
      if (activeActor.current !== actorId) return;
      if (savedId) setError(`The draft was created, but its quote could not be loaded. Do not create it again. ${errorMessage(reason)}`);
      else {
        setError(errorMessage(reason));
        // A rejection during recovery cannot disprove an earlier commit.
        // In particular 409 may mean a key/payload conflict, not a safe reset.
        if (!recovering && reason instanceof ApiError && !['UNAVAILABLE', 'TIMEOUT'].includes(reason.code) && [400, 401, 403, 404, 422, 429].includes(reason.status)) {
          const rejected = immutableIntent({...intent, status: 'rejected'});
          try {
            const rejectedRaw = persistDraftIntent(actorId, rejected, raw);
            setRecovery({kind: 'ready', raw: rejectedRaw, intent: rejected});
          } catch (storageReason) {setStorageError(`The rejection could not be saved. Keep the original request for recovery. ${errorMessage(storageReason)}`);}
        }
      }
    }
  }

  async function startSeparateDraft() {
    if (lock.current || !acknowledged || !recovery?.raw || storageError) return;
    lock.current = true;
    setPending(true);
    try {
      await withDraftIntentLock(actorId, async () => {
        if (recovery.raw === null || activeActor.current !== actorId) return;
        archiveDraftIntent(actorId, recovery.raw);
        const previousInput = recovery.kind === 'ready' && recovery.intent.status === 'rejected' ? recovery.intent.payload : blankInput();
        setRecovery({kind: 'empty', raw: null});
        setInput(previousInput);
        setTemplateSuppressed(true);
        setCreated(null);
        setCreatedId('');
        setError('');
        setAcknowledged(false);
        setTemplateName('');
        setTemplateError('');
      });
    } catch (reason) {setStorageError(`A separate draft could not be started. ${errorMessage(reason)}`);}
    finally {lock.current = false; setPending(false);}
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
  if (owner !== actorId || !recovery) return <Notice>Checking saved draft recovery…</Notice>;

  const intent = recovery.kind === 'ready' ? recovery.intent : null;
  const uncertain = intent?.status === 'pending' && !createdId;
  const separateDraft = recovery.raw !== null && <section className="form-section" aria-labelledby="separate-draft-heading">
    <h2 id="separate-draft-heading">{intent?.status === 'rejected' ? 'Edit the rejected draft' : 'Start a separate draft'}</h2>
    <p className="text-muted">{intent?.status === 'rejected' ? 'The server rejected this attempt. Retain its recovery record and unlock the input to make intentional corrections with a new request key.' : 'First reconcile the previous attempt using exact recovery or the subscription list. A separate draft uses a new request key and can create an additional agreement. The previous recovery record is retained in this browser.'}</p>
    <label className="checkbox-field"><input type="checkbox" checked={acknowledged} disabled={pending || Boolean(storageError)} onChange={event => setAcknowledged(event.target.checked)} />{intent?.status === 'rejected' ? 'I understand my corrected draft will be a new creation attempt.' : 'I have reconciled the previous attempt and intend to create a separate agreement.'}</label>
    <div className="actions"><Button variant="secondary" disabled={pending || !acknowledged || Boolean(storageError)} onClick={startSeparateDraft}>{intent?.status === 'rejected' ? 'Retain attempt & edit input' : 'Retain attempt & start another draft'}</Button><Link className="text-link" href="/admin/subscriptions">Check subscription list</Link></div>
  </section>;
  const storageNotice = <>
    {recovery.kind === 'invalid' && <Notice error>The saved creation attempt is unreadable or invalid. It is not an empty draft: creation is blocked. Reconcile the subscription list before deliberately starting a separate draft.</Notice>}
    {recovery.kind === 'unavailable' && <Notice error>Browser recovery storage is unavailable. Creation is blocked because a request key cannot be retained reliably. Enable local storage, then reload recovery.</Notice>}
    {storageError && <Notice error>{storageError}</Notice>}
    {(storageError || recovery.kind === 'unavailable') && <Button variant="secondary" disabled={pending} onClick={() => restoreRecovery(actorId, true)}>Reload recovery</Button>}
  </>;

  if (created) return <>
    <header className="page-heading"><div><h1 className="page-title">Draft created</h1><p className="page-description">{created.number} is saved. Review its server-calculated quotation before continuing.</p></div></header>
    <Notice>Subscription {created.number} was created successfully.</Notice>
    {storageNotice}
    <SubscriptionQuote subscription={created} />
    <div className="form-actions"><Button onClick={() => router.push(`/admin/subscriptions/${created.id}`)}>Open subscription</Button><Link className="button secondary" href="/admin/subscriptions">Back to subscriptions</Link></div>
    {separateDraft}
  </>;

  const disabled = pending || recovery.kind !== 'empty' || Boolean(storageError) || Boolean(createdId) || templateLoading || Boolean(templateError);
  return <>
    <header className="page-heading"><div><Link className="text-link" href="/admin/subscriptions">Back to subscriptions</Link><h1 className="page-title">New subscription</h1><p className="page-description">Prepare a draft agreement. Prices, taxes and plan policies are snapshotted when you save.</p></div></header>
    {templateLoading && <Notice>Loading quotation template…</Notice>}
    {templateName && <Notice>Copied from “{templateName}”. Review all dates, selections and quantities before saving.</Notice>}
    {templateError && <><Notice error>{templateError}</Notice><div className="actions"><Button variant="secondary" onClick={() => setTemplateRevision(value => value + 1)}>Reload template</Button><Link className="text-link" href="/admin/subscriptions/new">Start without a template</Link></div></>}
    {error && <Notice error>{error}</Notice>}
    {storageNotice}
    {uncertain && <><Notice>{pending ? 'Saving the original creation attempt. Its input and request key are retained in this browser.' : 'The previous creation result is unknown. Its original input and request key are restored and locked. Exact recovery resends only that same request; it does not start another agreement. Nothing is retried automatically.'}</Notice><div className="actions"><Button disabled={pending || Boolean(storageError)} onClick={() => intent && saveIntent(intent, true)}>{pending ? 'Saving original draft…' : 'Recover original draft (exact retry)'}</Button></div></>}
    {intent?.status === 'rejected' && <Notice error>The server rejected this creation attempt. Review the saved input below, then explicitly unlock it for correction.</Notice>}
    {createdId && <><Notice>This draft is already saved. Open or reload the same saved agreement; do not create it again.</Notice><div className="actions"><Link className="button" href={`/admin/subscriptions/${createdId}`}>Open saved draft</Link><Button variant="secondary" disabled={pending} onClick={reloadQuote}>{pending ? 'Loading quote…' : 'Reload saved quote'}</Button></div></>}
    <form onSubmit={submit} onChange={() => {if (!disabled) setError('');}} aria-busy={pending}>
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
    {separateDraft}
  </>;
}
