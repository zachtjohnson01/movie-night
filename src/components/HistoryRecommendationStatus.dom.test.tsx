// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import HistoryRecommendationStatus from './HistoryRecommendationStatus';
import { useHistoryRecommendations } from '../useHistoryRecommendations';
import { DEFAULT_WEIGHTS } from '../scoring';
import { emptyMovie } from '../format';
afterEach(cleanup);
const movies=Array.from({length:10},(_,i)=>({...emptyMovie(true),watched:true,title:`Movie ${i}`,imdbId:`id${i}`,directors:['Director']}));
function Harness({owner,family}:{owner:boolean;family:string}){const result=useHistoryRecommendations([],movies,DEFAULT_WEIGHTS,owner,family);return <HistoryRecommendationStatus result={result} isOwner={owner}/>;}
it('automatically uses history with no method control for ordinary users',()=>{render(<Harness owner={false} family="a"/>);expect(screen.getByText('Based on your family’s watch history')).toBeInTheDocument();expect(screen.queryByRole('combobox')).toBeNull();});
it('owner preview does not carry into a different family',()=>{const view=render(<Harness owner family="a"/>);fireEvent.change(screen.getByLabelText('Preview method'),{target:{value:'preset'}});expect(screen.getByText('Using the shared recommendation preset')).toBeInTheDocument();view.rerender(<Harness owner family="b"/>);expect(screen.getByText('Based on your family’s watch history')).toBeInTheDocument();});
