// このファイルは、プレイヤーの移動・重力・ジャンプ・ブロックとの衝突を計算する。
// プレイヤーを、座標軸に平行な直方体（AABB）として扱う。
// position は足元の中心で、横方向には PLAYER_RADIUS、上には PLAYER_HEIGHT 広がる。
import { SPAWN, WORLD_BOUNDS } from './world.js';

// プレイヤーの当たり判定の横幅の半分。単位はブロックの一辺を 1 とした長さ。
export const PLAYER_RADIUS = 0.3;
// 足から頭までの当たり判定の高さと、カメラを置く目の高さ。
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
// 面に触れただけの状態を「めり込んだ」と誤判定しないための微小な余裕。
const EPSILON = 1e-7;
// 毎秒の落下加速度と、ジャンプ開始時に上へ与える速度。
const GRAVITY = 24;
const JUMP_SPEED = 8.6;

export class PlayerPhysics {
  // ワールドを共有しつつ、初期位置・現在位置・速度はそれぞれ独立した値で持つ。
  constructor(world, position = SPAWN) {
    this.world = world;
    this.spawn = { ...position };
    this.position = { ...position };
    this.velocity = { x: 0, y: 0, z: 0 };
    // 足元を少し下げて試すと、実際に移動せず床の有無を調べられる。
    this.grounded = this.collisions({ ...this.position, y: this.position.y - 0.01 }).length > 0;
    // Space の押しっぱなしを区別し、「押した瞬間」だけジャンプさせる。
    this.jumpHeld = false;
  }

  // 指定した位置にプレイヤーを置いたとき、体と重なる固体ブロックをすべて返す。
  collisions(position = this.position) {
    const hits = [];
    // 体が触れ得る整数座標の範囲だけを調べ、ワールド全体の走査を避ける。
    // EPSILON で境界を内側へ寄せ、床や壁にぴったり接している状態を除外する。
    for (let x = Math.floor(position.x - PLAYER_RADIUS + EPSILON); x <= Math.floor(position.x + PLAYER_RADIUS - EPSILON); x++) {
      for (let y = Math.floor(position.y + EPSILON); y <= Math.floor(position.y + PLAYER_HEIGHT - EPSILON); y++) {
        for (let z = Math.floor(position.z - PLAYER_RADIUS + EPSILON); z <= Math.floor(position.z + PLAYER_RADIUS - EPSILON); z++) {
          if (this.world.get(x, y, z)) hits.push({ x, y, z });
        }
      }
    }
    return hits;
  }

  // 新しく置くブロックがプレイヤーと重なるかを調べる。自分の体への設置防止に使う。
  intersectsBlock(x, y, z) {
    const p = this.position;
    return p.x + PLAYER_RADIUS > x + EPSILON && p.x - PLAYER_RADIUS < x + 1 - EPSILON
      && p.y + PLAYER_HEIGHT > y + EPSILON && p.y < y + 1 - EPSILON
      && p.z + PLAYER_RADIUS > z + EPSILON && p.z - PLAYER_RADIUS < z + 1 - EPSILON;
  }

  // 1 本の軸だけ移動させる。軸ごとに解決すると、壁に当たっても横へ滑って歩ける。
  // 戻り値は、その軸でブロックに衝突したかどうか。
  moveAxis(axis, distance) {
    if (distance === 0) return false;
    this.position[axis] += distance;
    const hits = this.collisions();
    if (hits.length === 0) return false;
    // 上向きなら頭までの高さ、横向きなら体の半幅を使って接触位置へ戻す。
    const extent = axis === 'y' ? PLAYER_HEIGHT : PLAYER_RADIUS;
    if (distance > 0) {
      // 正方向にあるブロックの手前で止める。複数当たった場合は最も手前を選ぶ。
      this.position[axis] = Math.min(...hits.map(block => block[axis] - extent));
    } else {
      // 足元の基準は体の底なので、下向きだけ横幅のような補正を足さない。
      const offset = axis === 'y' ? 0 : PLAYER_RADIUS;
      this.position[axis] = Math.max(...hits.map(block => block[axis] + 1 + offset));
    }
    // 衝突した方向の速度を止め、次の小刻みな移動でめり込みが続くのを防ぐ。
    this.velocity[axis] = 0;
    return true;
  }

