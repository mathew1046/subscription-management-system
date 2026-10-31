'use client';

import {useEffect, useRef, useState, type ComponentType, type ReactNode} from 'react';
import {Button, ConfirmDialog, Notice, Panel} from '@/components/ui';
import type {Page} from '@/lib/contracts';
import {ApiError} from '@/lib/client';
import {errorMessage} from './form-helpers';

export interface Column<T> {label:string;render:(record:T)=>ReactNode}

export function CatalogWorkspace<T extends {id:string;name:string},Input>({title,singular,description,canManage,load,create,update,archive,canArchive,Editor,columns,extraActions}:{
  title:string;singular:string;description:string;canManage:boolean;
  load:(page:number)=>Promise<Page<T>>;
  create:(input:Input)=>Promise<T>;
  update?:(id:string,input:Input)=>Promise<T>;
  archive?:(record:T)=>Promise<unknown>;
  canArchive?:(record:T)=>boolean;
  Editor:ComponentType<{record:T|null;onSave:(input:Input)=>Promise<void>;onCancel:()=>void;pending:boolean;error:string}>;
  columns:Column<T>[];
  extraActions?:(record:T)=>ReactNode;
}) {
  const [page,setPage]=useState(1);
  const [refreshKey,setRefreshKey]=useState(0);
  const [data,setData]=useState<Page<T>|null>(null);
  const [listError,setListError]=useState('');
  const [editor,setEditor]=useState<{record:T|null}|null>(null);
  const [saveError,setSaveError]=useState('');
  const [success,setSuccess]=useState('');
  const [pending,setPending]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const [archiveRecord,setArchiveRecord]=useState<T|null>(null);
  const [archiveError,setArchiveError]=useState('');
  const locked=useRef(false);
  const headingRef=useRef<HTMLHeadingElement>(null);
  const pageHeadingRef=useRef<HTMLHeadingElement>(null);

  useEffect(()=>{
    let active=true;
    setData(null);setListError('');
    load(page).then(result=>{if(active)setData(result)}).catch(error=>{if(active)setListError(errorMessage(error))});
    return()=>{active=false};
  },[load,page,refreshKey]);

  useEffect(()=>{if(editor)headingRef.current?.focus()},[editor]);

  function openEditor(record:T|null) {
    if(pending || uncertain || !canManage) return;
    setEditor({record});setSaveError('');setSuccess('');
  }
  function closeEditor() {
    if(locked.current) return;
    setEditor(null);setSaveError('');pageHeadingRef.current?.focus();
  }
  async function save(input:Input) {
    if(!canManage || !editor || locked.current || uncertain) return;
    locked.current=true;setPending(true);setSaveError('');setSuccess('');
    try {
      const record=editor.record && update ? await update(editor.record.id,input) : await create(input);
      setEditor(null);
      setSuccess(`${record.name} ${editor.record ? 'updated' : 'created'}.`);
      setRefreshKey(key=>key+1);
      pageHeadingRef.current?.focus();
    } catch(error) {
      setSaveError(errorMessage(error));
      if(error instanceof ApiError && error.code==='UNAVAILABLE') {
        setUncertain(true);setRefreshKey(key=>key+1);
      }
    }
    finally {locked.current=false;setPending(false)}
  }
  async function confirmArchive() {
    if(!canManage || !archiveRecord || !archive || locked.current) return;
    locked.current=true;setPending(true);setArchiveError('');setSuccess('');
    try {
      await archive(archiveRecord);
      setSuccess(`${archiveRecord.name} archived. Existing subscription snapshots are unchanged.`);
      setArchiveRecord(null);setRefreshKey(key=>key+1);
    } catch(error) {setArchiveError(errorMessage(error))}
    finally {locked.current=false;setPending(false)}
  }
  return <>
    <div className="page-heading">
      <div><h1 className="page-title" ref={pageHeadingRef} tabIndex={-1}>{title}</h1><p className="page-description">{description}</p></div>
      {canManage && <Button disabled={pending || uncertain || editor!==null} onClick={()=>openEditor(null)}>New {singular}</Button>}
    </div>
    {!canManage && <p className="text-muted">Read-only configuration. An administrator manages these records.</p>}
    {success && <Notice>{success}</Notice>}
    {uncertain && <Notice error>The save result is unknown. This editor is locked to prevent duplicate writes. Check the refreshed record list before reloading this page to start another save.</Notice>}
    {editor && <Panel title={`${editor.record ? 'Edit' : 'New'} ${singular}`}>
      <h3 ref={headingRef} tabIndex={-1} className="text-muted">{editor.record ? editor.record.name : `Enter ${singular} details`}</h3>
      <fieldset disabled={uncertain}><Editor key={editor.record?.id || 'new'} record={editor.record} pending={pending} error={saveError} onSave={save} onCancel={closeEditor}/></fieldset>
    </Panel>}
    <div className="toolbar"><p className="text-muted">{title} · page {page}</p><Button variant="secondary" disabled={pending || (!data && !listError)} onClick={()=>setRefreshKey(key=>key+1)}>Refresh list</Button></div>
    {listError ? <Notice error>{listError} Your form data has not been changed. Use Refresh list to retry.</Notice> : !data ? <Notice>Loading {title.toLowerCase()}…</Notice> : <>
      {data.items.length===0 ? <div className="empty-state"><h2>{page===1 ? `No ${title.toLowerCase()} yet` : 'No records on this page'}</h2><p>{page===1 ? canManage ? `Create a ${singular} to get started.` : 'An administrator can add records here.' : 'Go to the previous page or refresh the list.'}</p></div> :
        <div className="table-wrap" role="region" aria-label={`${title} records`} tabIndex={0}>
          <table><caption className="text-muted">{title} · page {data.page}</caption>
            <thead><tr><th scope="col">Name</th>{columns.map(column=><th key={column.label} scope="col">{column.label}</th>)}{(canManage && (update || archive) || extraActions) && <th scope="col">Actions</th>}</tr></thead>
            <tbody>{data.items.map(record=><tr key={record.id}>
              <th scope="row">{record.name}</th>
              {columns.map(column=><td key={column.label}>{column.render(record)}</td>)}
              {(canManage && (update || archive) || extraActions) && <td><div className="actions">
                {canManage && update && <Button variant="secondary" disabled={pending || editor!==null} aria-label={`Edit ${record.name}`} onClick={()=>openEditor(record)}>Edit</Button>}
                {canManage && archive && (!canArchive || canArchive(record)) && <Button variant="ghost" disabled={pending || editor!==null} aria-label={`Archive ${record.name}`} onClick={()=>{setArchiveRecord(record);setArchiveError('')}}>Archive</Button>}
                {extraActions?.(record)}
              </div></td>}
            </tr>)}</tbody>
          </table>
        </div>}
      <nav className="pagination" aria-label={`${title} pages`}>
        <Button variant="secondary" disabled={page===1 || pending} onClick={()=>setPage(current=>current-1)}>Previous</Button>
        <span>Page {data.page}</span>
        <Button variant="secondary" disabled={!data.has_more || pending} onClick={()=>setPage(current=>current+1)}>Next</Button>
      </nav>
    </>}
    {archive && <ConfirmDialog open={archiveRecord!==null} onOpenChange={(open:boolean)=>{if(!open && !locked.current)setArchiveRecord(null)}} title="Archive product?" description={`Archive ${archiveRecord?.name || 'this product'} so it is unavailable for new subscription lines. Existing subscriptions keep their saved prices and details.`} onConfirm={confirmArchive} pending={pending} confirmLabel="Archive product" error={archiveError}/>}
  </>;
}
