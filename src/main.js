import './style.css';
import './settings.css';
import * as THREE from 'three';
import { createWorld, raycastVoxel, BLOCK_TYPES } from './world.js';
import { PlayerPhysics, EYE_HEIGHT } from './physics.js';
import { WorldView } from './render.js';
import { createSensitivitySettings } from './settings.js';

const NAMES = { grass: '草ブロック', dirt: '土', stone: '石', wood: '原木', leaves: '葉', sand: '砂' };
const $ = (id) => document.getElementById(id);
const canvas = $('world');
const keys = new Set();
const sensitivity = createSensitivitySettings();
let view, world, player;
let ready = false, locked = false, selected = 0, target = null;
let yaw = -.24, pitch = -.12;
let previousTime = 0, toastTimer;
const direction = new THREE.Vector3();

function updateSensitivityControls(result) {
  const value = sensitivity.value;
  const slider = $('mouse-sensitivity');
  slider.value = value;
  slider.setAttribute('aria-valuetext', `${value}%`);
  slider.style.setProperty('--range-progress', `${(value - Number(slider.min)) / (Number(slider.max) - Number(slider.min)) * 100}%`);
  $('sensitivity-value').textContent = `${value}%`;
  if (result) {
    $('sensitivity-note').textContent = result.saved
      ? 'このブラウザに保存しました · 次回起動時も使えます'
      : '今回の操作には反映済みです · ブラウザへの保存はできませんでした';
  }
}

$('mouse-sensitivity').addEventListener('input', (event) => {
  updateSensitivityControls(sensitivity.set(event.target.value));
});
$('sensitivity-reset').addEventListener('click', () => {
  updateSensitivityControls(sensitivity.reset());
});
updateSensitivityControls();

function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2400);
}

function selectBlock(index) {
  selected = (index + BLOCK_TYPES.length) % BLOCK_TYPES.length;
  document.querySelectorAll('.slot').forEach((button, i) => {
    button.classList.toggle('selected', i === selected);
    button.setAttribute('aria-pressed', String(i === selected));
  });
  $('selected-name').textContent = NAMES[BLOCK_TYPES[selected]];
}

function refreshTarget() {
  direction.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  target = raycastVoxel(world, { x: player.position.x, y: player.position.y + EYE_HEIGHT, z: player.position.z }, direction, 6);
  $('target-label').hidden = !locked || !target;
  if (target) $('target-label').textContent = `${NAMES[target.type]} · ${target.distance.toFixed(1)} m`;
}

function editBlock(button) {
  refreshTarget();
  if (!target) { notify('ブロックに近づいて、照準を合わせてください'); return; }
  let changed = false;
  if (button === 0) changed = world.remove(target.x, target.y, target.z);
  if (button === 2) {
    const { normal } = target;
    const x = target.x + normal.x, y = target.y + normal.y, z = target.z + normal.z;
    if (player.intersectsBlock(x, y, z)) { notify('自分と重なる場所には置けません'); return; }
    changed = world.set(x, y, z, BLOCK_TYPES[selected]);
    if (!changed) notify('ここにはブロックを置けません');
  }
  if (changed) {
    view.rebuild(world);
    refreshTarget();
  }
}

async function start() {
  if (!ready) return;
  if (!canvas.requestPointerLock) {
    $('menu-note').textContent = 'マウスを使えるPC版の Chrome / Edge / Firefox で開いてください。';
    return;
  }
  try {
    await canvas.requestPointerLock();
  } catch {
    $('menu-note').textContent = 'マウス操作を開始できませんでした。もう一度ボタンを押してください。';
  }
}

