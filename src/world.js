export const WORLD_BOUNDS = Object.freeze({ minX: -32, maxX: 31, minY: -4, maxY: 31, minZ: -32, maxZ: 31 });
export const SPAWN = Object.freeze({ x: 0.5, y: 0, z: 7.5 });
export const BLOCK_TYPES = Object.freeze(['grass', 'dirt', 'stone', 'wood', 'leaves', 'sand']);

const keyOf = (x, y, z) => `${x},${y},${z}`;

export class VoxelWorld {
  constructor() {
    this.blocks = new Map();
  }

  get(x, y, z) {
    return this.blocks.get(keyOf(x, y, z)) ?? null;
  }

  set(x, y, z, type) {
    const bounds = WORLD_BOUNDS;
    if (![x, y, z].every(Number.isInteger) || !BLOCK_TYPES.includes(type)
      || x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY
      || z < bounds.minZ || z > bounds.maxZ || this.get(x, y, z)) return false;
    this.blocks.set(keyOf(x, y, z), type);
    return true;
  }

  remove(x, y, z) {
    return this.blocks.delete(keyOf(x, y, z));
  }

  *entries() {
    for (const [key, type] of this.blocks) {
      const [x, y, z] = key.split(',').map(Number);
      yield { x, y, z, type };
    }
  }
}

export function createWorld({ trees = true } = {}) {
  const world = new VoxelWorld();
  for (let x = WORLD_BOUNDS.minX; x <= WORLD_BOUNDS.maxX; x++) {
    for (let z = WORLD_BOUNDS.minZ; z <= WORLD_BOUNDS.maxZ; z++) {
      world.set(x, -4, z, 'stone');
      world.set(x, -3, z, 'stone');
      world.set(x, -2, z, 'dirt');
      world.set(x, -1, z, 'grass');
    }
  }
  if (!trees) return world;

  const treesAt = [[-5, -6], [6, -10], [-11, 3], [11, 5], [-17, -15], [16, -18],
    [-22, 13], [21, 16], [-9, 19], [8, 24], [-24, -26], [25, -5], [0, -24]];
  for (let index = 0; index < treesAt.length; index++) {
    const [x, z] = treesAt[index];
    const height = 4 + index % 2;
    for (let y = 0; y < height; y++) world.set(x, y, z, 'wood');
    for (let y = height - 2; y <= height + 1; y++) {
      const radius = y === height + 1 ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
          world.set(x + dx, y, z + dz, 'leaves');
        }
      }
    }
  }
  return world;
}

// Amanatides–Woo traversal finds a voxel and its entered face without mesh raycasts.
export function raycastVoxel(world, origin, direction, maxDistance = 6) {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(length) || length === 0 || maxDistance < 0
    || ![origin.x, origin.y, origin.z].every(Number.isFinite)) return null;
  const dir = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  const cell = { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) };
  const step = {};
  const next = {};
  const delta = {};
  for (const axis of ['x', 'y', 'z']) {
    step[axis] = Math.sign(dir[axis]);
    delta[axis] = dir[axis] === 0 ? Infinity : Math.abs(1 / dir[axis]);
    next[axis] = dir[axis] === 0 ? Infinity
      : ((cell[axis] + (step[axis] > 0 ? 1 : 0)) - origin[axis]) / dir[axis];
  }
  let distance = 0;
  let normal = { x: 0, y: 0, z: 0 };
  while (distance <= maxDistance) {
    const type = world.get(cell.x, cell.y, cell.z);
    if (type) return { ...cell, normal, distance, type };
    const axis = next.x <= next.y && next.x <= next.z ? 'x' : next.y <= next.z ? 'y' : 'z';
    distance = next[axis];
    if (!Number.isFinite(distance)) break;
    cell[axis] += step[axis];
    next[axis] += delta[axis];
    normal = { x: 0, y: 0, z: 0 };
    normal[axis] = -step[axis];
  }
  return null;
}
