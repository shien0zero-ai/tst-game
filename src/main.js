/**
 * ゲームの入口。入力、画面の切替、地形、物理計算、描画をつなぐ。
 * start / playing / pause / inventory を分け、メニューの操作で地形を変えないようにする。
 */
import './style.css';
import './settings.css';
import './game-ui.css';
import * as THREE from 'three';
import { createWorld, raycastVoxel, BLOCK_TYPES } from './world.js';
import { PlayerPhysics, EYE_HEIGHT } from './physics.js';
import { WorldView } from './render.js';
import { createSensitivitySettings } from './settings.js';
import { createKeybindingsSettings, formatKey } from './keybindings.js';
import { createKeybindPanel } from './keybind-panel.js';
import { createInventory } from './inventory.js';
import { createFpsCounter } from './fps.js';

// 内部のブロック名を表示用の日本語へ変換する。$ は id で HTML を探す省略形。
const NAMES = { grass: '草ブロック', dirt: '土', stone: '石', wood: '原木', leaves: '葉', sand: '砂' };
const $ = id => document.getElementById(id);
const canvas = $('world');
const keys = new Set();
const sensitivity = createSensitivitySettings();
const bindings = createKeybindingsSettings();
const inventory = createInventory();
const fpsCounter = createFpsCounter();
const direction = new THREE.Vector3();
const icons = new Map();
let view, world, player;
let ready = false, locked = false, mode = 'start', target = null;
let nextUnlockMode = 'pause';
let yaw = -.24, pitch = -.12;
let previousTime = 0, toastTimer;

// 短い案内を表示し、2.4 秒後に隠す。前の消去予約は取り消してから上書きする。
function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2400);
}

// 保存された感度を、数値・読み上げ用属性・スライダーの塗り分けに反映する。
function updateSensitivityControls(result) {
  const value = sensitivity.value;
  const slider = $('mouse-sensitivity');
  slider.value = value;
  slider.setAttribute('aria-valuetext', `${value}%`);
  slider.style.setProperty('--range-progress', `${(value - Number(slider.min)) / (Number(slider.max) - Number(slider.min)) * 100}%`);
  $('sensitivity-value').textContent = `${value}%`;
  if (result) $('sensitivity-note').textContent = result.saved
    ? 'このブラウザに保存しました · 次回起動時も使えます'
    : '今回の操作には反映済みです · ブラウザへの保存はできませんでした';
}
$('mouse-sensitivity').addEventListener('input', event => updateSensitivityControls(sensitivity.set(event.target.value)));
$('sensitivity-reset').addEventListener('click', () => updateSensitivityControls(sensitivity.reset()));
updateSensitivityControls();

// 実際に割り当てたキーで説明を描く。文字列は HTML として解釈せず DOM に入れる。
function keyHint(action, description) {
  const wrapper = document.createElement('span');
  const key = document.createElement('kbd');
  key.textContent = formatKey(bindings.get(action));
  wrapper.append(key, ` ${description}`);
  return wrapper;
}
function refreshBindingHints() {
  keys.clear();
  $('intro-controls').replaceChildren(
    keyHint('forward', '前進'), keyHint('left', '左'), keyHint('backward', '後退'),
    keyHint('right', '右'), keyHint('jump', 'ジャンプ'), keyHint('inventory', '持ち物'),
  );
  const fixedHelp = document.createElement('span');
  fixedHelp.textContent = '左クリック 壊す / 右クリック 置く';
  const pauseHint = document.createElement('span');
  pauseHint.textContent = 'Esc 設定';
  $('quick-help').replaceChildren(fixedHelp, keyHint('inventory', '持ち物'), pauseHint);
  $('inventory-controls').textContent = `${formatKey(bindings.get('inventory'))} で閉じる · Esc で設定へ`;
  if (ready) refreshInventory();
}

