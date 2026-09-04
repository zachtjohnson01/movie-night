// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MarkWatched, { validWatchDate } from './MarkWatched';
import Detail from './Detail';
import ModernDetail from './modern/Detail';
import { emptyMovie, todayIso } from '../format';
beforeEach(()=>{vi.stubGlobal('__BUILD_COMMIT__','test');HTMLDialogElement.prototype.showModal=vi.fn(function(this:HTMLDialogElement){this.setAttribute('open','');});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('defaults to local today, does not save before confirmation, and cancels without changes',()=>{
 const save=vi.fn();render(<MarkWatched onSave={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'Mark watched'}));
 expect(screen.getByLabelText('Watched date')).toHaveValue(todayIso());
 expect(save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
 expect(save).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps failure visible and retries selected unknown date only on save',async()=>{
 const save=vi.fn().mockRejectedValueOnce(new Error('Connection failed')).mockResolvedValueOnce(undefined);
 render(<MarkWatched onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Mark watched'}));
 fireEvent.click(screen.getByLabelText('Date unknown'));fireEvent.click(screen.getByRole('button',{name:'Save watched'}));
 await screen.findByRole('alert');expect(save).toHaveBeenCalledWith(null);expect(screen.getByRole('dialog')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Save watched'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it.each([{Component:Detail,name:'classic'},{Component:ModernDetail,name:'modern'}])('persists chosen date from $name existing detail',async({Component})=>{
 const update=vi.fn().mockResolvedValue(undefined);
 render(<Component mode="existing" movie={{...emptyMovie(false),title:'Example'}} familySlug="test" canWrite onBack={()=>{}} onUpdate={update} onDelete={()=>{}} />);
 fireEvent.click(screen.getByRole('button',{name:'Mark watched'}));
 fireEvent.change(screen.getByLabelText('Watched date'),{target:{value:'2024-03-10'}});
 expect(update).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Save watched'}));
 await waitFor(()=>expect(update).toHaveBeenCalledWith(expect.objectContaining({watched:true,dateWatched:'2024-03-10'})));
});
it.each([{Component:Detail,name:'classic'},{Component:ModernDetail,name:'modern'}])('forwards exact selected date from $name candidate detail',async({Component})=>{
 const save=vi.fn().mockResolvedValue(undefined);const movie={...emptyMovie(false),title:'Candidate'};
 render(<Component mode="candidate" movie={movie} familySlug="test" canWrite onBack={()=>{}} onAddToWishlist={()=>{}} onMarkWatchedTonight={save} onMarkWatchedUndated={()=>{}} />);
 fireEvent.click(screen.getByRole('button',{name:'Mark watched'}));fireEvent.change(screen.getByLabelText('Watched date'),{target:{value:'2024-11-03'}});fireEvent.click(screen.getByRole('button',{name:'Save watched'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith(movie,'2024-11-03'));
});
it('validates calendar dates and future dates without changing day across DST boundaries',()=>{
 expect(validWatchDate('2024-02-30','2026-09-04')).toBe(false);
 expect(validWatchDate('2026-09-05','2026-09-04')).toBe(false);
 expect(validWatchDate('2024-03-10','2026-09-04')).toBe(true);
 expect(validWatchDate('2024-11-03','2026-09-04')).toBe(true);
});

it('rejects future dates and prevents duplicate saves while awaiting persistence',async()=>{
 let finish!:()=>void;const save=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 render(<MarkWatched onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Mark watched'}));
 fireEvent.change(screen.getByLabelText('Watched date'),{target:{value:'2999-01-01'}});fireEvent.click(screen.getByRole('button',{name:'Save watched'}));
 expect(save).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('valid past date');
 fireEvent.change(screen.getByLabelText('Watched date'),{target:{value:'2024-01-01'}});fireEvent.click(screen.getByRole('button',{name:'Save watched'}));
 expect(screen.getByRole('button',{name:'Saving…'})).toBeDisabled();expect(screen.getByRole('button',{name:'Cancel'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Saving…'}));expect(save).toHaveBeenCalledTimes(1);
 finish();await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
