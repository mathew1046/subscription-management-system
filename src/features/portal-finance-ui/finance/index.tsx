'use client';

import {useEffect, useState, type FormEvent} from 'react';
import Link from 'next/link';
import {api, ApiError} from '@/lib/client';
import {date, id, type Report} from '@/lib/contracts';
import {Button, Field, Notice, Select} from '@/components/ui';
import {PortalGate} from '../shared';
import {CustomerFilter} from './customer-filter';
import {PaymentLedger} from './payment-ledger';

type Filters = {from: string; to: string; customer: {id: string; name: string}};
type ReportRequest = {filters: Filters; page: number; pageSize: number; revision: number};

function initialFilters(): Filters {
  const today = new Date().toISOString().slice(0, 10);
  return {from: `${today.slice(0, 8)}01`, to: today, customer: {id: '', name: ''}};
}

export function FinanceOverview() {
  return <PortalGate internalOnly><FinanceReport/></PortalGate>;
}

function FinanceReport() {
  const [draft, setDraft] = useState(initialFilters);
  const [pageSize, setPageSize] = useState('25');
  const [validation, setValidation] = useState('');
  const [request, setRequest] = useState<ReportRequest>(() => ({filters: draft, page: 1, pageSize: 25, revision: 0}));
  const [result, setResult] = useState<{request: ReportRequest; report?: Report; error?: string; status?: number} | null>(null);
  const current = result?.request === request ? result : null;
  const pending = !current;
  const report = current?.report;
  const unapplied = draft.from !== request.filters.from || draft.to !== request.filters.to || draft.customer.id !== request.filters.customer.id || Number(pageSize) !== request.pageSize;

  useEffect(() => {
    let active = true;
    api.report({from: request.filters.from, to: request.filters.to, customer_id: request.filters.customer.id || undefined,
      include_payments: true, page: request.page, page_size: request.pageSize}).then(data => {
      if (!data.payments) throw new Error('The report did not include its payment ledger. Retry the report or contact your administrator.');
      if (active) setResult({request, report: data});
    }).catch(cause => {
      if (active) setResult({request, error: cause instanceof Error ? cause.message : 'The finance report could not be loaded.', status: cause instanceof ApiError ? cause.status : undefined});
    });
    return () => { active = false; };
  }, [request]);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date.safeParse(draft.from).success || !date.safeParse(draft.to).success) {
      setValidation('Enter a valid start and end date in YYYY-MM-DD format. Dates use UTC.');
      return;
    }
    if (draft.from > draft.to) { setValidation('The end date must be on or after the start date.'); return; }
    if (draft.customer.id && !id.safeParse(draft.customer.id).success) { setValidation('Choose a valid customer or select All customers.'); return; }
    setValidation('');
    setRequest(previous => ({filters: draft, page: 1, pageSize: Number(pageSize), revision: previous.revision + 1}));
  }

  function invoiceHref(status?: 'Outstanding' | 'Overdue') {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (request.filters.customer.id) query.set('customer_id', request.filters.customer.id);
    return `/portal/invoices${query.size ? `?${query}` : ''}`;
  }

  return <>
    <header className="page-heading">
      <div><h1 className="page-title">Finance overview</h1>
        <p className="page-description">Review billed amounts, recorded payments and current balances. Open an invoice to manage its status or record a payment already received.</p>
      </div>
      <Link className="button secondary" href={invoiceHref()}>View invoices</Link>
    </header>

    <section className="form-section" aria-labelledby="finance-filters-title">
      <h2 id="finance-filters-title">Report filters</h2>
      <p id="finance-filter-help">Both dates are inclusive and use UTC. Dates filter billed amounts by invoice issue date and collections by payment date; current balances and active subscriptions are not date-filtered.</p>
      <form onSubmit={apply} noValidate aria-describedby="finance-filter-help">
        <div className="toolbar subscription-filters">
          <Field label="From (UTC)" type="date" required value={draft.from} aria-invalid={!!validation} aria-describedby={validation ? 'finance-filter-error' : undefined} onChange={event => setDraft(previous => ({...previous, from: event.target.value}))}/>
          <Field label="To (UTC)" type="date" required value={draft.to} aria-invalid={!!validation} aria-describedby={validation ? 'finance-filter-error' : undefined} onChange={event => setDraft(previous => ({...previous, to: event.target.value}))}/>
          <CustomerFilter value={draft.customer} onChange={customer => setDraft(previous => ({...previous, customer}))}/>
          <Select label="Payments per page" value={pageSize} onChange={event => setPageSize(event.target.value)}>
            <option value="25">25</option><option value="50">50</option><option value="100">100</option>
          </Select>
        </div>
        {validation && <div id="finance-filter-error"><Notice error>{validation}</Notice></div>}
        <div className="actions">
          <Button type="submit" disabled={pending}>{pending ? 'Loading report…' : 'Apply filters'}</Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => {
            const filters = initialFilters();
            setDraft(filters); setPageSize('25'); setValidation('');
            setRequest(previous => ({filters, page: 1, pageSize: 25, revision: previous.revision + 1}));
          }}>Reset to this month</Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setRequest(previous => ({...previous, revision: previous.revision + 1}))}>Refresh applied report</Button>
        </div>
        {unapplied && <Notice>Filters have changed. Apply filters to update the report; the selection below still describes the applied report.</Notice>}
      </form>
    </section>

    <p className="text-muted">Applied selection: {request.filters.customer.name || 'All customers'} · {request.filters.from} – {request.filters.to} (UTC, inclusive).</p>
    <div aria-busy={pending}>
      {pending && <Notice>Loading summary and payment ledger together… Previous results are hidden until the new report is available.</Notice>}
      {current?.error && <>
        <Notice error>{current.status === 401 ? 'Your session expired. Sign in again to view finance reports.' : current.status === 403 ? 'Finance reports are available only to staff and administrators.' : current.error} No report values are shown for this request.</Notice>
        {current.status === 401 ? <Link className="button secondary" href="/login">Sign in again</Link> : current.status !== 403 && <Button type="button" variant="secondary" onClick={() => setRequest(previous => ({...previous, revision: previous.revision + 1}))}>Retry report</Button>}
      </>}
      {report && <>
        <div className="detail-grid">
          <section aria-labelledby="finance-period-title">
            <h2 id="finance-period-title">Period activity</h2>
            <p className="text-muted">{report.from} – {report.to} (UTC, inclusive)</p>
            <dl className="detail-list">
              <div><dt>Billed amount</dt><dd>{report.currency} {report.billed}</dd></div>
              <div><dt>Collected payments</dt><dd>{report.currency} {report.collected}</dd></div>
            </dl>
            <p className="field-help">Billed includes confirmed and paid invoices issued in this period. Collected includes payments dated in this period, even for earlier invoices.</p>
          </section>
          <section aria-labelledby="finance-current-title">
            <h2 id="finance-current-title">Current position</h2>
            <p className="text-muted">Current snapshot for the applied customer selection, regardless of report dates.</p>
            <dl className="detail-list">
              <div><dt>Active subscriptions</dt><dd>{report.active_subscriptions}</dd></div>
              <div><dt>Outstanding balance</dt><dd>{report.currency} {report.outstanding} · <Link className="text-link" href={invoiceHref('Outstanding')}>View outstanding invoices</Link></dd></div>
              <div><dt>Overdue balance</dt><dd>{report.currency} {report.overdue} · <Link className="text-link" href={invoiceHref('Overdue')}>View overdue invoices</Link></dd></div>
            </dl>
            <p className="field-help">Overdue is part of outstanding, not an additional balance. Invoice links keep the customer selection, without limiting issue dates.</p>
          </section>
        </div>
        <hr/>
        {report.payments && <PaymentLedger payments={report.payments} onPageChange={page => setRequest(previous => ({...previous, page}))}/>}
      </>}
    </div>
  </>;
}
