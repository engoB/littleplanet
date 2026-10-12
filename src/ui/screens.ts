/** Menus : principal (scène vivante en fond), comment jouer, pause, fin. */
import type { RecordEntry } from '../settings/store';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type ScreenId = 'menu-main' | 'menu-help' | 'menu-pause' | 'menu-over' | 'menu-planets' | null;

export class Screens {
  current: ScreenId = null;

  show(id: ScreenId): void {
    for (const s of document.querySelectorAll<HTMLElement>('.screen')) s.hidden = s.id !== id;
    this.current = id;
    const first = id ? $(id).querySelector<HTMLButtonElement>('button') : null;
    first?.focus({ preventScroll: true });
  }

  records(list: RecordEntry[], enabled: boolean): void {
    const el = $('records');
    el.hidden = !enabled;
    if (!enabled) return;
    el.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'records-title';
    h.textContent = 'Meilleures distances';
    el.appendChild(h);
    for (let i = 0; i < 3; i++) {
      const r = list[i];
      const row = document.createElement('div');
      row.className = 'record';
      row.textContent = r ? `${i + 1}. ${r.distance.toFixed(2)} m` : `${i + 1}. —`;
      el.appendChild(row);
    }
  }

  gameOver(stats: { distance: number; time: number; stage: number; clocks: number }, rank: number, best: number | null, showStats: boolean): void {
    $('over-distance').textContent = `${stats.distance.toFixed(2)} m`;
    const m = Math.floor(stats.time / 60);
    const s = Math.floor(stats.time % 60);
    $('over-details').textContent = showStats ? `${m}:${String(s).padStart(2, '0')} · étape ${stats.stage} · ${stats.clocks} horloge${stats.clocks > 1 ? 's' : ''}` : '';
    const rec = $('over-record');
    rec.hidden = rank === 0 && best === null;
    rec.textContent = rank === 1 ? 'Nouveau record !' : rank > 1 ? `${rank}ᵉ meilleure distance` : best !== null ? `Record : ${best.toFixed(2)} m` : '';
    rec.classList.toggle('new', rank === 1);
  }
}
