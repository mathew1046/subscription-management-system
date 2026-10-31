'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Boxes, ChevronRight, FileText, LayoutDashboard, LogOut, Menu, Package, Percent, Receipt, Repeat2, Settings2, Shapes, Tags, Users, UserRoundCog, X, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/client';
import type { User } from '@/lib/contracts';
import { Button } from './ui';

type NavItem = { label: string; href: string; icon: LucideIcon };
const operations: NavItem[] = [
  { label: 'Subscriptions', href: '/admin/subscriptions', icon: Repeat2 },
  { label: 'Customers', href: '/admin/customers', icon: Users },
  { label: 'Invoices', href: '/portal/invoices', icon: Receipt },
  { label: 'Finance', href: '/finance', icon: LayoutDashboard },
];
const configuration: NavItem[] = [
  { label: 'Products', href: '/admin/products', icon: Package },
  { label: 'Variants', href: '/admin/variants', icon: Shapes },
  { label: 'Recurring plans', href: '/admin/plans', icon: Boxes },
  { label: 'Quotation templates', href: '/admin/quotation-templates', icon: FileText },
  { label: 'Taxes', href: '/admin/taxes', icon: Percent },
  { label: 'Discounts', href: '/admin/discounts', icon: Tags },
];
const customerNavigation: NavItem[] = [
  { label: 'My subscriptions', href: '/portal/subscriptions', icon: Repeat2 },
  { label: 'My invoices', href: '/portal/invoices', icon: Receipt },
];

export function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return <Link className="brand" href="/" onClick={onNavigate} aria-label="Brightloop home">
    <svg className="brand-mark" width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M13 4h5a9 9 0 0 1 0 18h-4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M19 28h-5a9 9 0 0 1 0-18h4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
    <span>brightloop<span className="brand-period">.</span></span>
  </Link>;
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<{ path: string; user: User | null; error: string; signedOut: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signoutError, setSignoutError] = useState('');
  const logoutInFlight = useRef(false);
  const current = session?.path === pathname ? session : null;
  const user = current?.user ?? null;

  useEffect(() => {
    let active = true;
    setSession(null);
    api.me().then(value => {
      if (active) setSession({ path: pathname, user: value, error: '', signedOut: false });
    }).catch(cause => {
      if (active) setSession({ path: pathname, user: null, error: cause instanceof Error ? cause.message : 'Unable to check your session.', signedOut: cause instanceof ApiError && cause.status === 401 });
    });
    return () => { active = false; };
  }, [pathname, attempt]);

  async function signOut() {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setSigningOut(true);
    setSignoutError('');
    try { await api.logout(); window.location.assign('/login'); }
    catch (cause) {
      setSignoutError(cause instanceof Error ? cause.message : 'Sign out did not complete. Please retry.');
      setSigningOut(false);
      logoutInFlight.current = false;
    }
  }

  function navLinks(items: NavItem[]) {
    return items.map(({ label, href, icon: Icon }) => {
      const selected = pathname === href || pathname.startsWith(`${href}/`);
      return <Link key={href} href={href} className={`nav-link${selected ? ' selected' : ''}`} aria-current={selected ? 'page' : undefined} onClick={() => setDrawerOpen(false)}><Icon size={18} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span></Link>;
    });
  }

  function sidebar() {
    return <>
      <div className="rail-brand"><Brand onNavigate={() => setDrawerOpen(false)} /></div>
      <div className="rail-content">
        {!current ? <p className="session-state" role="status">Checking your session…</p> : !user ? <div className="session-state">
          {!current.signedOut && <><p role="alert">{current.error}</p><Button type="button" variant="secondary" onClick={() => setAttempt(value => value + 1)}>Retry session</Button></>}
          <Link className="text-link" href="/login" onClick={() => setDrawerOpen(false)}>Sign in to your workspace</Link>
        </div> : <nav aria-label="Workspace navigation">
          {user.role === 'customer' ? <div className="nav-group"><p className="nav-heading">Your account</p>{navLinks(customerNavigation)}</div> : <>
            <div className="nav-group"><p className="nav-heading">Workspace</p>{navLinks(operations)}</div>
            <div className="nav-group"><p className="nav-heading">{user.role === 'staff' ? 'Configuration · read only' : 'Configuration'}</p>{navLinks(configuration)}</div>
            {user.role === 'admin' && <div className="nav-group"><p className="nav-heading">Administration</p>{navLinks([{ label: 'Staff', href: '/admin/staff', icon: UserRoundCog }])}</div>}
          </>}
        </nav>}
      </div>
      <div className="identity">
        {user ? <>
          <div className="identity-person"><span className="identity-avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><span className="identity-role">{user.role === 'admin' ? 'Administrator' : user.role === 'staff' ? 'Staff workspace' : 'Customer account'}</span></div></div>
          <Button type="button" variant="ghost" className="signout-button" disabled={signingOut} onClick={signOut}><LogOut size={16} aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out'}</Button>
          {signoutError && <p className="signout-error" role="alert">{signoutError}</p>}
        </> : <span className="rail-footnote">Subscription management</span>}
      </div>
    </>;
  }

  const route = [...operations, ...configuration, ...customerNavigation, { label: 'Staff', href: '/admin/staff', icon: Settings2 }].find(item => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const section = pathname.startsWith('/admin') ? 'Workspace' : pathname.startsWith('/portal') ? 'Account' : pathname.startsWith('/finance') ? 'Workspace' : 'Brightloop';

  return <div className="workspace">
    <a className="skip-link" href="#workspace-content">Skip to content</a>
    <aside className="workspace-rail" aria-label="Primary sidebar">{sidebar()}</aside>
    <main id="workspace-content" tabIndex={-1}>
      <header className="workspace-header">
        <div className="header-context">
          <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <Dialog.Trigger asChild><Button type="button" variant="ghost" className="mobile-menu icon-button" aria-label="Open navigation"><Menu size={22} aria-hidden="true" /></Button></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay navigation-overlay" />
              <Dialog.Content className="navigation-drawer" aria-describedby={undefined}>
                <Dialog.Title className="sr-only">Workspace navigation</Dialog.Title>
                <Dialog.Close asChild><Button type="button" variant="ghost" className="drawer-close icon-button" aria-label="Close navigation"><X size={20} aria-hidden="true" /></Button></Dialog.Close>
                {sidebar()}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <span className="header-section">{section}</span>{route && <><ChevronRight size={14} aria-hidden="true" /><span className="header-page">{route.label}</span></>}
        </div>
        <span className="workspace-label">{user?.role === 'customer' ? 'Customer portal' : 'Subscription operations'}</span>
      </header>
      <div className="workspace-content">{children}</div>
    </main>
  </div>;
}
