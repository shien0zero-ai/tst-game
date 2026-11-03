// 【描画担当】Three.js で草原を描き、ブロックの画像・選択枠・空の表現をまとめる。
// 衝突判定やワールドの変更はここでは行わず、渡されたデータを画面に映す。
import * as THREE from 'three';
import { EYE_HEIGHT } from './physics.js';

// 16×16 ピクセルの画像を横に並べた「テクスチャアトラス」内の位置。
// 草や原木は上面と側面の柄が違うため、それぞれ別の区画を使う。
const TILES = { grassTop: 0, grassSide: 1, dirt: 2, stone: 3, wood: 4, woodTop: 5, leaves: 6, sand: 7 };
// 各区画の基準色。下の画像生成処理で色に小さなばらつきを加える。
const PALETTES = ['#7eac4e', '#866140', '#896244', '#93968c', '#81603d', '#ad8957', '#5d8b43', '#d9cc97'];
// 立方体の 6 面を +X、-X、+Y（上）、-Y（下）、+Z、-Z の順で定義する。
// n は面の外向き方向、v は外側から見て反時計回りの四隅、shade は面ごとの明るさ。
// 頂点の順序をそろえることで、Three.js が表と裏を正しく区別できる。
const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: .88 },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: .8 },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: .6 },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: .92 },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: .84 },
];

// ブロックの種類と面番号から、貼る画像の区画を選ぶ。
function tileFor(type, face) {
  if (type === 'grass') return face === 2 ? TILES.grassTop : face === 3 ? TILES.dirt : TILES.grassSide;
  if (type === 'wood') return face === 2 || face === 3 ? TILES.woodTop : TILES.wood;
  return TILES[type];
}

// 外部の画像を読み込まず、8 種類のピクセル画像を Canvas 上に生成する。
function makeAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  // 種を固定した疑似乱数なので、再起動しても同じ模様になる。
  let seed = 381;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  PALETTES.forEach((base, tile) => {
    const color = new THREE.Color(base);
    // 区画内の各ピクセルを少し明るく／暗くして、ブロックらしい粒状の模様にする。
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let variation = .83 + random() * .31;
        // 原木の側面には縦の筋、葉には濃い斑点を加える。
        if (tile === TILES.wood) variation *= x % 5 === 0 ? .7 : 1;
        if (tile === TILES.leaves) variation *= random() < .16 ? .76 : 1;
        let pixel = color.clone().multiplyScalar(variation);
        // 草の側面の上端だけを緑にし、原木の切り口には四角い年輪を描く。
        if (tile === TILES.grassSide && y < 3 + (x * 7 % 3)) pixel = new THREE.Color('#78a64a').multiplyScalar(variation);
        if (tile === TILES.woodTop) {
          const ring = Math.floor(Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)));
          pixel.multiplyScalar(ring % 3 === 0 ? .76 : 1.08);
        }
        ctx.fillStyle = `#${pixel.getHexString()}`;
        // tile * 16 が横方向の区画位置。1 ピクセルずつ塗りつぶす。
        ctx.fillRect(tile * 16 + x, y, 1, 1);
      }
    }
  });
  // Canvas を 3D 用画像に変換する。NearestFilter は拡大時にもドットをぼかさない設定。
  // sRGB は画像の色の扱い、ミップマップ無効化は縮小用の別画像を作らない設定。
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return { canvas, texture };
}

