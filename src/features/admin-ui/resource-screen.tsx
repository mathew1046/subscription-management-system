'use client';
import {useCallback} from 'react';
import {api} from '@/lib/client';
import type {Page,Resource} from '@/lib/contracts';
import {ResourceTable} from '@/components/resource-table';
import {Panel,Notice} from '@/components/ui';
const resources=['products','variants','plans','taxes','discounts','customers','quotation-templates','subscriptions','staff'];
export function ResourceScreen({resource}:{resource:string}){
 const load=useCallback(async(page:number):Promise<Page<{id:string;name?:string;number?:string;status?:string}>>=>{if(resource==='subscriptions')return api.subscriptions({page});if(resource==='staff')return api.staff({page});return api.list(resource as Resource,{page})},[resource]);
 if(!resources.includes(resource))return <Notice error>Unknown workspace section.</Notice>;
 return <><span className="eyebrow">OPERATIONS</span><h1>{resource.replaceAll('-',' ')}</h1><Panel title="Records"><ResourceTable load={load} columns={[{label:'Name / number',render:r=>r.name||r.number||'—'},{label:'Status',render:r=>r.status||'—'},{label:'Reference',render:r=>r.id}]}/></Panel><footer>Shaheem owns the editing workflows for this screen. The records above come from the live API.</footer></>;
}
