import { SPAWN, WORLD_BOUNDS } from './world.js';

export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
const EPSILON = 1e-7;
const GRAVITY = 24;
const JUMP_SPEED = 8.6;

export class PlayerPhysics {
  constructor(world, position = SPAWN) {
    this.world = world;
    this.spawn = { ...position };
    this.position = { ...position };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.grounded = this.collisions({ ...this.position, y: this.position.y - 0.01 }).length > 0;
    this.jumpHeld = false;
  }

  collisions(position = this.position) {
    const hits = [];
    for (let x = Math.floor(position.x - PLAYER_RADIUS + EPSILON); x <= Math.floor(position.x + PLAYER_RADIUS - EPSILON); x++) {
      for (let y = Math.floor(position.y + EPSILON); y <= Math.floor(position.y + PLAYER_HEIGHT - EPSILON); y++) {
        for (let z = Math.floor(position.z - PLAYER_RADIUS + EPSILON); z <= Math.floor(position.z + PLAYER_RADIUS - EPSILON); z++) {
          if (this.world.get(x, y, z)) hits.push({ x, y, z });
        }
      }
    }
    return hits;
  }

  intersectsBlock(x, y, z) {
    const p = this.position;
    return p.x + PLAYER_RADIUS > x + EPSILON && p.x - PLAYER_RADIUS < x + 1 - EPSILON
      && p.y + PLAYER_HEIGHT > y + EPSILON && p.y < y + 1 - EPSILON
      && p.z + PLAYER_RADIUS > z + EPSILON && p.z - PLAYER_RADIUS < z + 1 - EPSILON;
  }

  moveAxis(axis, distance) {
    if (distance === 0) return false;
    this.position[axis] += distance;
    const hits = this.collisions();
    if (hits.length === 0) return false;
    const extent = axis === 'y' ? PLAYER_HEIGHT : PLAYER_RADIUS;
    if (distance > 0) {
      this.position[axis] = Math.min(...hits.map(block => block[axis] - extent));
    } else {
      const offset = axis === 'y' ? 0 : PLAYER_RADIUS;
      this.position[axis] = Math.max(...hits.map(block => block[axis] + 1 + offset));
    }
    this.velocity[axis] = 0;
    return true;
  }

  // jump is edge-triggered here: holding Space never repeatedly jumps on landing.
  step(dt, input = {}, yaw = 0) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1);
    const forward = Math.max(-1, Math.min(1, input.forward ?? 0));
    const right = Math.max(-1, Math.min(1, input.right ?? 0));
    const length = Math.max(1, Math.hypot(forward, right));
    const speed = input.sprint ? 6.5 : 4.3;
    this.velocity.x = (-Math.sin(yaw) * forward + Math.cos(yaw) * right) / length * speed;
    this.velocity.z = (-Math.cos(yaw) * forward - Math.sin(yaw) * right) / length * speed;
    if (input.jump && !this.jumpHeld && this.grounded) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }
    this.jumpHeld = Boolean(input.jump);

    // Bound both elapsed time and distance per substep. This also protects a
    // long fall from skipping an entire block when its vertical speed grows.
    const fastestAxis = Math.max(Math.abs(this.velocity.x), Math.abs(this.velocity.y) + GRAVITY * dt, Math.abs(this.velocity.z));
    const steps = Math.max(Math.ceil(dt / (1 / 120)), Math.ceil(fastestAxis * dt / 0.2));
    const slice = dt / steps;
    for (let index = 0; index < steps; index++) {
      this.moveAxis('x', this.velocity.x * slice);
      this.moveAxis('z', this.velocity.z * slice);
      this.velocity.y -= GRAVITY * slice;
      const falling = this.velocity.y < 0;
      const collided = this.moveAxis('y', this.velocity.y * slice);
      this.grounded = collided && falling;
    }
    if (this.position.y < -24) this.reset();
  }

  reset() {
    Object.assign(this.position, this.findSafeSpawn());
    Object.assign(this.velocity, { x: 0, y: 0, z: 0 });
    this.grounded = this.collisions({ ...this.position, y: this.position.y - 0.01 }).length > 0;
    this.jumpHeld = false;
  }

  findSafeSpawn() {
    const bounds = WORLD_BOUNDS;
    const centerX = Math.max(bounds.minX, Math.min(bounds.maxX, Math.floor(this.spawn.x)));
    const centerZ = Math.max(bounds.minZ, Math.min(bounds.maxZ, Math.floor(this.spawn.z)));
    const supportHeights = [];
    for (let y = bounds.minY; y <= bounds.maxY; y++) supportHeights.push(y);
    supportHeights.sort((a, b) => Math.abs(a + 1 - this.spawn.y) - Math.abs(b + 1 - this.spawn.y));

    // Search outward so a mined-out or obstructed spawn does not trap the
    // player. Existing blocks are never added, removed, or overwritten here.
    const maxRadius = bounds.maxX - bounds.minX + bounds.maxZ - bounds.minZ;
    for (let radius = 0; radius <= maxRadius; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dz = radius - Math.abs(dx);
        for (const offsetZ of dz === 0 ? [0] : [-dz, dz]) {
          const x = centerX + dx;
          const z = centerZ + offsetZ;
          if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
          for (const y of supportHeights) {
            if (!this.world.get(x, y, z)) continue;
            const candidate = { x: x + 0.5, y: y + 1, z: z + 0.5 };
            if (this.collisions(candidate).length === 0) return candidate;
          }
        }
      }
    }
    // An entirely empty world has no safe support. Keep its deterministic
    // fallback rather than silently regenerating terrain behind the renderer.
    return { ...this.spawn };
  }
}
