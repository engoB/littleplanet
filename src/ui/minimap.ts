/**
 * Mini-carte façon GTA : vue centrée sur la voiture, orientée selon sa
 * direction. La sphère est dépliée en projection azimutale équidistante
 * (distance angulaire depuis la voiture). Les cibles hors de portée
 * apparaissent comme des flèches au bord.
 */
import * as THREE from 'three';

const _up = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _d = new THREE.Vector3();

export interface MapItem {
  /** Direction depuis le centre de la planète (monde). */
  pos: THREE.Vector3;
  kind: 'clock' | 'meteor' | 'crater' | 'star';
}

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private size = 120;
  private dpr = 1;
  /** Angle (rad) couvert du centre au bord. */
  range = 1.05;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Taille mise en cache (pas de mesure DOM à chaque frame). */
  resize(cssSize: number, dpr: number): void {
    this.size = cssSize;
    this.dpr = Math.min(2, dpr);
    this.canvas.width = Math.round(cssSize * this.dpr);
    this.canvas.height = Math.round(cssSize * this.dpr);
    this.canvas.style.width = this.canvas.style.height = `${cssSize}px`;
  }

  draw(car: THREE.Object3D, center: THREE.Vector3, items: MapItem[], time: number): void {
    const c = this.ctx;
    const S = this.size * this.dpr;
    const R = S / 2 - 3 * this.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.save();
    c.translate(S / 2, S / 2);
    // fond : sol de la planète
    const g = c.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
    g.addColorStop(0, 'rgba(120, 190, 70, 0.85)');
    g.addColorStop(1, 'rgba(40, 90, 50, 0.85)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, R, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.8)';
    c.lineWidth = 2 * this.dpr;
    c.stroke();
    // repère de la voiture
    _up.copy(car.position).sub(center).normalize();
    _f.set(0, 0, 1).applyQuaternion(car.quaternion);
    _r.set(1, 0, 0).applyQuaternion(car.quaternion);
    // Dans three (main droite), le +X local de la voiture est à sa gauche
    const order: MapItem['kind'][] = ['crater', 'meteor', 'clock', 'star'];
    for (const kind of order) {
      for (const it of items) {
        if (it.kind !== kind) continue;
        _d.copy(it.pos).normalize();
        const ang = Math.acos(Math.max(-1, Math.min(1, _d.dot(_up))));
        const az = Math.atan2(-_d.dot(_r), _d.dot(_f));
        const far = ang > this.range;
        if (far && kind !== 'clock' && kind !== 'star') continue;
        const rr = (Math.min(ang, this.range) / this.range) * (R - (far ? 9 * this.dpr : 4 * this.dpr));
        const x = Math.sin(az) * rr;
        const y = -Math.cos(az) * rr;
        if (kind === 'crater') {
          c.fillStyle = 'rgba(40, 25, 15, 0.8)';
          c.beginPath();
          c.arc(x, y, 2.5 * this.dpr, 0, Math.PI * 2);
          c.fill();
        } else if (kind === 'meteor') {
          const p = 0.5 + 0.5 * Math.sin(time * 10);
          c.strokeStyle = `rgba(255, 70, 30, ${0.6 + 0.4 * p})`;
          c.lineWidth = 2 * this.dpr;
          c.beginPath();
          c.arc(x, y, (3 + 2 * p) * this.dpr, 0, Math.PI * 2);
          c.stroke();
        } else if (kind === 'star') {
          // Étoile de lancement : étoile dorée (au bord si lointaine), pulsante
          const p = 1 + 0.25 * Math.sin(time * 8);
          c.save();
          c.translate(x, y);
          c.scale(p * this.dpr, p * this.dpr);
          c.fillStyle = '#ffd23a';
          c.strokeStyle = '#7a4a00';
          c.lineWidth = 1.2;
          c.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 ? 3.2 : 7.5;
            if (i === 0) c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
            else c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          c.closePath();
          c.fill();
          c.stroke();
          c.restore();
        } else if (far) {
          // flèche au bord vers la cible lointaine
          c.save();
          c.translate(x, y);
          c.rotate(az);
          c.fillStyle = '#ffd34d';
          c.beginPath();
          c.moveTo(0, -7 * this.dpr);
          c.lineTo(5 * this.dpr, 3 * this.dpr);
          c.lineTo(-5 * this.dpr, 3 * this.dpr);
          c.closePath();
          c.fill();
          c.restore();
        } else {
          c.fillStyle = '#ffd34d';
          c.strokeStyle = '#5a3a10';
          c.lineWidth = 1.5 * this.dpr;
          c.beginPath();
          c.arc(x, y, 4.5 * this.dpr, 0, Math.PI * 2);
          c.fill();
          c.stroke();
        }
      }
    }
    // voiture (flèche au centre, toujours vers le haut)
    c.fillStyle = '#ff3030';
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5 * this.dpr;
    c.beginPath();
    c.moveTo(0, -8 * this.dpr);
    c.lineTo(6 * this.dpr, 7 * this.dpr);
    c.lineTo(0, 4 * this.dpr);
    c.lineTo(-6 * this.dpr, 7 * this.dpr);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }
}
