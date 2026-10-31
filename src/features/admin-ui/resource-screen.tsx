'use client';

import Link from 'next/link';
import {schemas} from '@/lib/contracts';
import {Notice} from '@/components/ui';
import {CatalogScreen} from './catalog/catalog-screen';
import {SubscriptionList} from './subscriptions/subscription-list';

export function ResourceScreen({resource}: {resource: string}) {
  if (resource === 'subscriptions') return <SubscriptionList/>;
  if (resource === 'staff') return <CatalogScreen resource="staff"/>;
  if (Object.hasOwn(schemas, resource)) return <CatalogScreen resource={resource as keyof typeof schemas}/>;
  return <section className="empty-state"><h1>Section not found</h1><Notice error>This workspace section does not exist.</Notice><Link className="button secondary" href="/admin/subscriptions">View subscriptions</Link></section>;
}
