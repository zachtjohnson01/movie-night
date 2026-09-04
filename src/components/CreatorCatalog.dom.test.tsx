// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import CreatorCatalog from './CreatorCatalog';
import CreatorPills from './CreatorPills';
import { useCreatorCatalog } from '../creatorCatalog';
import { candidateToTemplate } from '../format';
import type { Candidate } from '../types';
vi.mock('./Detail',()=>({default:({movie}:{movie:{title:string}})=><h2>{movie.title} detail preview</h2>}));
const film:Candidate={title:'Other film',year:2026,imdbId:'other',imdb:null,rottenTomatoes:null,poster:null,commonSenseAge:null,studio:null,awards:null,addedAt:'2026-01-01',directors:['Jane Doe']};
function Origin(){const browse=useCreatorCatalog(); const [notes,setNotes]=useState('');return <><input aria-label="Unsaved notes" value={notes} onChange={e=>setNotes(e.target.value)} /><CreatorPills readOnly names={['Jane Doe']} onSelect={name=>browse?.({role:'director',name,origin:{...candidateToTemplate(film),title:'Origin',imdbId:'origin'}})} /></>;}
beforeEach(()=>{HTMLDialogElement.prototype.showModal=vi.fn(function(this:HTMLDialogElement){this.setAttribute('open','');});HTMLDialogElement.prototype.close=vi.fn(function(this:HTMLDialogElement){this.removeAttribute('open');});});
afterEach(cleanup);
it('opens full-catalog results and movie preview then returns without discarding original input',()=>{
 render(<CreatorCatalog pool={[film]} library={[]} familySlug="test"><Origin /></CreatorCatalog>);
 fireEvent.change(screen.getByLabelText('Unsaved notes'),{target:{value:'Still writing'}});
 fireEvent.click(screen.getByRole('button',{name:'Browse films by Jane Doe'}));
 expect(screen.getByRole('dialog')).toBeInTheDocument();
 expect(document.body.style.position).toBe('fixed');
 expect(document.documentElement.style.overflow).toBe('hidden');
 expect(screen.getByRole('button',{name:/Other film/})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Other film/}));
 expect(screen.getByText('Other film detail preview')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Back to results'}));
 expect(screen.getByRole('button',{name:/Other film/})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Close catalog'}));
 expect(document.body.style.position).toBe('');
 expect(document.documentElement.style.overflow).toBe('');
 expect(screen.getByLabelText('Unsaved notes')).toHaveValue('Still writing');
});
it('shows a clear empty catalog state',()=>{
 render(<CreatorCatalog pool={[]} library={[]} familySlug="test"><Origin /></CreatorCatalog>);
 fireEvent.click(screen.getByRole('button',{name:'Browse films by Jane Doe'}));
 expect(screen.getByText('No other matching films are in the catalog yet.')).toBeInTheDocument();
});