// 描画に必要な機材（renderer）、舞台（scene）、視点（camera）を所有するクラス。
export class WorldView {
  // ゲーム開始時に一度だけ、描画装置・照明・雲・選択枠を準備する。
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // 高精細画面で描くピクセル数が増えすぎないよう、倍率に上限を設ける。
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor('#acd1dc');
    // 遠方を霧で空色に溶かし込み、遠くの草原の境界をやわらげる。
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#bdd9d3', 27, 78);
    // 遠近感のある一人称カメラ。引数は視野角、縦横比、近端、遠端。
    // Y（左右）→ X（上下）の順で回転し、視点の傾きが混ざらないようにする。
    this.camera = new THREE.PerspectiveCamera(72, 1, .05, 180);
    this.camera.rotation.order = 'YXZ';
    // 空と地面からの柔らかい光に、太陽を表す平行光を重ねる。
    this.scene.add(new THREE.HemisphereLight('#f3f6ed', '#697d46', 2.1));
    const sun = new THREE.DirectionalLight('#fff0cd', 2.2);
    sun.position.set(-22, 36, 14);
    sun.castShadow = true;
    // 太陽から見た範囲を影用画像に描く。bias は表面の不自然な影を抑える微調整。
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 100 });
    sun.shadow.normalBias = .04;
    sun.shadow.bias = -.00015;
    this.scene.add(sun);
    // 同じアトラスと材質を地形全体で共有し、描画の切り替え回数を減らす。
    // Lambert 材質は光に応じた陰影、vertexColors は面ごとの明るさを利用する。
    const atlas = makeAtlas();
    this.atlas = atlas.canvas;
    this.material = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true });
    this.terrain = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.terrain.castShadow = true;
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
    // 狙ったブロックを囲む線。ブロックよりわずかに大きくして表面とのちらつきを避ける。
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)), new THREE.LineBasicMaterial({ color: '#fff8d2', transparent: true, opacity: .9 }));
    this.outline.visible = false;
    this.scene.add(this.outline);
    // 雲は位置と大きさを指定した直方体で表現する。地形とは別の装飾で、衝突はしない。
    this.clouds = new THREE.Group();
    const cloudMaterial = new THREE.MeshLambertMaterial({ color: '#fffdf0', transparent: true, opacity: .83 });
    [[-24, 23, -36, 13, 2, 6], [3, 26, -43, 18, 2, 5], [28, 22, -32, 11, 2, 7], [-38, 21, 9, 14, 2, 5], [35, 26, 22, 16, 2, 7]].forEach(([x,y,z,w,h,d]) => {
      const cloud = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), cloudMaterial);
      cloud.position.set(x,y,z);
      this.clouds.add(cloud);
    });
    this.scene.add(this.clouds);
    this.resize();
  }

  // ブロックを壊した／置いたとき、現在のワールドから描画用の面を作り直す。
  rebuild(world) {
    // 頂点座標・面の向き・色・画像の位置（UV）を、同じ順序で配列に蓄える。
    const positions = [], normals = [], colors = [], uvs = [];
    // 四角形を 2 枚の三角形に分ける。GPU はこの三角形を描画する。
    const indices = [0, 1, 2, 0, 2, 3];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const { x, y, z, type } of world.entries()) {
      FACES.forEach((face, faceIndex) => {
        // 隣もブロックなら間の面は見えないので作らない（地中などの無駄な描画を省く）。
        if (world.get(x + face.n[0], y + face.n[1], z + face.n[2])) return;
        const tile = tileFor(type, faceIndex);
        for (const index of indices) {
          const vertex = face.v[index];
          // 立方体内の 0〜1 の頂点を、ワールド内のブロック位置に移す。
          positions.push(x + vertex[0], y + vertex[1], z + vertex[2]);
          normals.push(...face.n);
          // 面ごとの陰影に加え、草の上面には位置から決まる小さな色むらを付ける。
          const shade = face.shade * (type === 'grass' && faceIndex === 2 ? 1 - ((x * 17 + z * 31) & 3) * .018 : 1);
          colors.push(shade, shade, shade);
          // ピクセル座標を 0〜1 の画像座標に変換する。端を少し内側に寄せ、隣の柄の混入を防ぐ。
          uvs.push((tile * 16 + .02 + uv[index][0] * 15.96) / 128, (.02 + uv[index][1] * 15.96) / 16);
        }
      });
    }
    // 4 種類の配列を GPU に渡せる形式へまとめる。3 は XYZ/RGB、2 は UV の要素数。
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    // 境界球はカメラに入るかの判定に使う。交換前の形状は GPU メモリから解放する。
    geometry.computeBoundingSphere();
    this.terrain.geometry.dispose();
    this.terrain.geometry = geometry;
  }

  // パレットに表示する、小さな立体ブロック風の画像を生成する。
  blockIcon(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 48; canvas.height = 52;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // 座標変換で正方形の柄を斜めの面にし、暗い色を重ねて面の向きを見分けやすくする。
    // save/restore により、各面の変換が次の面に影響しないようにする。
    const draw = (face, transform, darkness) => {
      ctx.save();
      ctx.transform(...transform);
      ctx.drawImage(this.atlas, tileFor(type, face) * 16, 0, 16, 16, 0, 0, 16, 16);
      ctx.fillStyle = `rgba(15,25,15,${darkness})`;
      ctx.fillRect(0, 0, 16, 16);
      ctx.restore();
    };
    // 上・手前・右の順に描いて、一つの立方体に見せる。
    draw(2, [1.25, -.625, 1.25, .625, 4, 14], 0);
    draw(4, [1.25, .625, 0, 1.5, 4, 14], .1);
    draw(0, [1.25, -.625, 0, 1.5, 24, 24], .22);
    // 画像そのものを URL 文字列にし、追加のファイルなしで HTML の img に渡す。
    return canvas.toDataURL();
  }

  // ウィンドウが変わったら、描画サイズとカメラの縦横比の両方を合わせる。
  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // 毎フレーム、足元の位置に目の高さを足してカメラを置き、現在の視点で描く。
  render(position, yaw, pitch, target) {
    this.camera.position.set(position.x, position.y + EYE_HEIGHT, position.z);
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    // ターゲットがあるときだけ枠を表示し、整数のブロック座標から中心へ半分ずらす。
    this.outline.visible = !!target;
    if (target) this.outline.position.set(target.x + .5, target.y + .5, target.z + .5);
    this.renderer.render(this.scene, this.camera);
  }
}
