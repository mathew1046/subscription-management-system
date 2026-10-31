import type { Metadata } from 'next';
import './globals.css';
import {WorkspaceShell} from '@/components/workspace-shell';
export const metadata:Metadata={title:'Brightloop — Subscription operations',description:'Self-hosted subscription and recurring billing management'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><WorkspaceShell>{children}</WorkspaceShell></body></html>}
