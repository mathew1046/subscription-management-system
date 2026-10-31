'use client';

import Link from 'next/link';
import {createContext, useContext, useEffect, useState, type ReactNode} from 'react';
import {api, ApiError} from '@/lib/client';
import type {User} from '@/lib/contracts';
import {Button, Notice} from '@/components/ui';

const PortalSession = createContext<User|null>(null);

export function usePortalSession():User {
  const user=useContext(PortalSession);
  if(!user) throw new Error('Portal screens must be rendered inside PortalGate.');
  return user;
}

export function PortalGate({children,internalOnly=false}:{children:ReactNode;internalOnly?:boolean}) {
  const [user,setUser]=useState<User|null>(null);
  const [error,setError]=useState('');
  const [signedOut,setSignedOut]=useState(false);
  const [loading,setLoading]=useState(true);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');setSignedOut(false);
    api.me().then(result=>{if(active)setUser(result)}).catch(cause=>{
      if(!active)return;
      setUser(null);
      setSignedOut(cause instanceof ApiError&&cause.status===401);
      setError(cause instanceof ApiError&&cause.status===401?'Your session has ended or you are not signed in.': 'We could not check your session. Retry before continuing.');
    }).finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[attempt]);
  if(loading)return <Notice>Checking your session…</Notice>;
  if(!user)return <section className="empty-state"><h1>{signedOut?'Sign in to continue':'Session unavailable'}</h1><Notice error>{error}</Notice><div className="actions">{!signedOut&&<Button variant="secondary" onClick={()=>setAttempt(value=>value+1)}>Retry session</Button>}<Link className="button" href={signedOut?'/login?reason=session-expired':'/login'}>Go to sign in</Link></div></section>;
  if(internalOnly&&user.role==='customer')return <section className="empty-state"><h1>Staff access only</h1><p>This workspace is for administrators and staff. Your subscriptions and invoices are available in your account.</p><Link className="button" href="/portal/subscriptions">Go to my subscriptions</Link></section>;
  return <PortalSession.Provider value={user}>{children}</PortalSession.Provider>;
}
