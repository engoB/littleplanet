/** Port de RotatePlanet.cs (menu) et ShrinkPlanet.cs (option). */
import * as THREE from 'three';
import { Random, unityEuler } from '../unity/math';

export class RotatePlanet {
  private dir = new THREE.Vector3();
  constructor(readonly transform: THREE.Object3D, public rotationSpeed: number) {}

  start(): void {
    this.dir.set(Random.range(-1, 1), Random.range(-1, 1), Random.range(-1, 1)).normalize();
  }

  /** transform.Rotate(eulers) : rotation d'Euler Unity relative (espace local). */
  update(dt: number): void {
    const e = this.dir.clone().multiplyScalar(this.rotationSpeed * dt);
    this.transform.quaternion.multiply(unityEuler(e.x, e.y, e.z));
  }
}

export class ShrinkPlanet {
  private next = 0;
  constructor(readonly transform: THREE.Object3D, public shrinkRate = 0.99, public interval = 1, public minScale = 0.45) {}
  start(time: number): void {
    this.next = time + this.interval;
  }
  update(time: number): void {
    while (time >= this.next) {
      if (this.transform.scale.x > this.minScale) this.transform.scale.multiplyScalar(this.shrinkRate);
      this.next += this.interval;
    }
  }
}

