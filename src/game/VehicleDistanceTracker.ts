/** Port de VehiculeDistanceTracker.cs : somme des distances parcourues. */
import * as THREE from 'three';

export class VehicleDistanceTracker {
  private lastPosition = new THREE.Vector3();
  totalDistance = 0;
  constructor(readonly transform: THREE.Object3D) {}

  start(): void {
    this.lastPosition.copy(this.transform.position);
    this.totalDistance = 0;
  }

  update(): void {
    this.totalDistance += this.transform.position.distanceTo(this.lastPosition);
    this.lastPosition.copy(this.transform.position);
  }

  /** Texte original : « Distance: 12.34 m ». */
  get text(): string {
    return `Distance: ${this.totalDistance.toFixed(2)} m`;
  }
}
