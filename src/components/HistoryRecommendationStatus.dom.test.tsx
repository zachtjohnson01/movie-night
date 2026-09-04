// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import HistoryRecommendationStatus from './HistoryRecommendationStatus';
import { useHistoryRecommendations } from '../useHistoryRecommendations';
import { DEFAULT_WEIGHTS } from '../scoring';
import { emptyMovie } from '../format';
afterEach(cleanup);
const movies=Array.from({length:10},(_,i)=>({...emptyMovie(true),watched:true,title:`Movie ${i}`,imdbId:`id${i}`,directors:['Director']}));
function Harness({owner,family}:{owner:boolean;family:string}){const result=useHistoryRecommendations([],movies,DEFAULT_WEIGHTS,owner,family);return <HistoryRecommendationStatus result={result} isOwner={owner}/>;}
it('automatically uses history with no method control for ordinary users',()=>{render(<Harness owner={false} family="a"/>);expect(screen.getByText('Based on your family’s movie preferences')).toBeInTheDocument();expect(screen.queryByRole('combobox')).toBeNull();});
it('owner preview does not carry into a different family',()=>{const view=render(<Harness owner family="a"/>);fireEvent.change(screen.getByLabelText('Preview method'),{target:{value:'preset'}});expect(screen.getByText('Using the shared recommendation preset')).toBeInTheDocument();view.rerender(<Harness owner family="b"/>);expect(screen.getByText('Based on your family’s movie preferences')).toBeInTheDocument();});

it('previews custom weights and saves exact owner settings',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);
 function Editor(){const result=useHistoryRecommendations([],movies,DEFAULT_WEIGHTS,true,'a');return <HistoryRecommendationStatus result={result} isOwner onSave={save}/>;}
 render(<Editor/>);
 fireEvent.change(screen.getByLabelText('Up Next weight'),{target:{value:'0.75'}});
 fireEvent.change(screen.getByLabelText('Existing preset contribution'),{target:{value:'0'}});
 expect(save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Save weights'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith({favorite:1.25,watched:1,queue:0.75,presetPercent:0}));
 expect(await screen.findByText('Saved for all families.')).toBeInTheDocument();
});
it('does not report saved when persistence fails',async()=>{
 const save=vi.fn().mockRejectedValue(new Error('Save failed'));
 function Editor(){const result=useHistoryRecommendations([],movies,DEFAULT_WEIGHTS,true,'a');return <HistoryRecommendationStatus result={result} isOwner onSave={save}/>;}
 render(<Editor/>);fireEvent.click(screen.getByRole('button',{name:'Save weights'}));
 expect(await screen.findByText('Save failed')).toBeInTheDocument();
 expect(screen.queryByText('Saved for all families.')).toBeNull();
});