// キー捕捉の処理は、ゲームのキー処理よりも先に呼ぶ。設定中の入力で移動させない。
const keybindPanel = createKeybindPanel({
  settings: bindings, listElement: $('keybind-list'), noteElement: $('keybind-note'),
  resetButton: $('keybind-reset'), onChange: refreshBindingHints,
});

// Esc 画面のタブを切り替える。途中のキー入力待ちは取り消してから隠す。
function showSettingsTab(tab) {
  keybindPanel.cancel();
  const mouse = tab === 'mouse';
  $('sensitivity-settings').hidden = !mouse;
  $('keybind-settings').hidden = mouse;
  $('mouse-tab').setAttribute('aria-selected', String(mouse));
  $('keys-tab').setAttribute('aria-selected', String(!mouse));
}
$('mouse-tab').addEventListener('click', () => showSettingsTab('mouse'));
$('keys-tab').addEventListener('click', () => showSettingsTab('keys'));

// 二つの画面にあるホットバーを、同じインベントリの状態へそろえる。
function refreshInventory() {
  const slots = inventory.slots;
  for (const container of [$('hotbar'), $('inventory-hotbar')]) {
    [...container.children].forEach((button, index) => {
      const type = slots[index];
      const label = formatKey(bindings.get(`slot${index + 1}`));
      button.dataset.type = type;
      button.classList.toggle('selected', index === inventory.selected);
      button.setAttribute('aria-pressed', String(index === inventory.selected));
      button.setAttribute('aria-label', `${index + 1}: ${NAMES[type]}`);
      button.title = `${label} · ${NAMES[type]}`;
      button.querySelector('span').textContent = label;
      button.querySelector('img').src = icons.get(type);
    });
  }
  [...$('inventory-grid').children].forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.type === inventory.selectedType));
  });
  $('selected-name').textContent = NAMES[inventory.selectedType];
}
function selectBlock(index) {
  inventory.select(index);
  refreshInventory();
}

// 初回だけ選択ボタンを組み立てる。画像は生成済みのアイコンを使い回す。
function buildInventoryUI() {
  for (const type of BLOCK_TYPES) icons.set(type, view.blockIcon(type));
  for (const container of [$('hotbar'), $('inventory-hotbar')]) {
    inventory.slots.forEach((_, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = container.id === 'hotbar' ? 'slot' : 'inventory-slot';
      button.dataset.slot = index;
      const number = document.createElement('span');
      const image = document.createElement('img');
      image.alt = '';
      button.append(number, image);
      button.addEventListener('click', () => selectBlock(index));
      container.append(button);
    });
  }
  for (const type of BLOCK_TYPES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inventory-item';
    button.dataset.type = type;
    const image = document.createElement('img');
    image.src = icons.get(type);
    image.alt = '';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = NAMES[type];
    const amount = document.createElement('small');
    amount.textContent = '∞ 無制限';
    button.append(image, name, amount);
    // 選択中のスロットへ素材を登録する。画面は閉じず、続けて並べ替えられる。
    button.addEventListener('click', () => {
      inventory.assign(type);
      refreshInventory();
      $('inventory-note').textContent = `${inventory.selected + 1}番のスロットに「${NAMES[type]}」を入れました。`;
    });
    $('inventory-grid').append(button);
  }
  refreshInventory();
}

// 画面状態の切替を一か所に集める。表示中のメニューだけを操作できるようにする。
function showMode(next) {
  mode = next;
  keys.clear();
  keybindPanel.cancel();
  $('menu').hidden = next === 'playing' || next === 'inventory';
  $('inventory-menu').hidden = next !== 'inventory';
  document.body.classList.toggle('playing', next === 'playing');
  $('target-label').hidden = true;
  if (next === 'pause') {
    $('menu').classList.add('is-paused');
    $('menu-title').textContent = 'ひと休み。';
    $('menu-description').textContent = 'マウス感度と操作キーを、自分に合う設定に。';
    $('settings-tabs').hidden = false;
    showSettingsTab('mouse');
    $('play-label').textContent = '草原にもどる';
    $('menu-note').textContent = 'クリックで再開 · 変更したブロックはそのままです';
    $('mouse-sensitivity').focus({ preventScroll: true });
  } else if (next === 'inventory') {
    refreshInventory();
    $('inventory-grid').firstElementChild?.focus({ preventScroll: true });
  }
}

