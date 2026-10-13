/**
 * Blocs écraseurs (Forteresse de Lave) : de temps en temps, un gros bloc de
 * pierre au visage fâché apparaît au-dessus de la trajectoire du véhicule,
 * son ombre grossit au sol, puis il tombe d'un coup. Sous le bloc : dégâts.
 */
import * as THREE from 'three';
import { toonGradient } from './toon';

function face(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b8b4c0';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 6; i++) g.fillRect(4 + (i % 3) * 20, 4 + Math.floor(i / 3) * 40, 16, 16);
  g.fillStyle = '#1a1a1a';
  g.beginPath(); g.moveTo(12, 22); g.lineTo(28, 28); g.lineTo(12, 30); g.fill();
  g.beginPath(); g.moveTo(52, 22); g.lineTo(36, 28); g.lineTo(52, 30); g.fill();
  g.fillRect(16, 42, 32, 8);
  g.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) g.fillRect(18 + i * 8, 42, 4, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type Phase = 'idle' | 'warn' | 'fall' | 'rest' | 'rise';

export class Thwomps {
  readonly group = new THREE.Group();
  private readonly block: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private phase: Phase = 'idle';
  private t = 0;
  private wait = 4;
  private readonly dir = new THREE.Vector3(0, 1, 0);
  private h = 0;
  enabled = false;
  private radius = 5;
  private scale = 1;
  /** Impact au sol : position monde et distance au véhicule (unités monde). */
  onSlam: (at: THREE.Vector3, distToCar: number) => void = () => undefined;

  constructor(parent: THREE.Object3D) {
    this.block = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), new THREE.MeshToonMaterial({ color: 0xffffff, map: face(), gradientMap: toonGradient() }));
    this.block.castShadow = true;
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    this.group.add(this.block, this.shadow);
    this.group.visible = false;
    parent.add(this.group);
  }

  configure(enabled: boolean, radius: number, scale: number): void {
    this.enabled = enabled;
    this.radius = radius;
    this.scale = scale;
    this.phase = 'idle';
    this.wait = 4;
    this.group.visible = false;
  }

  /** carDir/carFwd : direction et avant du véhicule (espace planète). */
  update(dt: number, carDir: THREE.Vector3, carFwd: THREE.Vector3, R: number): void {
    if (!this.enabled) return;
    this.radius = R;
    this.t += dt;
    switch (this.phase) {
      case 'idle':
        this.wait -= dt;
        if (this.wait <= 0) {
          // Cible : un peu devant le véhicule, légèrement décalée
          const side = new THREE.Vector3().crossVectors(carDir, carFwd).normalize();
          const ahead = (1.4 + Math.random() * 1.2) / R;
          this.dir.copy(carDir).addScaledVector(carFwd, ahead).addScaledVector(side, ((Math.random() - 0.5) * 1.2) / R).normalize();
          this.phase = 'warn';
          this.t = 0;
          this.h = 3.2;
          this.group.visible = true;
        }
        break;
      case 'warn':
        if (this.t > 1.1) {
          this.phase = 'fall';
          this.t = 0;
        }
        break;
      case 'fall': {
        this.h = Math.max(0, 3.2 - 0.5 * 30 * this.t * this.t);
        if (this.h <= 0) {
          this.phase = 'rest';
          this.t = 0;
          const at = this.dir.clone().multiplyScalar(R);
          this.onSlam(at, this.dir.angleTo(carDir) * R);
        }
        break;
      }
      case 'rest':
        if (this.t > 1.4) {
          this.phase = 'rise';
          this.t = 0;
        }
        break;
      case 'rise':
        this.h = this.t * 3;
        if (this.t > 0.9) {
          this.phase = 'idle';
          this.wait = 3 + Math.random() * 3;
          this.group.visible = false;
        }
        break;
    }
    this.place();
  }

  private place(): void {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.dir);
    const s = 1 / this.scale;
    const shake = this.phase === 'warn' ? Math.sin(this.t * 60) * 0.03 : 0;
    this.block.position.copy(this.dir).multiplyScalar((this.radius + 0.31 + this.h) / this.scale);
    this.block.position.x += shake * s;
    this.block.quaternion.copy(q);
    this.block.scale.setScalar(s);
    this.shadow.position.copy(this.dir).multiplyScalar((this.radius + 0.01) / this.scale);
    this.shadow.quaternion.copy(q);
    const k = this.phase === 'warn' ? 0.4 + 0.6 * Math.min(1, this.t / 1.1) : this.phase === 'fall' ? 1 : this.phase === 'rest' ? 0.6 : 0.3;
    this.shadow.scale.setScalar(s * k);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = this.phase === 'warn' || this.phase === 'fall' ? 0.25 + 0.3 * k : 0.2;
  }
}
