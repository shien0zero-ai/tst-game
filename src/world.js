// このファイルは「どの座標に何のブロックがあるか」を管理する。
// ブロック (x, y, z) は、各軸の x〜x+1、y〜y+1、z〜z+1 を占める立方体。
// 描画処理から独立しているため、衝突判定やテストからも同じ地形データを使える。

// 設置できる座標の範囲。横・奥行きは 64 ブロックで、高さ方向にも上限を設ける。
export const WORLD_BOUNDS = Object.freeze({ minX: -32, maxX: 31, minY: -4, maxY: 31, minZ: -32, maxZ: 31 });
// プレイヤーの初期位置。y は目の高さではなく足元の高さで、草の表面が y=0。
export const SPAWN = Object.freeze({ x: 0.5, y: 0, z: 7.5 });
// ゲーム内の素材名と一覧の順序。ホットバーには、採掘した素材が入手順で登録される。
export const BLOCK_TYPES = Object.freeze(['grass', 'dirt', 'stone', 'wood', 'leaves', 'sand']);

// 3 つの数値を、Map のキーに使える「x,y,z」という文字列へ変換する。
const keyOf = (x, y, z) => `${x},${y},${z}`;

// 空気の座標は保存せず、ブロックが存在する座標だけを Map に入れる。
export class VoxelWorld {
  constructor() {
    // キーは座標の文字列、値は 'grass' などのブロック名。
    this.blocks = new Map();
  }

  // 指定位置のブロック名を返す。何もなければ空気を表す null を返す。
  get(x, y, z) {
    return this.blocks.get(keyOf(x, y, z)) ?? null;
  }

  // 空いている位置へブロックを追加し、成功なら true を返す。
  set(x, y, z, type) {
    const bounds = WORLD_BOUNDS;
    // 小数の座標、未対応の種類、範囲外、既存ブロックの上書きは受け付けない。
    if (![x, y, z].every(Number.isInteger) || !BLOCK_TYPES.includes(type)
      || x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY
      || z < bounds.minZ || z > bounds.maxZ || this.get(x, y, z)) return false;
    this.blocks.set(keyOf(x, y, z), type);
    return true;
  }

  // ブロックを取り除く。もともと空気だった場合は Map.delete が false を返す。
  remove(x, y, z) {
    return this.blocks.delete(keyOf(x, y, z));
  }

  // 描画などで全ブロックを順番に読むためのジェネレーター。
  // 保存用の文字列キーを数値の座標へ戻し、1 件ずつ渡す。
  *entries() {
    for (const [key, type] of this.blocks) {
      const [x, y, z] = key.split(',').map(Number);
      yield { x, y, z, type };
    }
  }
}

// 毎回同じ草原と木を作る。trees=false は、木なしの地形を調べるテストなどで使う。
export function createWorld({ trees = true } = {}) {
  const world = new VoxelWorld();
  // 各列に石・石・土・草の 4 層を積む。最上段の草の上面が高さ 0 になる。
  for (let x = WORLD_BOUNDS.minX; x <= WORLD_BOUNDS.maxX; x++) {
    for (let z = WORLD_BOUNDS.minZ; z <= WORLD_BOUNDS.maxZ; z++) {
      world.set(x, -4, z, 'stone');
      world.set(x, -3, z, 'stone');
      world.set(x, -2, z, 'dirt');
      world.set(x, -1, z, 'grass');
    }
  }
  // 木が不要なら、地面だけを作った時点で完成したワールドを返す。
  if (!trees) return world;

  // 木の位置は固定し、初期位置付近は歩きやすい空間として残す。
  const treesAt = [[-5, -6], [6, -10], [-11, 3], [11, 5], [-17, -15], [16, -18],
    [-22, 13], [21, 16], [-9, 19], [8, 24], [-24, -26], [25, -5], [0, -24]];
  for (let index = 0; index < treesAt.length; index++) {
    const [x, z] = treesAt[index];
    // 木ごとに幹を 4 段と 5 段で交互に変え、少し違う形にする。
    const height = 4 + index % 2;
    for (let y = 0; y < height; y++) world.set(x, y, z, 'wood');
    // 幹の上側を葉で包む。頂上だけ横幅を狭くして、段のある樹冠を作る。
    for (let y = height - 2; y <= height + 1; y++) {
      const radius = y === height + 1 ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          // 四隅を省いて、完全な四角よりも木らしい輪郭にする。
          if (Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
          // set は上書きしないため、葉の範囲と重なっても幹はそのまま残る。
          world.set(x + dx, y, z + dz, 'leaves');
        }
      }
    }
  }
  return world;
}

// 視線が最初に当たるブロックを調べる DDA（格子を順にたどる方法）。
// 描画用の立体すべてに当たり判定をする代わりに、視線が通るマスだけを調べる。
// normal は当たった面の外向きの方向で、隣へ新しいブロックを置く位置の計算に使う。
export function raycastVoxel(world, origin, direction, maxDistance = 6) {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  // 方向がゼロ・数値でない座標などでは、安全に「当たらない」という結果を返す。
  if (!Number.isFinite(length) || length === 0 || maxDistance < 0
    || ![origin.x, origin.y, origin.z].every(Number.isFinite)) return null;
  // 方向の長さを 1 にそろえると、後で求める distance をブロック単位で扱える。
  const dir = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  // 視線の開始地点が含まれるブロック座標。負の座標も floor で正しく区切る。
  const cell = { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) };
  // step: 各軸へ進む向き、next: 次のマス境界までの距離、delta: 境界同士の間隔。
  const step = {};
  const next = {};
  const delta = {};
  for (const axis of ['x', 'y', 'z']) {
    step[axis] = Math.sign(dir[axis]);
    // 進まない軸は Infinity にして、その軸の境界を選ばないようにする。
    delta[axis] = dir[axis] === 0 ? Infinity : Math.abs(1 / dir[axis]);
    // 正方向なら現在のマスの奥側、負方向なら手前側の境界を最初に目指す。
    next[axis] = dir[axis] === 0 ? Infinity
      : ((cell[axis] + (step[axis] > 0 ? 1 : 0)) - origin[axis]) / dir[axis];
  }
  let distance = 0;
  // 開始地点にブロックがある場合は、まだ境界を通っていないので面の方向はゼロ。
  let normal = { x: 0, y: 0, z: 0 };
  // 操作可能な距離を超えるまで、最も近い次の境界へ進み続ける。
  while (distance <= maxDistance) {
    const type = world.get(cell.x, cell.y, cell.z);
    // 最初に見つけたブロックが、視線から最も近い対象になる。
    if (type) return { ...cell, normal, distance, type };
    const axis = next.x <= next.y && next.x <= next.z ? 'x' : next.y <= next.z ? 'y' : 'z';
    distance = next[axis];
    if (!Number.isFinite(distance)) break;
    // 境界をまたいだ軸だけを 1 マス進め、その軸の次の境界距離を更新する。
    cell[axis] += step[axis];
    next[axis] += delta[axis];
    normal = { x: 0, y: 0, z: 0 };
    // 入ってきた向きの反対側が、視線に向いている面の外向き方向になる。
    normal[axis] = -step[axis];
  }
  // 射程内に対象のブロックが見つからなかった。
  return null;
}
