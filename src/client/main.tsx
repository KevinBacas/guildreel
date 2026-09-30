import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownUp, Check, ChevronDown, Clapperboard, Clock3, ExternalLink, Eye, Film, Heart, MessageCircle, Play, Search, Sparkles, Video, X } from 'lucide-react';
import type { Clip, ReviewSort, ReviewState } from '../types.js';
import { orderClips } from '../order.js';
import './style.css';

type Payload = { year: number; clips: Clip[]; review: ReviewState; maxClipsPerUploader: number };
type SortKey = ReviewSort;
const prettyDuration = (seconds?: number) => { if (seconds == null) return '—'; const s = Math.round(seconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const pretty = (n?: number) => n == null ? '—' : Intl.NumberFormat().format(n);

function App() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [state, setState] = useState<ReviewState | null>(null);
  const [sort, setSort] = useState<SortKey>('score');
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderMessage, setRenderMessage] = useState('');

  useEffect(() => { fetch('/api/clips').then((r) => r.json()).then((data: Payload) => {
    setPayload(data);
    const sortMode = data.review.sortMode || 'score';
    const ranked = [...data.clips].sort((a, b) => b.score - a.score);
    const rankedIds = ranked.map((clip) => clip.id);
    const ids = data.clips.map((clip) => clip.id);
    const baseOrder = data.review.initialized ? data.review.order : rankedIds;
    const state = { ...data.review, sortMode, order: [...baseOrder.filter((id) => ids.includes(id)), ...ids.filter((id) => !baseOrder.includes(id))] };
    setSort(sortMode);
    if (!state.initialized && ids.length) {
      const perUploader = new Map<string, number>();
      const max = data.maxClipsPerUploader;
      state.selected = ranked.filter((clip) => {
        if (clip.downloadStatus !== 'downloaded') return false;
        const uploader = clip.uploader || clip.occurrences[0]?.author || 'Unknown';
        const count = perUploader.get(uploader) || 0;
        if (max > 0 && count >= max) return false;
        perUploader.set(uploader, count + 1); return true;
      }).map((clip) => clip.id);
      state.initialized = true;
    }
    setState(state);
  }).catch(() => setError('Could not load local clip data. Run the scan and launch the review command again.')); }, []);

  useEffect(() => {
    if (!state) return;
    setSaving(true);
    const timer = setTimeout(() => fetch('/api/review', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) }).then((r) => { if (!r.ok) throw new Error('Save failed'); }).catch(() => setError('Your changes could not be saved.')).finally(() => setSaving(false)), 350);
    return () => clearTimeout(timer);
  }, [state]);

  const clips = payload?.clips ?? [];
  const ordered = useMemo(() => {
    if (!state) return [];
    const list = state.order.map((id) => clips.find((clip) => clip.id === id)).filter((clip): clip is Clip => Boolean(clip));
    return orderClips(list, sort, state.scoreOverrides, state.order);
  }, [state, clips, sort]);
  const filtered = ordered.filter((clip) => !query || [clip.uploader, ...clip.occurrences.map((o) => o.author), clip.title].some((value) => value?.toLowerCase().includes(query.toLowerCase())));
  const selected = new Set(state?.selected ?? []);
  const selectedClips = ordered.filter((clip) => selected.has(clip.id));
  const readyClips = ordered.filter((clip) => clip.downloadStatus === 'downloaded');
  const readySelectedCount = selectedClips.filter((clip) => clip.downloadStatus === 'downloaded').length;
  const allReadySelected = readyClips.length > 0 && readyClips.every((clip) => selected.has(clip.id));
  const playingClip = clips.find((clip) => clip.id === playing);
  const estimated = selectedClips.reduce((sum, clip) => sum + (clip.duration ?? 0), 0);
  const uploaderCount = new Set(selectedClips.map((clip) => clip.uploader || clip.occurrences[0]?.author).filter(Boolean)).size;
  const formattedEstimated = `${Math.floor(estimated / 60)}m ${String(Math.round(estimated % 60)).padStart(2, '0')}s`;

  useEffect(() => {
    if (!playing) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setPlaying(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow; };
  }, [playing]);

  function toggle(id: string) { setState((s) => s && ({ ...s, selected: selected.has(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id] })); }
  function setAll(enabled: boolean) { if (!state) return; setState({ ...state, selected: enabled ? ordered.filter((clip) => clip.downloadStatus === 'downloaded').map((clip) => clip.id) : [] }); }
  function changeSort(mode: SortKey) {
    if (!state) return;
    setSort(mode);
    setState({ ...state, sortMode: mode, ...(mode === 'manual' ? { order: ordered.map((clip) => clip.id) } : {}) });
  }
  function move(dragId: string, targetId: string) {
    if (!state || sort !== 'manual' || dragId === targetId) return;
    const next = [...state.order]; const from = next.indexOf(dragId); const to = next.indexOf(targetId); next.splice(from, 1); next.splice(to, 0, dragId); setState({ ...state, order: next });
  }
  function editScore(id: string, value: string) { if (!state) return; const score = Number(value); if (Number.isFinite(score)) setState({ ...state, scoreOverrides: { ...state.scoreOverrides, [id]: score } }); }
  async function startRender() {
    setRenderMessage('Starting render…');
    try {
      const response = await fetch('/api/render', { method: 'POST' });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not start render.');
      setRendering(true);
      const poll = async () => {
        const status = await (await fetch('/api/render')).json();
        setRenderMessage(status.running ? (status.output.split('\n').filter(Boolean).slice(-1)[0] || 'Rendering your montage…') : status.exitCode === 0 ? 'Done — output/best-of-' + payload?.year + '.mp4' : 'Render failed. Check the terminal output.');
        if (status.running) setTimeout(poll, 2000); else setRendering(false);
      };
      poll();
    } catch (e) { setRenderMessage((e as Error).message); setRendering(false); }
  }

  if (!payload || !state) return <main className="loading"><div className="loading-mark"><Clapperboard /></div><span>Loading your clips</span>{error && <p>{error}</p>}</main>;
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-icon"><Clapperboard size={19}/></span><span>AFTERPLAY</span><span className="brand-studio">STUDIO</span></a>
      <div className="topbar-right"><span className="project-pill"><span className="live-dot"/>PROJECT {payload.year}</span><span className="save-state"><span className="save-dot"/>{error || (saving ? 'Saving changes' : 'All changes saved')}</span></div>
    </header>
    <main className="main-content">
      <section className="hero">
        <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/>YOUR YEAR, YOUR CUT</div><h1>Make the <em>moments</em><br/>last.</h1><p className="hero-subtitle">Your {payload.year} clips, all in one place. Find the favorites, shape the order, and make a reel worth replaying.</p><a className="hero-link" href="#clips">Explore the clips <span>↗</span></a></div>
        <div className="hero-panel" aria-hidden="true"><div className="hero-panel-top"><span>AFTERPLAY / {payload.year}</span><span>01 — REVIEW</span></div><div className="hero-play"><Play size={32} fill="currentColor"/></div><div className="hero-panel-bottom"><span>THE HIGHLIGHT REEL</span><b>{String(payload.year).slice(-2)}<span>.</span></b></div><div className="hero-panel-glow"/></div>
      </section>
      <section className="stats-row" aria-label="Project summary">
        <div className="stat-card"><span className="stat-icon"><Film size={18}/></span><div><div className="stat-label">IN THE ARCHIVE</div><div className="stat-value">{clips.length}<span>clips discovered</span></div></div></div>
        <div className="stat-card selected-stat"><span className="stat-icon"><Check size={18}/></span><div><div className="stat-label">IN YOUR CUT</div><div className="stat-value">{selected.size}<span>selected moments</span></div></div></div>
        <div className="stat-card"><span className="stat-icon"><Clock3 size={18}/></span><div><div className="stat-label">ESTIMATED RUNTIME</div><div className="stat-value runtime-value">{formattedEstimated}</div></div></div>
        <div className="stat-card"><span className="stat-icon"><Sparkles size={18}/></span><div><div className="stat-label">READY TO PLAY</div><div className="stat-value">{readyClips.length}<span>downloaded clips</span></div></div></div>
      </section>
      <section className="section-heading" id="clips"><div><div className="eyebrow"><span className="eyebrow-line"/>THE REVIEW ROOM</div><h2>Find your next favorite.</h2><p>Pick the clips that belong in the final edit. Your changes save as you go.</p></div><div className="heading-note">{uploaderCount} PLAYERS IN YOUR CUT</div></section>
      <section className="toolbar"><div className="toolbar-left"><label className="search-box"><Search size={17}/><input aria-label="Search clips" placeholder="Search clips or players" value={query} onChange={(e) => setQuery(e.target.value)}/>{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={15}/></button>}</label><span className="result-count">{filtered.length} of {clips.length} clips</span></div><div className="toolbar-right"><label className="sort-select"><ArrowDownUp size={16}/><select aria-label="Sort clips" value={sort} onChange={(e) => changeSort(e.target.value as SortKey)}><option value="manual">Custom order</option><option value="score">Highest score</option><option value="views">Most views</option><option value="likes">Most likes</option><option value="reactions">Most reactions</option><option value="chrono">Oldest first</option><option value="random">Random order</option></select><ChevronDown size={15}/></label><button className="text-button" onClick={() => setAll(!allReadySelected)}>{allReadySelected ? 'Deselect all' : 'Select ready clips'}</button></div></section>
      <div className="order-explainer"><span className="order-indicator"/><strong>Final video order</strong><span>{sort === 'manual' ? 'Drag clips to reorder them.' : sort === 'score' ? 'Highest combined score first.' : sort === 'views' ? 'Most viewed first.' : sort === 'likes' ? 'Most liked first.' : sort === 'reactions' ? 'Most Discord reactions first.' : sort === 'chrono' ? 'Oldest clip first.' : 'Randomized clip order.'}</span></div>
      <div className="grid-labels"><span>CLIP</span><span>CREATORS</span><span>ENGAGEMENT</span><span>SCORE</span></div>
      <section className="clip-list">{filtered.map((clip, index) => {
        const isSelected = selected.has(clip.id); const poster = clip.occurrences[0]?.author || 'Unknown'; const number = String(index + 1).padStart(2, '0');
        return <article key={clip.id} className={`clip-card ${isSelected ? 'is-selected' : ''} ${dragging === clip.id ? 'is-dragging' : ''}`} draggable={sort === 'manual'} onDragStart={() => setDragging(clip.id)} onDragEnd={() => setDragging(null)} onDragOver={(e) => { if (sort === 'manual') e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (dragging) move(dragging, clip.id); }}>
          <div className="clip-main"><button className={`select-toggle ${isSelected ? 'checked' : ''}`} onClick={() => toggle(clip.id)} aria-label={isSelected ? 'Remove from montage' : 'Add to montage'}>{isSelected && <Check size={13}/>}</button><span className="clip-index">{number}</span><button className="thumb" onClick={() => clip.downloadStatus === 'downloaded' && setPlaying(clip.id)} style={clip.thumbnail ? { backgroundImage: `linear-gradient(0deg,rgba(0,0,0,.25),rgba(0,0,0,.06)),url("${clip.thumbnail}")` } : undefined} aria-label="Play clip">{clip.downloadStatus === 'downloaded' ? <Play size={17} fill="white"/> : <span className="thumb-missing"><Video size={17}/></span>}<span className="duration">{prettyDuration(clip.duration)}</span></button><div className="clip-title"><strong>{clip.title || `Medal clip ${clip.id}`}</strong><span>{clip.downloadStatus === 'failed' ? 'DOWNLOAD FAILED' : clip.downloadStatus === 'downloaded' ? 'READY TO PLAY' : 'DOWNLOAD PENDING'}</span></div></div>
          <div className="clip-people"><div className="person medal-person"><span className="mini-avatar medal-avatar">{(clip.uploader || '?').slice(0,1).toUpperCase()}</span><div><small>MEDAL PLAYER</small><b>{clip.uploader || 'Unknown'}</b></div></div><div className="person discord-person"><span className="mini-avatar discord-avatar">{poster.slice(0,1).toUpperCase()}</span><div><small>POSTED BY</small><b>{poster}</b></div></div><div className="links"><a href={clip.url} target="_blank" rel="noreferrer" title="Open Medal clip"><ExternalLink size={13}/></a><a href={clip.occurrences[0]?.messageUrl} target="_blank" rel="noreferrer" title="Open Discord message"><MessageCircle size={13}/></a></div></div>
          <div className="clip-community"><div className="metric"><Eye size={14}/><span>{pretty(clip.viewCount)}</span></div><div className="metric"><Heart size={14}/><span>{pretty(clip.likeCount)}</span></div><div className="metric reactions"><MessageCircle size={14}/><span>{pretty(clip.discordReactions)}</span></div></div>
          <div className="clip-rank"><label><input aria-label="Score" type="number" step="0.1" value={Math.round((state.scoreOverrides[clip.id] ?? clip.score) * 10) / 10} onChange={(e) => editScore(clip.id, e.target.value)}/><span>PTS</span></label><span className="ranking">{clip.metadataStatus === 'failed' ? 'METADATA FAILED' : 'COMBINED SCORE'}</span></div>
        </article>;
      })}{filtered.length === 0 && <div className="empty-state"><Search size={21}/><b>No clips match that search.</b><span>Try another player name or clear the filter.</span></div>}</section>
      <footer className="page-footer"><span><span className="save-dot"/> Saved on this device</span><span>AFTERPLAY STUDIO · {payload.year}</span></footer>
    </main>
    <div className="bottom-bar"><div className="bottom-summary"><span className="bottom-count">{selected.size}</span><span className="bottom-label">clips selected</span><span className="bottom-divider"/><span className="bottom-runtime">{formattedEstimated}</span><span className="bottom-label">estimated</span></div><div className="bottom-actions"><span className="keyboard-hint" role="status">{renderMessage || (readySelectedCount < selected.size ? `${readySelectedCount} ready to render · ${selected.size - readySelectedCount} pending` : 'Ready when you are')}</span><button className="render-button" disabled={rendering || readySelectedCount === 0} onClick={startRender}>{rendering ? 'Rendering…' : 'Render best of'} <span>↗</span></button></div></div>
    {playingClip && <div className="player-backdrop" onClick={() => setPlaying(null)}><div className="player-modal" role="dialog" aria-modal="true" aria-label={playingClip.title || 'Clip preview'} onClick={(e) => e.stopPropagation()}><div className="player-modal-top"><span><span className="live-dot"/> NOW PLAYING <b>/ {payload.year} ARCHIVE</b></span><button className="close-player" aria-label="Close preview" onClick={() => setPlaying(null)}><X size={19}/></button></div><div className="player-stage"><video key={playing} controls autoPlay playsInline src={`/media/${playing}`}/></div><div className="player-info"><div><span className="player-kicker">CLIP PREVIEW</span><h3>{playingClip.title || 'Medal clip'}</h3><p>By {playingClip.uploader || 'Unknown'} <span>·</span> {prettyDuration(playingClip.duration)}</p></div><div className="player-actions"><button className={`modal-select ${selected.has(playingClip.id) ? 'active' : ''}`} onClick={() => toggle(playingClip.id)}>{selected.has(playingClip.id) ? <><Check size={16}/> In your cut</> : 'Add to your cut'}</button><a href={playingClip.url} target="_blank" rel="noreferrer">View on Medal <ExternalLink size={15}/></a></div></div></div></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
