'use client';

import {useEffect, useState} from 'react';
import {api, ApiError} from '@/lib/client';
import type {Customer, Page} from '@/lib/contracts';
import {Button, Notice, Select} from '@/components/ui';

export function CustomerFilter({value, onChange}: {
  value: {id: string; name: string};
  onChange: (customer: {id: string; name: string}) => void;
}) {
  const [request, setRequest] = useState({page: 1, revision: 0});
  const [result, setResult] = useState<{request: typeof request; data?: Page<Customer>; error?: string} | null>(null);
  const current = result?.request === request ? result : null;
  const pending = !current;
  useEffect(() => {
    let active = true;
    api.list('customers', {page: request.page, page_size: 25}).then(data => {
      if (active) setResult({request, data});
    }).catch(cause => {
      if (active) setResult({request, error: cause instanceof ApiError && cause.status === 401
        ? 'Your session expired. Sign in again to choose a customer.'
        : cause instanceof Error ? cause.message : 'Customers could not be loaded.'});
    });
    return () => { active = false; };
  }, [request]);

  const choices = current?.data?.items ?? [];
  return <div className="lookup-control">
    <Select label="Customer" value={value.id} aria-describedby="finance-customer-help" onChange={event => {
      const customer = choices.find(item => item.id === event.target.value);
      onChange(customer ? {id: customer.id, name: customer.name} : {id: '', name: ''});
    }}>
      <option value="">All customers</option>
      {value.id && !choices.some(item => item.id === value.id) && <option value={value.id}>{value.name}</option>}
      {choices.map(customer => <option key={customer.id} value={customer.id}>{customer.name} · {customer.email}</option>)}
    </Select>
    <div className="lookup-pagination" id="finance-customer-help">
      <span role="status">{pending ? 'Loading customers…' : current?.error ? 'Customer choices unavailable.' : `Customer page ${current?.data?.page ?? request.page}${choices.length === 0 ? ' · No customers on this page' : ''}`}</span>
      <div className="actions">
        <Button type="button" variant="secondary" disabled={pending || request.page === 1} onClick={() => setRequest(previous => ({...previous, page: previous.page - 1}))} aria-label="Previous customer page">Previous customers</Button>
        <Button type="button" variant="secondary" disabled={pending || !current?.data?.has_more} onClick={() => setRequest(previous => ({...previous, page: previous.page + 1}))} aria-label="Next customer page">Next customers</Button>
      </div>
    </div>
    {current?.error && <>
      <Notice error>{current.error} The selected customer is preserved.</Notice>
      <Button type="button" variant="secondary" onClick={() => setRequest(previous => ({...previous, revision: previous.revision + 1}))}>Retry customers</Button>
    </>}
  </div>;
}
