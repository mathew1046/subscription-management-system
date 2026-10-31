'use client';

import {useEffect, useState} from 'react';
import {api} from '@/lib/client';
import {Button, Notice} from '@/components/ui';

export function useCustomerNames(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',');
  const [request, setRequest] = useState({key: '', page: 1, attempt: 0});
  const [result, setResult] = useState({key: '', names: {} as Record<string, string>, loading: false, hasMore: false, error: ''});
  useEffect(() => {setRequest({key, page: 1, attempt: 0});}, [key]);
  useEffect(() => {
    if (!key || request.key !== key) return;
    let active = true;
    setResult(previous => ({key, names: previous.key === key ? previous.names : {}, loading: true, hasMore: false, error: ''}));
    api.list('customers', {page: request.page, page_size: 100}).then(page => {
      if (active) setResult(previous => ({key, names: {...previous.names, ...Object.fromEntries(page.items.map(customer => [customer.id, customer.name]))}, loading: false, hasMore: page.has_more, error: ''}));
    }).catch(error => {
      if (active) setResult(previous => ({...previous, loading: false, error: error instanceof Error ? error.message : 'Customer names could not be loaded.'}));
    });
    return () => {active = false;};
  }, [key, request]);
  const names = result.key === key ? result.names : {};
  return {
    names,
    loading: Boolean(key) && (result.key !== key || result.loading),
    error: result.key === key ? result.error : '',
    hasMore: result.key === key && result.hasMore && ids.some(id => !names[id]),
    loadMore: () => setRequest(previous => ({...previous, page: previous.page + 1})),
    retry: () => setRequest(previous => ({...previous, attempt: previous.attempt + 1})),
  };
}

export function CustomerNamesStatus({lookup}: {lookup: ReturnType<typeof useCustomerNames>}) {
  return <>
    {lookup.loading && <p className="text-muted" role="status">Loading customer names…</p>}
    {lookup.error && <><Notice error>Customer names are unavailable. References remain usable. {lookup.error}</Notice><Button variant="secondary" onClick={lookup.retry}>Retry customer names</Button></>}
    {!lookup.loading && lookup.hasMore && <p className="text-muted">Some customers are on later pages. <Button variant="ghost" onClick={lookup.loadMore}>Load more customer names</Button></p>}
  </>;
}
