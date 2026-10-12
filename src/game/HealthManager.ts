/**
 * Port de HealthManager.cs : santé, dégâts par nom d'objet (damageItems),
 * soins (healItems), mort → GameOverManager.TriggerGameOver.
 * Les noms d'objets instanciés suivent Unity : « Crater(Clone) », etc.
 */
export interface DamageItem {
  itemName: string;
  damagePoints: number;
}
export interface HealItem {
  itemName: string;
  healPoints: number;
}
export interface HealthManagerFields {
  maxHealth: number;
  damageItems: DamageItem[];
  healItems: HealItem[];
}

export class HealthManager {
  currentHealth: number;
  maxHealth: number;
  dead = false;
  /** Invulnérabilité restante (préréglage Arcade). */
  invulnerable = 0;
  invulnerabilityTime = 0;
  onChange: (hp: number, max: number, delta: number) => void = () => undefined;
  onDie: () => void = () => undefined;

  constructor(readonly f: HealthManagerFields, maxHealth = f.maxHealth) {
    this.maxHealth = maxHealth;
    this.currentHealth = maxHealth;
  }

  start(): void {
    this.currentHealth = this.maxHealth;
    this.dead = false;
    this.invulnerable = 0;
    this.onChange(this.currentHealth, this.maxHealth, 0);
  }

  update(dt: number): void {
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);
  }

  takeDamage(damage: number): boolean {
    // Garde-fou : aucune action pendant la mort ou l'invulnérabilité
    if (this.dead || damage <= 0 || this.invulnerable > 0) return false;
    this.currentHealth = Math.max(this.currentHealth - damage, 0);
    this.invulnerable = this.invulnerabilityTime;
    this.onChange(this.currentHealth, this.maxHealth, -damage);
    if (this.currentHealth <= 0) this.die();
    return true;
  }

  heal(heal: number): void {
    if (this.dead) return;
    const before = this.currentHealth;
    this.currentHealth = Math.min(this.currentHealth + heal, this.maxHealth);
    this.onChange(this.currentHealth, this.maxHealth, this.currentHealth - before);
  }

  private die(): void {
    if (this.dead) return;
    this.dead = true;
    this.onDie();
  }

  /** OnTriggerEnter : couche DamageObject. */
  getDamagePoints(objName: string): number {
    for (const d of this.f.damageItems) if (objName.includes(d.itemName)) return d.damagePoints;
    return 0;
  }

  /** OnTriggerEnter : couche HealObject. */
  getHealPoints(objName: string): number {
    for (const h of this.f.healItems) if (objName.includes(h.itemName)) return h.healPoints;
    return 0;
  }
}