$('play-button').addEventListener('click', start);
$('help-button').addEventListener('click', () => {
  if (locked) document.exitPointerLock();
  else $('menu').hidden = false;
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  keys.clear();
  $('menu').hidden = locked;
  document.body.classList.toggle('playing', locked);
  if (!locked) {
    $('menu').classList.add('is-paused');
    $('menu-title').textContent = 'ひと休み。';
    $('menu-description').textContent = '自分に合うマウス感度で、世界を歩こう。';
    $('sensitivity-settings').hidden = false;
    $('play-label').textContent = '草原にもどる';
    $('menu-note').textContent = 'クリックで再開 · 変更したブロックはそのままです';
    $('target-label').hidden = true;
    $('mouse-sensitivity').focus({ preventScroll: true });
  }
});
document.addEventListener('pointerlockerror', () => {
  $('menu-note').textContent = 'マウスの捕捉が許可されていません。PCのブラウザで直接開いてください。';
});
document.addEventListener('mousemove', (event) => {
  if (!locked) return;
  const lookSpeed = .002 * sensitivity.value / 100;
  yaw -= event.movementX * lookSpeed;
  pitch = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, pitch - event.movementY * lookSpeed));
});
document.addEventListener('keydown', (event) => {
  if (!locked) return;
  if (event.code === 'Escape') {
    document.exitPointerLock();
    return;
  }
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (/^Digit[1-6]$/.test(event.code)) selectBlock(Number(event.code.slice(-1)) - 1);
  if (event.code === 'KeyR' && !event.repeat) { player.reset(); notify('はじまりの場所にもどりました'); }
});
document.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => {
  keys.clear();
  if (locked) document.exitPointerLock();
});
document.addEventListener('visibilitychange', () => { keys.clear(); previousTime = performance.now(); });
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('mousedown', (event) => {
  if (locked && (event.button === 0 || event.button === 2)) {
    event.preventDefault();
    editBlock(event.button);
  }
});
window.addEventListener('wheel', (event) => {
  if (!locked || !event.deltaY) return;
  event.preventDefault();
  selectBlock(selected + Math.sign(event.deltaY));
}, { passive: false });
window.addEventListener('resize', () => view?.resize());

function frame(time) {
  const dt = Math.min((time - previousTime) / 1000 || 0, .05);
  previousTime = time;
  if (locked) {
    const input = {
      forward: Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')),
      right: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')),
      jump: keys.has('Space'),
      sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    };
    player.step(dt, input, yaw);
    refreshTarget();
  }
  const p = player.position;
  $('coordinates').textContent = `X ${p.x.toFixed(1)} · Y ${p.y.toFixed(1)} · Z ${p.z.toFixed(1)}`;
  view.render(p, yaw, pitch, locked ? target : null);
  requestAnimationFrame(frame);
}

try {
  view = new WorldView(canvas);
  world = createWorld({ trees: true });
  player = new PlayerPhysics(world);
  view.rebuild(world);
  BLOCK_TYPES.forEach((type, index) => {
    const button = document.createElement('button');
    button.className = 'slot';
    button.dataset.type = type;
    button.title = `${index + 1} · ${NAMES[type]}`;
    button.setAttribute('aria-label', `${index + 1}: ${NAMES[type]}`);
    const number = document.createElement('span');
    number.textContent = index + 1;
    const image = document.createElement('img');
    image.src = view.blockIcon(type);
    image.alt = '';
    button.append(number, image);
    button.addEventListener('click', () => selectBlock(index));
    $('hotbar').append(button);
  });
  selectBlock(0);
  ready = true;
  $('play-button').disabled = false;
  $('play-label').textContent = '世界に入る';
  requestAnimationFrame(frame);
} catch (error) {
  console.error(error);
  $('fatal-message').textContent = 'WebGL を使えるPCのブラウザで開いてください。ブラウザのハードウェアアクセラレーション設定も確認してください。';
  $('fatal-error').hidden = false;
}

// Read-only diagnostics used by the real-browser smoke test; absent in normal play.
if (new URLSearchParams(location.search).has('test')) {
  window.__FIELDCRAFT_TEST__ = () => ({
    ready, locked, position: player ? { ...player.position } : null,
    grounded: player?.grounded ?? false, yaw, pitch, sensitivity: sensitivity.value,
    selectedType: BLOCK_TYPES[selected], target: target ? { ...target, normal: { ...target.normal } } : null,
    blockCount: world?.blocks.size ?? 0,
    renderCalls: view?.renderer.info.render.calls ?? 0,
    triangles: view?.renderer.info.render.triangles ?? 0,
  });
}