  // 経過時間 dt 秒ぶんの物理を進める。yaw はカメラが横に向いている角度。
  step(dt, input = {}, yaw = 0) {
    // 不正な時間は無視し、大きすぎる時間は制限して、復帰直後などの急な移動を防ぐ。
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1);
    // 前後・左右の入力を -1〜1 にそろえる。入力が省略されていれば停止として扱う。
    const forward = Math.max(-1, Math.min(1, input.forward ?? 0));
    const right = Math.max(-1, Math.min(1, input.right ?? 0));
    // 斜め移動だけ速くならないように、入力の長さが 1 を超えた分を割り引く。
    const length = Math.max(1, Math.hypot(forward, right));
    const speed = input.sprint ? 6.5 : 4.3;
    // カメラに対する「前・右」を、ワールドの x・z 方向の速度へ変換する。
    this.velocity.x = (-Math.sin(yaw) * forward + Math.cos(yaw) * right) / length * speed;
    this.velocity.z = (-Math.cos(yaw) * forward - Math.sin(yaw) * right) / length * speed;
    // 地面に立ち、かつ今回 Space を新しく押した場合だけ上向き速度を与える。
    // 押しっぱなしで着地しても、自動で次のジャンプは始まらない。
    if (input.jump && !this.jumpHeld && this.grounded) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }
    this.jumpHeld = Boolean(input.jump);

    // 1 回の計算を、時間は最大 1/120 秒、各軸の移動量は最大 0.2 ブロックに分割する。
    // 高い場所から落ちて速くなっても、床の上から下まで一気に飛び越えにくくする。
    const fastestAxis = Math.max(Math.abs(this.velocity.x), Math.abs(this.velocity.y) + GRAVITY * dt, Math.abs(this.velocity.z));
    const steps = Math.max(Math.ceil(dt / (1 / 120)), Math.ceil(fastestAxis * dt / 0.2));
    const slice = dt / steps;
    for (let index = 0; index < steps; index++) {
      // 横方向を先に解決した後、重力を速度へ加えて縦方向の衝突を解決する。
      this.moveAxis('x', this.velocity.x * slice);
      this.moveAxis('z', this.velocity.z * slice);
      this.velocity.y -= GRAVITY * slice;
      const falling = this.velocity.y < 0;
      const collided = this.moveAxis('y', this.velocity.y * slice);
      // 下向き移動で衝突したときが接地。頭を天井にぶつけた場合は接地扱いしない。
      this.grounded = collided && falling;
    }
    // ワールドの外などへ落ち続けたときは、初期位置の近くへ戻して遊びを続ける。
    if (this.position.y < -24) this.reset();
  }

  // R キーや落下復帰で使う。安全な足場へ戻し、移動・ジャンプ中の状態を消す。
  reset() {
    Object.assign(this.position, this.findSafeSpawn());
    Object.assign(this.velocity, { x: 0, y: 0, z: 0 });
    this.grounded = this.collisions({ ...this.position, y: this.position.y - 0.01 }).length > 0;
    this.jumpHeld = false;
  }

  // 編集で初期地点が掘られたり埋まったりしていても、立てる場所を近くから探す。
  findSafeSpawn() {
    const bounds = WORLD_BOUNDS;
    const centerX = Math.max(bounds.minX, Math.min(bounds.maxX, Math.floor(this.spawn.x)));
    const centerZ = Math.max(bounds.minZ, Math.min(bounds.maxZ, Math.floor(this.spawn.z)));
    const supportHeights = [];
    // 足場の候補を、元の足元の高さに近い順で調べるための一覧を作る。
    for (let y = bounds.minY; y <= bounds.maxY; y++) supportHeights.push(y);
    supportHeights.sort((a, b) => Math.abs(a + 1 - this.spawn.y) - Math.abs(b + 1 - this.spawn.y));

    // 初期地点からマンハッタン距離（横と奥行きの移動数の合計）の小さい順に探す。
    // 地形を書き換えずに復帰位置だけを選ぶため、プレイヤーの建築もそのまま残る。
    const maxRadius = bounds.maxX - bounds.minX + bounds.maxZ - bounds.minZ;
    for (let radius = 0; radius <= maxRadius; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dz = radius - Math.abs(dx);
        // 同じ距離の前後 2 点を調べる。dz=0 なら同じ点を二重に調べない。
        for (const offsetZ of dz === 0 ? [0] : [-dz, dz]) {
          const x = centerX + dx;
          const z = centerZ + offsetZ;
          if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
          for (const y of supportHeights) {
            // 足場があり、その真上に体全体を置いても衝突しない列を採用する。
            if (!this.world.get(x, y, z)) continue;
            const candidate = { x: x + 0.5, y: y + 1, z: z + 0.5 };
            if (this.collisions(candidate).length === 0) return candidate;
          }
        }
      }
    }
    // ブロックが完全になくなると立てる場所は存在しない。その場合だけ元の位置を返す。
    // 描画側に知らせず地形を勝手に再生成するような処理は行わない。
    return { ...this.spawn };
  }
}
