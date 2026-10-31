'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/client';
import { Button, Select } from '@/components/ui';
import { ResourceTable } from '@/components/resource-table';
import { PortalGate, usePortalSession } from '@/features/portal-finance-ui/shared';
import { SubscriptionState } from './presentation';

export function SubscriptionRecords() {
  return <PortalGate><SubscriptionList /></PortalGate>;
}

function SubscriptionList() {
  const user = usePortalSession();
  const [status, setStatus] = useState('');
  const [refresh, setRefresh] = useState(0);
  const load = useCallback(async (page: number) => {
    try { return await api.subscriptions({ page, page_size: 25, status: status || undefined }); }
    catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) window.location.replace('/login?reason=session-expired');
      throw cause;
    }
  }, [status]);
  return <>
    <div className="page-heading"><div><h1 className="page-title">{user.role === 'customer' ? 'My subscriptions' : 'Subscriptions'}</h1><p className="page-description">View agreement terms and manage permitted changes. Dates and billing schedules use UTC.</p></div></div>
    <div className="toolbar">
      <Select label="Saved lifecycle status" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">All statuses</option>{['Draft', 'Quotation', 'Confirmed', 'Active', 'Closed'].map(value => <option key={value}>{value}</option>)}
      </Select>
      <Button type="button" variant="secondary" onClick={() => { setStatus(''); setRefresh(value => value + 1); }}>Reset filters</Button>
      <Button type="button" variant="secondary" onClick={() => setRefresh(value => value + 1)}>Refresh records</Button>
    </div>
    <p className="field-help">Active is a saved lifecycle stage: scheduled, paused and expired agreements can remain in that stage. Open an agreement for its current terms.</p>
    <ResourceTable load={load} refreshKey={refresh} label="Subscriptions" emptyMessage={user.role === 'customer' ? 'No subscriptions match this status. Try all statuses. If you expected an agreement, ask staff to link your account to your customer record.' : 'No subscriptions match this status. Try all statuses.'} columns={[
      { label: 'Agreement', render: row => <Link href={`/portal/subscriptions/${row.id}`}>{row.number}</Link> },
      { label: 'Plan', render: row => row.plan_snapshot.name },
      { label: 'Current state', render: row => <SubscriptionState subscription={row} /> },
      { label: 'Starts (UTC)', render: row => row.start_date },
      { label: 'Ends, exclusive (UTC)', render: row => row.end_date },
      { label: 'Next billing (UTC)', render: row => row.status === 'Closed' ? 'No further billing' : row.paused ? `${row.next_billing_date} (paused)` : row.next_billing_date },
    ]} />
  </>;
}
