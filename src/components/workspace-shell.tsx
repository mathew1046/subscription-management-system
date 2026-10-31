'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api} from '@/lib/client';
import type {User} from '@/lib/contracts';
export function WorkspaceShell({children}:{children:React.ReactNode}){
 const [user,setUser]=useState<User|null>(null);
 useEffect(()=>{let active=true;api.me().then(u=>{if(active)setUser(u)}).catch(()=>{});return()=>{active=false}},[]);
 return <div className="workspace"><aside><Link className="brand" href="/">◈ Brightloop</Link><small>SUBSCRIPTION OPERATIONS</small><nav><Link href="/">Overview</Link>{user?.role!=='customer'&&<><Link href="/admin/products">Products</Link><Link href="/admin/plans">Plans</Link><Link href="/admin/subscriptions">Subscriptions</Link><Link href="/finance">Finance</Link></>}<Link href="/portal/subscriptions">My subscriptions</Link><Link href="/portal/invoices">My invoices</Link></nav><div className="identity">{user?<><strong>{user.name}</strong><span>{user.role}</span><button onClick={()=>api.logout().then(()=>{window.location.href='/login'})}>Sign out</button></>:<Link href="/login">Sign in →</Link>}</div></aside><main><header><span>Brightloop Software</span><span className="badge">Self-hosted workspace</span></header>{children}</main></div>;
}