// 操作画面のボタンかキー操作から、実際のマウス捕捉をリクエストする。
async function start() {
  if (!ready) return;
  keybindPanel.cancel();
  if (!canvas.requestPointerLock) { notify('マウスを使えるPC版のブラウザで開いてください'); return; }
  try { await canvas.requestPointerLock(); }
  catch { notify('マウス操作を開始できませんでした。もう一度再開してください'); }
}

// 捕捉を解放した結果で画面を開く。Tab と Esc のどちらかを事前に記録する。
function unlockTo(next) {
  nextUnlockMode = next;
  keys.clear();
  if (locked) document.exitPointerLock();
  else { nextUnlockMode = 'pause'; showMode(next); }
}
$('play-button').addEventListener('click', start);
$('inventory-resume').addEventListener('click', start);
$('inventory-close').addEventListener('click', start);
$('help-button').addEventListener('click', () => {
  if (ready && mode !== 'start') unlockTo('pause');
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  const next = locked ? 'playing' : nextUnlockMode;
  nextUnlockMode = 'pause';
  showMode(next);
});
document.addEventListener('pointerlockerror', () => notify('マウスの捕捉が許可されていません。PCのブラウザで直接開いてください'));

// 目の位置から視線を計算し、6ブロック以内で最初に当たる面を選ぶ。
function refreshTarget() {
  direction.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  target = raycastVoxel(world, { x: player.position.x, y: player.position.y + EYE_HEIGHT, z: player.position.z }, direction, 6);
  $('target-label').hidden = !locked || !target;
  if (target) $('target-label').textContent = `${NAMES[target.type]} · ${target.distance.toFixed(1)} m`;
}

// 左で破壊、右で設置。素材は固定の一覧ではなく、現在のホットバーから読む。
function editBlock(button) {
  refreshTarget();
  if (!target) { notify('ブロックに近づいて、照準を合わせてください'); return; }
  let changed = false;
  if (button === 0) changed = world.remove(target.x, target.y, target.z);
  if (button === 2) {
    const { normal } = target;
    const x = target.x + normal.x, y = target.y + normal.y, z = target.z + normal.z;
    if (player.intersectsBlock(x, y, z)) { notify('自分と重なる場所には置けません'); return; }
    changed = world.set(x, y, z, inventory.selectedType);
    if (!changed) notify('ここにはブロックを置けません');
  }
  if (changed) { view.rebuild(world); refreshTarget(); }
}

// メニュー中のマウス移動は視点へ反映しない。上下角は裏返らない範囲に制限する。
document.addEventListener('mousemove', event => {
  if (!locked || mode !== 'playing') return;
  const speed = .002 * sensitivity.value / 100;
  yaw -= event.movementX * speed;
  pitch = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, pitch - event.movementY * speed));
});

