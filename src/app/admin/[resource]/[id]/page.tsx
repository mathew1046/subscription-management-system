import {notFound} from 'next/navigation';
import {id as uuid} from '@/lib/contracts';
import {SubscriptionCreate} from '@/features/admin-ui/subscriptions/subscription-create';
import {SubscriptionDetailScreen} from '@/features/admin-ui/subscriptions/subscription-detail';

export default async function AdminDetailPage({params, searchParams}: {
  params: Promise<{resource: string; id: string}>;
  searchParams: Promise<{template?: string | string[]}>;
}) {
  const {resource, id} = await params;
  if (resource !== 'subscriptions') notFound();
  if (id === 'new') {
    const {template} = await searchParams;
    const templateId = Array.isArray(template) ? template[0] : template;
    return <SubscriptionCreate key={templateId || 'blank'} templateId={templateId} />;
  }
  if (!uuid.safeParse(id).success) notFound();
  return <SubscriptionDetailScreen key={id} id={id} />;
}
