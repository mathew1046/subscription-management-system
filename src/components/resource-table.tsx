'use client';
import {useEffect,useState} from 'react';
import {Button,Notice} from './ui';
import type {Page} from '@/lib/contracts';
export function ResourceTable<T extends {id:string}>({load,columns}:{load:(page:number)=>Promise<Page<T>>;columns:{label:string;render:(row:T)=>React.ReactNode}[]}){
 const [page,setPage]=useState(1),[data,setData]=useState<Page<T>|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setData(null);setError('');load(page).then(v=>{if(active)setData(v)}).catch(e=>{if(active)setError(e.message||'Unable to load records.')});return()=>{active=false}},[page,load]);
 if(error)return <Notice error>{error}</Notice>;
 if(!data)return <Notice>Loading records…</Notice>;
 return <>{data.items.length===0?<Notice>No records yet.</Notice>:<div className="table-wrap"><table><thead><tr>{columns.map(c=><th key={c.label}>{c.label}</th>)}</tr></thead><tbody>{data.items.map(row=><tr key={row.id}>{columns.map(c=><td key={c.label}>{c.render(row)}</td>)}</tr>)}</tbody></table></div>}<div className="actions"><Button className="secondary" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</Button><span>Page {page}</span><Button disabled={!data.has_more} onClick={()=>setPage(p=>p+1)}>Next</Button></div></>;
}