document.addEventListener('keydown', event => {
  // キー設定の入力待ちが最優先。Esc もこの間だけは変更の取消に使う。
  if (keybindPanel.handleKeydown(event)) return;
  if (event.code === 'Escape') {
    if (mode === 'playing' || mode === 'inventory') unlockTo('pause');
    return;
  }
  // インベントリのキーは変更後の設定を読む。長押しで開閉が繰り返されないようにする。
  if (event.code === bindings.get('inventory') && (mode === 'playing' || mode === 'inventory')) {
    event.preventDefault();
    if (event.repeat) return;
    if (mode === 'playing') unlockTo('inventory');
    else start();
    return;
  }
  if (!locked || mode !== 'playing') return;
  if (Object.values(bindings.bindings).includes(event.code)) event.preventDefault();
  keys.add(event.code);
  // 単発の操作は繰り返し入力を無視し、移動の押下状態だけは維持する。
  if (event.repeat) return;
  for (let index = 0; index < inventory.slots.length; index++) {
    if (event.code === bindings.get(`slot${index + 1}`)) selectBlock(index);
  }
  if (event.code === bindings.get('respawn')) { player.reset(); notify('はじまりの場所にもどりました'); }
});
document.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => {
  keys.clear();
  if (locked) unlockTo('pause');
});
// 非表示時間をFPSに混ぜず、復帰後に瞬間移動することも防ぐ。
document.addEventListener('visibilitychange', () => {
  keys.clear(); previousTime = performance.now(); fpsCounter.reset(); $('fps-value').textContent = '-- FPS';
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('mousedown', event => {
  if (locked && mode === 'playing' && (event.button === 0 || event.button === 2)) {
    event.preventDefault(); editBlock(event.button);
  }
});
window.addEventListener('wheel', event => {
  if (!locked || mode !== 'playing' || !event.deltaY) return;
  event.preventDefault(); selectBlock(inventory.selected + Math.sign(event.deltaY));
}, { passive: false });
window.addEventListener('resize', () => view?.resize());

// 実際の描画時刻でFPSを測り、物理計算には上限付きの経過時間を渡す。
function frame(time) {
  const sampledFps = fpsCounter.update(time);
  if (sampledFps !== null) $('fps-value').textContent = `${sampledFps} FPS`;
  const dt = Math.min((time - previousTime) / 1000 || 0, .05);
  previousTime = time;
  if (locked && mode === 'playing') {
    const pressed = action => bindings.isPressed(action, keys);
    player.step(dt, {
      forward: Number(pressed('forward')) - Number(pressed('backward')),
      right: Number(pressed('right')) - Number(pressed('left')),
      jump: pressed('jump'), sprint: pressed('sprint'),
    }, yaw);
    refreshTarget();
  }
  const p = player.position;
  $('coordinates').textContent = `X ${p.x.toFixed(1)} · Y ${p.y.toFixed(1)} · Z ${p.z.toFixed(1)}`;
  view.render(p, yaw, pitch, locked && mode === 'playing' ? target : null);
  requestAnimationFrame(frame);
}

// 地形と描画を準備し、初めてボタンとゲームループを有効にする。
try {
  view = new WorldView(canvas);
  world = createWorld({ trees: true });
  player = new PlayerPhysics(world);
  view.rebuild(world);
  buildInventoryUI();
  ready = true;
  refreshBindingHints();
  $('play-button').disabled = false;
  $('play-label').textContent = '世界に入る';
  requestAnimationFrame(frame);
} catch (error) {
  console.error(error);
  $('fatal-message').textContent = 'WebGLを使えるPCのブラウザで開いてください。ハードウェアアクセラレーション設定も確認してください。';
  $('fatal-error').hidden = false;
}

// テスト時だけ、入力で変化した状態を読み取れるようにする。書き換え用のAPIは公開しない。
if (new URLSearchParams(location.search).has('test')) {
  window.__FIELDCRAFT_TEST__ = () => ({
    ready, locked, mode, position: player ? { ...player.position } : null,
    grounded: player?.grounded ?? false, yaw, pitch, sensitivity: sensitivity.value,
    bindings: bindings.bindings, fps: fpsCounter.fps, selected: inventory.selected,
    inventorySlots: inventory.slots, selectedType: inventory.selectedType,
    target: target ? { ...target, normal: { ...target.normal } } : null,
    blockCount: world?.blocks.size ?? 0,
    renderCalls: view?.renderer.info.render.calls ?? 0,
    triangles: view?.renderer.info.render.triangles ?? 0,
  });
}
