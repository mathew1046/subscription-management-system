'use client';

import {Suspense, useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {api} from '@/lib/client';
import {date, id as uuid, type Invoice, type InvoiceDetail, type ListParams, type Page} from '@/lib/contracts';
import {Button, ConfirmDialog, Field, Notice, Panel, Select, Status} from '@/components/ui';
import {PortalGate, usePortalSession} from '@/features/portal-finance-ui/shared';
import {CustomerFilter} from '../finance/customer-filter';
import {ManualPayment} from './manual-payment';
import {compareMoney, emailMessage, errorMessage, invoiceStatuses, isOverdue, methods, SignInRecovery} from './helpers';

export function InvoiceRecords() {
  return <PortalGate><Suspense fallback={<Notice>Loading invoice filters…</Notice>}><InvoiceList/></Suspense></PortalGate>;
}

function InvoiceList() {
  const user = usePortalSession();
  const internal = user.role !== 'customer';
  const search = useSearchParams();
  const router = useRouter();
  const status = search.get('status') || '';
  const from = search.get('from') || '', to = search.get('to') || '';
  const customer = internal ? search.get('customer_id') || '' : '';
  const rawPage = search.get('page') || '1';
  const page = /^\d+$/.test(rawPage) && Number.isSafeInteger(Number(rawPage)) && Number(rawPage) > 0 ? Number(rawPage) : 1;
  const [filters, setFilters] = useState({status, from, to, customer});
  const [selectedCustomer, setSelectedCustomer] = useState({id: '', name: ''});
  const [result, setResult] = useState<Page<Invoice> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [validation, setValidation] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => { setFilters({status, from, to, customer}); setValidation(''); }, [status, from, to, customer]);
  useEffect(() => {
    let active = true;
    setLoading(true); setFailure(null); setResult(null);
    const params: ListParams = {page, page_size: 25, status: status || undefined, from: from || undefined, to: to || undefined, customer_id: customer || undefined};
    const invalid = !invoiceStatuses.some(value => value === status) || (from && !date.safeParse(from).success) || (to && !date.safeParse(to).success) || (from && to && from > to) || (customer && !uuid.safeParse(customer).success);
    if (invalid) { setFailure(new Error('Invalid invoice filters. Choose a supported status, valid dates and customer UUID.')); setLoading(false); return; }
    api.invoices(params).then(value => { if (active) setResult(value); }).catch(cause => { if (active) setFailure(cause); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, status, from, to, customer, version]);
  function navigate(values: typeof filters, nextPage = 1) {
    const query = new URLSearchParams();
    if (values.status) query.set('status', values.status);
    if (values.from) query.set('from', values.from);
    if (values.to) query.set('to', values.to);
    if (internal && values.customer) query.set('customer_id', values.customer);
    if (nextPage > 1) query.set('page', String(nextPage));
    router.replace(`?${query.toString()}`, {scroll: false});
    setVersion(value => value + 1);
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    if ((filters.from && !date.safeParse(filters.from).success) || (filters.to && !date.safeParse(filters.to).success) || (filters.from && filters.to && filters.from > filters.to)) { setValidation('Use valid dates, with the start on or before the end.'); return; }
    if (internal && filters.customer && !uuid.safeParse(filters.customer).success) { setValidation('Customer ID must be a valid UUID. Leave it blank for all customers.'); return; }
    setValidation(''); navigate(filters);
  }
  return <>
    <div className="page-heading"><div><h1 className="page-title">Invoices</h1><p className="page-description">{internal ? 'Review billing records, outstanding balances and invoice actions.' : 'Your billing history and recorded payments. Invoice and payment records are read-only.'} All dates use UTC.</p></div></div>
    <form className="toolbar no-print" onSubmit={apply} aria-label="Invoice filters">
      <Select label="Status" value={filters.status} onChange={event => setFilters({...filters, status: event.target.value})}>{invoiceStatuses.map(value => <option key={value} value={value}>{value || 'All statuses'}</option>)}</Select>
      <Field label="Issued from (UTC)" type="date" value={filters.from} onChange={event => setFilters({...filters, from: event.target.value})}/>
      <Field label="Issued through (UTC)" type="date" value={filters.to} min={filters.from || undefined} onChange={event => setFilters({...filters, to: event.target.value})}/>
      {internal && <CustomerFilter value={{id: filters.customer, name: selectedCustomer.id === filters.customer ? selectedCustomer.name : 'Selected customer'}} onChange={value => {setSelectedCustomer(value); setFilters({...filters, customer: value.id});}}/>}
      <Button type="submit">Apply filters</Button><Button type="button" variant="secondary" onClick={() => {setFilters({status: '', from: '', to: '', customer: ''}); setValidation(''); navigate({status: '', from: '', to: '', customer: ''});}}>Clear filters</Button>
    </form>
    {validation && <Notice error>{validation}</Notice>}
    <p className="text-muted"><small>Outstanding means confirmed with a positive balance. Overdue also requires a due date before today (UTC). Date filters apply to issue dates, including both endpoints.</small></p>
    {loading ? <Notice>Loading invoices…</Notice> : failure ? <><Notice error>{errorMessage(failure)}</Notice><div className="actions"><Button variant="secondary" onClick={() => setVersion(value => value + 1)}>Retry invoice list</Button><SignInRecovery cause={failure}/></div></> : result && <>
      {result.items.length ? <div className="table-wrap" role="region" aria-label="Invoice records, scroll horizontally for all columns" tabIndex={0}><table><caption className="sr-only">Invoices with server-returned totals and balances</caption><thead><tr><th scope="col">Invoice</th>{internal && <th scope="col">Customer</th>}<th scope="col">Status</th><th scope="col">Issued / due (UTC)</th><th scope="col">Total</th><th scope="col">Paid</th><th scope="col">Balance</th></tr></thead><tbody>{result.items.map(invoice => <tr key={invoice.id}>
        <th scope="row"><Link className="text-link" href={`/portal/invoices/${invoice.id}`}>{invoice.number}</Link></th>{internal && <td>{invoice.customer_snapshot.name}</td>}
        <td><Status>{invoice.status}</Status>{isOverdue(invoice) && <> <Status>Overdue</Status></>}</td><td>{invoice.issued_on}<span className="record-reference">Due {invoice.due_on}</span></td><td>{invoice.currency} {invoice.total}</td><td>{invoice.currency} {invoice.paid}</td><td>{invoice.currency} {invoice.balance}</td>
      </tr>)}</tbody></table></div> : <div className="empty-state"><h2>No invoices on this page</h2><p>{page > 1 ? 'Go to the previous page or change the filters.' : 'No billing records match these filters. Try another date range or status.'}</p></div>}
      <nav className="pagination" aria-label="Invoice pagination"><span className="pagination-summary">Page {result.page} · {result.items.length} records shown</span><div className="pagination-controls"><Button variant="secondary" disabled={result.page <= 1} onClick={() => navigate({status, from, to, customer}, result.page - 1)}>Previous</Button><Button variant="secondary" disabled={!result.has_more} onClick={() => navigate({status, from, to, customer}, result.page + 1)}>Next</Button></div></nav>
    </>}
  </>;
}

export function InvoiceView({id}: {id: string}) {
  return <PortalGate><InvoiceScreen key={id} id={id}/></PortalGate>;
}

function InvoiceScreen({id}: {id: string}) {
  const user = usePortalSession();
  const internal = user.role !== 'customer';
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [actionFailure, setActionFailure] = useState<unknown>(null);
  const [action, setAction] = useState<'confirm' | 'cancel' | 'send' | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [paymentLocked, setPaymentLocked] = useState(false);
  const mounted = useRef(false), sequence = useRef(0), mutation = useRef(false);
  const refresh = useCallback(async (): Promise<InvoiceDetail | null> => {
    const request = ++sequence.current;
    setLoading(true); setFailure(null);
    try {
      if (!uuid.safeParse(id).success) throw new Error('This invoice link is invalid. Return to the invoice list.');
      const value = await api.invoice(id);
      if (!mounted.current || request !== sequence.current) return null;
      setInvoice(value); setStale(false);
      return value;
    } catch (cause) {
      if (mounted.current && request === sequence.current) {setFailure(cause); setStale(true);}
      return null;
    } finally { if (mounted.current && request === sequence.current) setLoading(false); }
  }, [id]);
  useEffect(() => { mounted.current = true; void refresh(); return () => {mounted.current = false; sequence.current++;}; }, [refresh]);
  function beginMutation() { if (mutation.current || loading || stale || failure) return false; mutation.current = true; setBusy(true); return true; }
  function endMutation() { mutation.current = false; if (mounted.current) setBusy(false); }
  async function act() {
    if (!action || !invoice || paymentLocked || !beginMutation()) return;
    const currentAction = action;
    setMessage(''); setActionFailure(null); setAction(null);
    try {
      const result = await api.invoiceAction(id, currentAction);
      if (!mounted.current) return;
      if (!result.ok) throw new Error('The server did not confirm this action. Refresh the invoice before continuing.');
      setMessage(currentAction === 'send' ? emailMessage(result.email) : currentAction === 'confirm' ? 'Invoice confirmation saved. The refreshed record below is authoritative.' : 'Invoice cancellation saved.');
    } catch (cause) {
      if (!mounted.current) return;
      setActionFailure(cause);
      setMessage(`${errorMessage(cause)} The action may have changed the record. Refresh invoice status before any further action.`);
      setStale(true);
      return;
    } finally {endMutation();}
    await refresh();
  }
  const disabled = busy || loading || stale || Boolean(failure) || paymentLocked;
  return <>
    <div className="page-heading"><div><h1 className="page-title">{invoice && !failure ? invoice.number : 'Invoice'}</h1><p className="page-description">Brightloop · Invoice record. Dates and payment periods use UTC.</p></div><div className="actions no-print"><Link className="text-link" href="/portal/invoices">All invoices</Link><Button variant="secondary" disabled={busy || loading} onClick={() => void refresh()}>{loading ? 'Refreshing…' : 'Refresh invoice status'}</Button>{invoice && !failure && <Button disabled={busy || loading || stale} onClick={() => window.print()}>Print invoice</Button>}</div></div>
    {message && <div className="no-print"><Notice error={actionFailure !== null}>{message}</Notice><SignInRecovery cause={actionFailure}/></div>}
    {busy && <div className="no-print"><Notice>Saving the request. Please wait; do not submit another action.</Notice></div>}
    {failure !== null && <div className="no-print"><Notice error>{errorMessage(failure)}</Notice><SignInRecovery cause={failure}/></div>}
    {loading && <div className="no-print"><Notice>Loading the latest invoice and payment history…</Notice></div>}
    {stale && !loading && <div className="no-print"><Notice error>Actions are locked until invoice status has been refreshed successfully.</Notice></div>}
    {invoice && !failure && <>
      <Panel title="Invoice details">
        <div className="actions"><Status>{invoice.status}</Status>{isOverdue(invoice) && <Status>Overdue</Status>}{invoice.status === 'Confirmed' && compareMoney(invoice.paid, '0') > 0 && <Status>Partially paid</Status>}</div>
        <p><strong>Saved status: {invoice.status}</strong>{isOverdue(invoice) ? ' · Overdue (UTC)' : ''}</p>
        <div className="detail-grid"><section><h3>Billed to</h3><dl className="detail-list"><div><dt>Customer</dt><dd>{invoice.customer_snapshot.name}</dd></div><div><dt>Email</dt><dd>{invoice.customer_snapshot.email}</dd></div><div><dt>Address</dt><dd style={{whiteSpace: 'pre-wrap'}}>{invoice.customer_snapshot.address || 'No address on this invoice snapshot'}</dd></div></dl></section><section><h3>Billing record</h3><dl className="detail-list"><div><dt>Issuer</dt><dd>Brightloop</dd></div><div><dt>Issued (UTC)</dt><dd>{invoice.issued_on}</dd></div><div><dt>Due (UTC)</dt><dd>{invoice.due_on}</dd></div><div><dt>Period</dt><dd>{invoice.period_start} – {invoice.period_end} (end exclusive)</dd></div><div><dt>Subscription</dt><dd><Link className="text-link" href={`/portal/subscriptions/${invoice.subscription_id}`}>{invoice.subscription_id}</Link></dd></div><div><dt>Currency</dt><dd>{invoice.currency}</dd></div></dl></section></div>
        <h3>Invoice lines</h3>
        <div className="table-wrap" role="region" aria-label="Invoice line items, scroll horizontally for all columns" tabIndex={0}><table><caption className="sr-only">Saved invoice lines; all amounts in {invoice.currency}</caption><thead><tr><th scope="col">Description</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Discount</th><th scope="col">Tax rate</th><th scope="col">Tax</th><th scope="col">Line total</th></tr></thead><tbody>{invoice.lines.map(line => <tr key={line.id}><th scope="row">{line.description}</th><td>{line.quantity}</td><td>{invoice.currency} {line.unit_price}</td><td>{invoice.currency} {line.discount_amount}</td><td>{line.tax_rate}%</td><td>{invoice.currency} {line.tax_amount}</td><td>{invoice.currency} {line.total}</td></tr>)}</tbody></table></div>
        {!invoice.lines.length && <Notice>No saved line items were returned for this invoice.</Notice>}
        <div className="detail-grid"><div><h3>Snapshot totals</h3><p className="text-muted"><small>These amounts are saved by the billing service, not calculated in your browser.</small></p></div><dl className="detail-list">{([['Subtotal', invoice.subtotal], ['Discount', invoice.discount_total], ['Tax', invoice.tax_total], ['Total', invoice.total], ['Payments received', invoice.paid], ['Outstanding balance', invoice.balance]] as const).map(([label, amount]) => <div key={label}><dt>{label}</dt><dd><strong>{invoice.currency} {amount}</strong></dd></div>)}</dl></div>
      </Panel>
      <Panel title="Payment history">{invoice.payments.length ? <div className="table-wrap" role="region" aria-label="Recorded invoice payments" tabIndex={0}><table><caption className="sr-only">Payments already received; dates use UTC</caption><thead><tr><th scope="col">Paid on (UTC)</th><th scope="col">Amount</th><th scope="col">Method</th><th scope="col">Note</th><th scope="col">Reference</th></tr></thead><tbody>{invoice.payments.map(payment => <tr key={payment.id}><td>{payment.paid_on}</td><td>{invoice.currency} {payment.amount}</td><td>{methods[payment.method]}</td><td style={{whiteSpace: 'pre-wrap'}}>{payment.note || '—'}</td><td>{payment.id}</td></tr>)}</tbody></table></div> : <p>No payments have been recorded for this invoice.</p>}</Panel>
      {internal && <div className="no-print">
        <Panel title="Staff invoice actions"><p>These actions change the saved invoice. Customers cannot confirm, cancel, send or record payments.</p><div className="actions">
          {invoice.status === 'Draft' && <Button disabled={disabled} onClick={() => setAction('confirm')}>Confirm invoice</Button>}
          {(invoice.status === 'Draft' || invoice.status === 'Confirmed') && compareMoney(invoice.paid, '0') === 0 && <Button variant="danger" disabled={disabled} onClick={() => setAction('cancel')}>Cancel unpaid invoice</Button>}
          {(invoice.status === 'Confirmed' || invoice.status === 'Paid') && invoice.email?.status === 'not_queued' && <Button variant="secondary" disabled={disabled} onClick={() => setAction('send')}>Queue invoice email</Button>}
        </div><h3>Email queue</h3>{invoice.email && <Status>{invoice.email.status === 'sent' ? 'SMTP accepted' : invoice.email.status === 'not_queued' ? 'Not queued' : invoice.email.status[0].toUpperCase() + invoice.email.status.slice(1)}</Status>}<p>{emailMessage(invoice.email)}</p>{invoice.email && <dl className="detail-list"><div><dt>Attempts</dt><dd>{invoice.email.attempts}</dd></div>{invoice.email.sent_at && <div><dt>SMTP accepted at (UTC)</dt><dd>{new Date(invoice.email.sent_at).toISOString()}</dd></div>}{invoice.email.last_error && <div><dt>Last failure</dt><dd>{invoice.email.last_error}</dd></div>}</dl>}<p><small>Use Refresh invoice status to check worker progress. Email transport is at least once; inbox delivery is never guaranteed.</small></p></Panel>
        <ManualPayment invoice={invoice} userId={user.id} disabled={busy || loading || stale || Boolean(failure)} beginMutation={beginMutation} endMutation={endMutation} refresh={refresh} onLockChange={setPaymentLocked}/>
      </div>}
      <ConfirmDialog open={action !== null} onOpenChange={open => {if (!open) setAction(null);}} title={action === 'confirm' ? 'Confirm this invoice?' : action === 'cancel' ? 'Cancel this unpaid invoice?' : 'Queue this invoice email?'} description={action === 'confirm' ? `Confirm ${invoice.number} for ${invoice.currency} ${invoice.total}. This makes the invoice payable; a zero-total invoice becomes Paid.` : action === 'cancel' ? `Cancel ${invoice.number}. It must have no payments. Pending email is removed; discount usage is not restored. There is no undo action.` : `Queue ${invoice.number} to ${invoice.customer_snapshot.email}. Queue success does not mean delivered. The existing queue is not duplicated by repeat requests.`} confirmLabel={action === 'confirm' ? 'Confirm invoice' : action === 'cancel' ? 'Cancel invoice' : 'Queue email'} pending={busy} onConfirm={act}/>
    </>}
  </>;
}
