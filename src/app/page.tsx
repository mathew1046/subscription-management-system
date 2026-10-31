'use client';

import Link from 'next/link';
import {ArrowUpRight} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Button, Notice} from '@/components/ui';
import {api, ApiError} from '@/lib/client';
import type {User} from '@/lib/contracts';

export default function Home() {
  const [user,setUser]=useState<User|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let current=true;
    setLoading(true);setError('');
    api.me().then(result=>{if(current)setUser(result)}).catch(reason=>{
      if(current && !(reason instanceof ApiError && reason.status===401))setError(reason instanceof Error ? reason.message : 'Your workspace could not be loaded.');
    }).finally(()=>{if(current)setLoading(false)});
    return()=>{current=false};
  },[attempt]);
  if(loading)return <Notice>Loading your workspace…</Notice>;
  if(error)return <><h1>Your workspace</h1><Notice error>{error}</Notice><Button onClick={()=>setAttempt(value=>value+1)}>Retry workspace</Button></>;
  if(!user)return <div className="welcome"><h1>Welcome to Brightloop.</h1><p className="lead">Sign in to manage your subscriptions, or create an account to access your customer portal.</p><div className="actions"><Link className="button" href="/login">Sign in</Link><Link className="button secondary" href="/signup">Create account</Link></div></div>;
  const customer=user.role==='customer';
  const destinations=customer ? [
    {title:'My subscriptions',description:'Review your agreements and saved subscription terms.',href:'/portal/subscriptions'},
    {title:'My invoices',description:'View invoice details, balances and printable copies.',href:'/portal/invoices'},
  ] : [
    {title:'Subscriptions',description:'Prepare agreements and manage their billing lifecycle.',href:'/admin/subscriptions'},
    {title:'Customers',description:'Find billing contacts and manage customer details.',href:'/admin/customers'},
    {title:'Finance',description:'Review invoices, recorded payments and outstanding balances.',href:'/finance'},
    ...(user.role==='admin' ? [{title:'Catalog & plans',description:'Set up products, recurring plans and pricing rules.',href:'/admin/products'}] : []),
  ];
  return <><header className="page-heading"><div><h1 className="page-title">Your workspace</h1><p className="page-description">Welcome back, {user.name}. {customer ? 'Your subscriptions and invoices, in one place.' : 'Choose where to continue your subscription operations.'}</p></div></header><nav className="workspace-destinations" aria-label="Workspace shortcuts">{destinations.map(item=><Link key={item.href} href={item.href}><div><h2>{item.title}</h2><p>{item.description}</p></div><ArrowUpRight size={20} aria-hidden="true"/></Link>)}</nav></>;
}
