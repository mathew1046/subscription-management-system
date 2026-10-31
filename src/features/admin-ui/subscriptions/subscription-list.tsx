'use client';

import Link from 'next/link';
import {useEffect, useState, type ChangeEvent} from 'react';
import {api} from '@/lib/client';
import type {Page, Subscription} from '@/lib/contracts';
import {Button, Notice, Select} from '@/components/ui';
import {LookupSelect, useAdminSession} from '@/features/admin-ui/shared';
import {CustomerNamesStatus, useCustomerNames} from '@/features/admin-ui/shared/customer-names';
import {dateLabel, errorMessage, SubscriptionStatus} from './presentation';

export function SubscriptionList() {
  const session = useAdminSession();
  const allowed = session.user?.role === 'admin' || session.user?.role === 'staff';
  const [customer, setCustomer] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Page<Subscription> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const customers = useCustomerNames(allowed ? data?.items.map(item => item.customer_id) || [] : []);

  useEffect(() => {
    if (!allowed) return;
    let current = true;
    setLoading(true);
    setError('');
    api.subscriptions({page, page_size: 25, customer_id: customer || undefined, status: status || undefined})
      .then(result => {if (current) setData(result);})
      .catch(reason => {if (current) setError(errorMessage(reason));})
      .finally(() => {if (current) setLoading(false);});
    return () => {current = false;};
  }, [allowed, customer, status, page, revision]);

  if (session.loading) return <Notice>Loading your workspace…</Notice>;
  if (session.error) return <><Notice error>{session.error}</Notice><Button onClick={session.reload}>Reload session</Button></>;
  if (!allowed) return <Notice error>Administrator or staff access is required to manage subscriptions.</Notice>;

  return <>
    <header className="page-heading">
      <div><h1 className="page-title">Subscriptions</h1><p className="page-description">Agreements, quotations and their next billing dates.</p></div>
      <Link className="button" href="/admin/subscriptions/new">New subscription</Link>
    </header>
    <div className="toolbar subscription-filters" aria-label="Subscription filters">
      <LookupSelect resource="customers" label="Customer" value={customer} optional emptyLabel="All customers" onChange={(value: string) => {setCustomer(value); setPage(1);}} />
      <Select label="Lifecycle status" value={status} onChange={(event: ChangeEvent<HTMLSelectElement>) => {setStatus(event.target.value); setPage(1);}}>
        <option value="">All statuses</option>
        {['Draft', 'Quotation', 'Confirmed', 'Active', 'Closed'].map(value => <option key={value}>{value}</option>)}
      </Select>
      {(customer || status) && <Button variant="ghost" onClick={() => {setCustomer(''); setStatus(''); setPage(1);}}>Clear filters</Button>}
    </div>
    <p className="text-muted">Status is the saved lifecycle stage. Paused, scheduled and expired labels describe the agreement separately. All dates are UTC.</p>
    <CustomerNamesStatus lookup={customers}/>
    {error && <><Notice error>{error}</Notice><Button variant="secondary" onClick={() => setRevision(value => value + 1)}>Reload subscriptions</Button></>}
    {loading ? <Notice>Loading subscriptions…</Notice> : !error && data && <>
      {data.items.length === 0 ? <section className="empty-state"><h2>No subscriptions found</h2><p>{customer || status ? 'Adjust the filters to find an agreement.' : 'Create a draft to prepare your first customer quotation.'}</p><Link className="text-link" href="/admin/subscriptions/new">Create a subscription</Link></section> :
        <><p className="table-scroll-hint" id="subscription-scroll-hint">Scroll horizontally to see dates and billing details →</p><div className="table-wrap" role="region" aria-label="Subscriptions" aria-describedby="subscription-scroll-hint" tabIndex={0}>
          <table><thead><tr><th scope="col">Subscription</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Start</th><th scope="col">End (exclusive)</th><th scope="col">Next billing</th></tr></thead>
            <tbody>{data.items.map(subscription => <tr key={subscription.id}>
              <td><Link className="text-link" href={`/admin/subscriptions/${subscription.id}`}>{subscription.number}</Link></td>
              <td><span>{customers.names[subscription.customer_id] || 'Customer'}</span><span className="record-reference" title={subscription.customer_id}>Ref · {subscription.customer_id.slice(-8)}</span></td>
              <td><SubscriptionStatus subscription={subscription} /></td>
              <td>{dateLabel(subscription.start_date)}</td><td>{dateLabel(subscription.end_date)}</td>
              <td>{subscription.status === 'Closed' ? 'Not scheduled' : <>{dateLabel(subscription.next_billing_date)}{subscription.paused && <div className="text-muted">Billing paused</div>}{subscription.status !== 'Active' && <div className="text-muted">Awaiting activation</div>}{subscription.billing_error && <div>Billing needs attention</div>}</>}</td>
            </tr>)}</tbody>
          </table>
        </div></>}
      <nav className="pagination" aria-label="Subscription pages">
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button>
        <span aria-live="polite">Page {data.page}</span>
        <Button variant="secondary" disabled={!data.has_more} onClick={() => setPage(value => value + 1)}>Next</Button>
      </nav>
    </>}
  </>;
}
