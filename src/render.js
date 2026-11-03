import * as THREE from 'three';
import { EYE_HEIGHT } from './physics.js';

const TILES = { grassTop: 0, grassSide: 1, dirt: 2, stone: 3, wood: 4, woodTop: 5, leaves: 6, sand: 7 };
const PALETTES = ['#7eac4e', '#866140', '#896244', '#93968c', '#81603d', '#ad8957', '#5d8b43', '#d9cc97'];
const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: .88 },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: .8 },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: .6 },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: .92 },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: .84 },
];

function tileFor(type, face) {
  if (type === 'grass') return face === 2 ? TILES.grassTop : face === 3 ? TILES.dirt : TILES.grassSide;
  if (type === 'wood') return face === 2 || face === 3 ? TILES.woodTop : TILES.wood;
  return TILES[type];
}

function makeAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  let seed = 381;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  PALETTES.forEach((base, tile) => {
    const color = new THREE.Color(base);
    // Pixel textures are generated locally, so the game needs no image requests.
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let variation = .83 + random() * .31;
        if (tile === TILES.wood) variation *= x % 5 === 0 ? .7 : 1;
        if (tile === TILES.leaves) variation *= random() < .16 ? .76 : 1;
        let pixel = color.clone().multiplyScalar(variation);
        if (tile === TILES.grassSide && y < 3 + (x * 7 % 3)) pixel = new THREE.Color('#78a64a').multiplyScalar(variation);
        if (tile === TILES.woodTop) {
          const ring = Math.floor(Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)));
          pixel.multiplyScalar(ring % 3 === 0 ? .76 : 1.08);
        }
        ctx.fillStyle = `#${pixel.getHexString()}`;
        ctx.fillRect(tile * 16 + x, y, 1, 1);
      }
    }
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return { canvas, texture };
}

export class WorldView {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor('#acd1dc');
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#bdd9d3', 27, 78);
    this.camera = new THREE.PerspectiveCamera(72, 1, .05, 180);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(new THREE.HemisphereLight('#f3f6ed', '#697d46', 2.1));
    const sun = new THREE.DirectionalLight('#fff0cd', 2.2);
    sun.position.set(-22, 36, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 100 });
    sun.shadow.normalBias = .04;
    sun.shadow.bias = -.00015;
    this.scene.add(sun);
    const atlas = makeAtlas();
    this.atlas = atlas.canvas;
    this.material = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true });
    this.terrain = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.terrain.castShadow = true;
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)), new THREE.LineBasicMaterial({ color: '#fff8d2', transparent: true, opacity: .9 }));
    this.outline.visible = false;
    this.scene.add(this.outline);
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

  rebuild(world) {
    const positions = [], normals = [], colors = [], uvs = [];
    const indices = [0, 1, 2, 0, 2, 3];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const { x, y, z, type } of world.entries()) {
      FACES.forEach((face, faceIndex) => {
        if (world.get(x + face.n[0], y + face.n[1], z + face.n[2])) return;
        const tile = tileFor(type, faceIndex);
        for (const index of indices) {
          const vertex = face.v[index];
          positions.push(x + vertex[0], y + vertex[1], z + vertex[2]);
          normals.push(...face.n);
          const shade = face.shade * (type === 'grass' && faceIndex === 2 ? 1 - ((x * 17 + z * 31) & 3) * .018 : 1);
          colors.push(shade, shade, shade);
          uvs.push((tile * 16 + .02 + uv[index][0] * 15.96) / 128, (.02 + uv[index][1] * 15.96) / 16);
        }
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingSphere();
    this.terrain.geometry.dispose();
    this.terrain.geometry = geometry;
  }

  blockIcon(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 48; canvas.height = 52;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const draw = (face, transform, darkness) => {
      ctx.save();
      ctx.transform(...transform);
      ctx.drawImage(this.atlas, tileFor(type, face) * 16, 0, 16, 16, 0, 0, 16, 16);
      ctx.fillStyle = `rgba(15,25,15,${darkness})`;
      ctx.fillRect(0, 0, 16, 16);
      ctx.restore();
    };
    draw(2, [1.25, -.625, 1.25, .625, 4, 14], 0);
    draw(4, [1.25, .625, 0, 1.5, 4, 14], .1);
    draw(0, [1.25, -.625, 0, 1.5, 24, 24], .22);
    return canvas.toDataURL();
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  render(position, yaw, pitch, target) {
    this.camera.position.set(position.x, position.y + EYE_HEIGHT, position.z);
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    this.outline.visible = !!target;
    if (target) this.outline.position.set(target.x + .5, target.y + .5, target.z + .5);
    this.renderer.render(this.scene, this.camera);
  }
}
