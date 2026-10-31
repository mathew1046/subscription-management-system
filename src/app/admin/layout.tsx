import type {ReactNode} from 'react';
import {AdminSessionProvider} from '@/features/admin-ui/shared';

export default function AdminLayout({children}: {children: ReactNode}) {
  return <AdminSessionProvider>{children}</AdminSessionProvider>;
}
