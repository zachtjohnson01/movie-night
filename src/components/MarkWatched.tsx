import { useEffect, useRef, useState } from 'react';
import { todayIso } from '../format';

export function validWatchDate(value: string, today = todayIso()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}

export default function MarkWatched({ onSave, disabledLabel }: {
  onSave: (date: string | null) => void | Promise<void>; disabledLabel?: string;
}) {
  const [open,setOpen] = useState(false);
  const [date,setDate] = useState(todayIso);
  const [unknown,setUnknown] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  useEffect(()=>{ if(open) dialog.current?.showModal(); },[open]);
  function begin() {setDate(todayIso());setUnknown(false);setError(null);setOpen(true);}
  async function save() {
    if(saving.current) return;
    if(!unknown && !validWatchDate(date)) {setError('Choose today or a valid past date.');return;}
    saving.current=true;setBusy(true);setError(null);
    try {await onSave(unknown ? null : date);setOpen(false);}
    catch(e){setError(e instanceof Error ? e.message : 'Could not save. Please try again.');}
    finally {saving.current=false;setBusy(false);}
  }
  return <>
    <button type="button" disabled={!!disabledLabel} onClick={begin} className="w-full min-h-[52px] rounded-2xl bg-crimson-deep text-white font-semibold active:bg-crimson-bright disabled:bg-ink-800 disabled:text-ink-400">{disabledLabel ?? 'Mark watched'}</button>
    {open && <dialog ref={dialog} aria-labelledby="watch-date-heading" onCancel={e=>{e.preventDefault();if(!busy)setOpen(false);}} className="w-[calc(100%_-_2rem)] max-w-sm rounded-2xl border border-ink-700 bg-ink-950 p-5 text-ink-100 backdrop:bg-black/70">
      <h2 id="watch-date-heading" className="text-xl font-bold">When did you watch it?</h2>
      <label className="mt-4 block text-sm">Watched date<input autoFocus type="date" value={date} max={todayIso()} disabled={busy || unknown} onChange={e=>setDate(e.target.value)} className="mt-2 block w-full min-h-[48px] rounded-xl bg-ink-800 px-3 text-base disabled:opacity-50" /></label>
      <label className="mt-3 flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" checked={unknown} disabled={busy} onChange={e=>setUnknown(e.target.checked)} />Date unknown</label>
      {error && <p role="alert" className="mt-2 text-sm text-rose-300">{error}</p>}
      <div className="mt-4 grid grid-cols-2 gap-3"><button type="button" disabled={busy} onClick={()=>setOpen(false)} className="min-h-[48px] rounded-xl bg-ink-800 font-semibold disabled:opacity-50">Cancel</button><button type="button" disabled={busy} onClick={()=>void save()} className="min-h-[48px] rounded-xl bg-amber-glow text-ink-950 font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save watched'}</button></div>
    </dialog>}
  </>;
}
