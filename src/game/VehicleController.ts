/**
 * Port de PlayerController.cs (classe VehicleController).
 * La voiture avance seule ; l'axe horizontal la fait tourner, avec lissage
 * SmoothDamp et « fatigue » : si la même direction est gardée plus de
 * maxDirectionDuration secondes, le braquage s'éteint progressivement.
 * Après chaque déplacement, elle est replacée sur la sphère et réorientée.
 */
import * as THREE from 'three';
import { Deg2Rad, Mathf } from '../unity/math';

export interface VehicleControllerFields {
  speed: number;
  rotationSpeed: number;
  rotationMultiplier: number;
  desiredDistanceFromSurface: number;
  rotationSmoothing: number;
  maxDirectionDuration: number;
}

const _up = new THREE.Vector3();
const _gUp = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class VehicleController {
  private currentRotation = 0;
  private rotationVelocity = 0;
  private directionDuration = 0;
  private lastDirection = 0;
  /** Multiplicateur de vitesse (turbo, préréglage Arcade). */
  speedMultiplier = 1;
  /** Vitesse de braquage effective (°/s) : rotationSpeed × rotationMultiplier. */
  steerSpeed: number;
  /** 0 = pas de fatigue de virage. */
  fatigue: number;
  /** Durée de braquage à pleine force avant que la fatigue commence (0 = original). */
  fatigueHold = 0;
  speed: number;
  distanceMoved = 0;
  /** Adhérence (1 = trajectoire exacte de l'original ; < 1 = glisse). */
  grip = 1;
  private slip = 0;
  private bumpVel = 0;

  constructor(readonly transform: THREE.Object3D, readonly f: VehicleControllerFields) {
    this.steerSpeed = f.rotationSpeed * f.rotationMultiplier;
    this.fatigue = f.maxDirectionDuration;
    this.speed = f.speed;
  }

  reset(): void {
    this.currentRotation = 0;
    this.rotationVelocity = 0;
    this.directionDuration = 0;
    this.lastDirection = 0;
    this.speedMultiplier = 1;
    this.distanceMoved = 0;
    this.slip = 0;
    this.bumpVel = 0;
  }

  /** Dérapage imposé (rad) : la trajectoire s'écarte du cap puis le rattrape (adhérence < 1). */
  kickSlip(rad: number): void {
    this.slip = rad;
  }

  /** Angle de glisse courant (rad). */
  get slipAngle(): number {
    return this.grip >= 1 ? 0 : this.slip;
  }

  /** Écart de trajectoire aléatoire (cratère, préréglage Arcade), en degrés. */
  bump(deg: number): void {
    this.bumpVel += deg * 7;
  }

  /** Update() — input : axe horizontal, planetRadius : SphereCollider.radius (non mis à l'échelle dans l'original). */
  update(dt: number, input: number, planetCenter: THREE.Vector3, planetRadius: number): void {
    const t = this.transform;
    const currentDirection = input > 0 ? 1 : input < 0 ? -1 : 0;
    if (currentDirection === this.lastDirection) this.directionDuration += dt;
    else {
      this.directionDuration = 0;
      this.lastDirection = currentDirection;
    }
    const move = this.speed * this.speedMultiplier * dt;
    // Fatigue : l'original atténue dès le début (hold = 0) ; l'Arcade garde la
    // pleine force pendant `fatigueHold` puis revient en ligne droite
    const span = Math.max(1e-3, this.fatigue - this.fatigueHold);
    const fadeOutFactor = this.fatigue > 0 && currentDirection !== 0 ? Mathf.clamp01(1 - Math.max(0, this.directionDuration - this.fatigueHold) / span) : 1;
    const inputRotation = input * fadeOutFactor;
    const targetRotation = inputRotation * this.steerSpeed;
    [this.currentRotation, this.rotationVelocity] = Mathf.smoothDamp(this.currentRotation, targetRotation, this.rotationVelocity, this.f.rotationSmoothing, Math.max(dt, 1e-6));
    // transform.Rotate(0, a, 0, Space.Self) : +a Unity = −a three (axe X inversé)
    const yaw = this.currentRotation * dt + this.bumpVel * dt;
    this.bumpVel *= Math.exp(-dt * 7);
    t.rotateY(-yaw * Deg2Rad);
    if (this.grip >= 1) {
      // transform.Translate(0, 0, move, Space.Self)
      t.translateZ(move);
    } else {
      // Glisse : la trajectoire suit le cap avec retard (planète gelée)
      this.slip += yaw * Deg2Rad;
      this.slip *= Math.exp(-dt * this.grip * 6);
      const s = Math.max(-1.2, Math.min(1.2, this.slip));
      t.translateZ(move * Math.cos(s));
      t.translateX(move * Math.sin(s));
    }
    this.distanceMoved += move;
    // Gravité : replacement à la surface + orientation
    _gUp.copy(t.position).sub(planetCenter).normalize();
    t.position.copy(planetCenter).addScaledVector(_gUp, planetRadius + this.f.desiredDistanceFromSurface);
    _up.set(0, 1, 0).applyQuaternion(t.quaternion);
    _q.setFromUnitVectors(_up, _gUp);
    t.quaternion.premultiply(_q);
  }

  /** Braquage actuel normalisé (−1..1), pour le son de dérapage et l'inclinaison. */
  get steer(): number {
    return this.currentRotation / Math.max(1, this.steerSpeed);
  }
}
