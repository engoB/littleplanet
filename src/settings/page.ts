/**
 * Page Réglages générée depuis le schéma unique (schema.ts).
 * Valeurs dans localStorage, image perso dans IndexedDB.
 */
import { APP_BUILD, APP_VERSION } from '../version';
import '../styles.css';
import type { UnityProject } from '../unity/types';
import { bindSchemaToProject } from './bindings';
import { GROUPS, SCHEMA, type Preset, type SettingDef } from './schema';
import { applyPreset, currentPreset, loadImage, loadSettings, saveImage, saveSetting } from './store';

const form = document.getElementById('settings-form')!;
const status = document.getElementById('preset-status')!;

function fmt(d: SettingDef, v: unknown): string {
  if (d.type === 'bool') return v ? 'oui' : 'non';
  if (d.type === 'select') return d.options?.find((o) => o.value === v)?.label ?? String(v);
  if (d.type === 'image') return v ? 'image' : 'aucune';
  if (d.type === 'number' && Number(v) === 0 && /0 =/.test(d.help ?? '')) return '0';
  return `${v}${d.unit ? ' ' + d.unit : ''}`;
}

async function render(): Promise<void> {
  const s = loadSettings();
  const preset = currentPreset();
  for (const b of document.querySelectorAll<HTMLButtonElement>('.preset-buttons button')) b.classList.toggle('current', b.dataset.preset === preset);
  form.textContent = '';
  for (const g of GROUPS) {
    const fs = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.textContent = g;
    fs.appendChild(lg);
    for (const d of SCHEMA.filter((x) => x.group === g)) {
      const row = document.createElement('div');
      row.className = 'row';
      const id = 'set-' + d.key;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = d.label;
      const ctl = document.createElement('div');
      ctl.className = 'ctl';
      const v = s[d.key];
      const ref = d[preset];
      row.classList.toggle('modified', d.type !== 'image' && v !== ref);
      const save = (val: number | boolean | string | null) => {
        saveSetting(d.key, val);
        row.classList.toggle('modified', val !== ref);
      };
      if (d.type === 'bool') {
        const i = document.createElement('input');
        i.type = 'checkbox';
        i.id = id;
        i.checked = v === true;
        i.onchange = () => save(i.checked);
        ctl.appendChild(i);
      } else if (d.type === 'number') {
        const i = document.createElement('input');
        i.type = 'range';
        i.id = id;
        i.min = String(d.min ?? 0);
        i.max = String(d.max ?? 100);
        i.step = String(d.step ?? 1);
        i.value = String(v);
        const out = document.createElement('output');
        out.textContent = fmt(d, v);
        i.oninput = () => {
          out.textContent = fmt(d, Number(i.value));
          save(Number(i.value));
        };
        ctl.append(i, out);
      } else if (d.type === 'select') {
        const sel = document.createElement('select');
        sel.id = id;
        for (const o of d.options ?? []) {
          const op = document.createElement('option');
          op.value = o.value;
          op.textContent = o.label;
          sel.appendChild(op);
        }
        sel.value = String(v);
        sel.onchange = () => save(sel.value);
        ctl.appendChild(sel);
      } else if (d.type === 'color') {
        const i = document.createElement('input');
        i.type = 'color';
        i.id = id;
        i.value = String(v);
        i.oninput = () => save(i.value);
        ctl.appendChild(i);
      } else if (d.type === 'image') {
        const i = document.createElement('input');
        i.type = 'file';
        i.accept = 'image/*';
        i.id = id;
        const prev = document.createElement('img');
        prev.alt = '';
        const blob = await loadImage(d.key);
        if (blob) prev.src = URL.createObjectURL(blob);
        else prev.hidden = true;
        const rm = document.createElement('button');
        rm.textContent = 'Retirer';
        rm.hidden = !blob;
        i.onchange = async () => {
          const f = i.files?.[0];
          if (!f) return;
          await saveImage(d.key, f);
          prev.src = URL.createObjectURL(f);
          prev.hidden = false;
          rm.hidden = false;
        };
        rm.onclick = async () => {
          await saveImage(d.key, null);
          prev.hidden = true;
          rm.hidden = true;
          i.value = '';
        };
        ctl.append(i, prev, rm);
      }
      row.append(label, ctl);
      const help = document.createElement('div');
      help.className = 'help-text';
      help.textContent = `${d.help ? d.help + ' — ' : ''}Arcade : ${fmt(d, d.arcade)} · Original : ${fmt(d, d.original)}`;
      row.appendChild(help);
      fs.appendChild(row);
    }
    form.appendChild(fs);
  }
}

async function init(): Promise<void> {
  try {
    const p = (await fetch('./data/scene.json').then((r) => r.json())) as UnityProject;
    bindSchemaToProject(p);
    document.getElementById('about')!.textContent = `Ma Petite Planète v${APP_VERSION} (${APP_BUILD}). Valeurs « Original » lues dans le projet Unity ${p.meta.unityVersion} (commit ${p.meta.sourceCommit?.slice(0, 7) ?? '?'}).`;
  } catch {
    /* hors ligne sans cache : valeurs de repli du schéma */
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('.preset-buttons button')) {
    b.onclick = async () => {
      applyPreset(b.dataset.preset as Preset);
      status.textContent = `Préréglage ${b.textContent} appliqué.`;
      await render();
    };
  }
  await render();
}

void init();
