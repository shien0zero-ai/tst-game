/**
 * ゲーム全体の入口。
 * HTML の画面、キーボード・マウス入力、地形、物理演算、3D 描画をつなぐ。
 * 地形そのものの管理は world.js、当たり判定は physics.js に任せる。
 */

// 見た目の CSS を読み込む。Vite が開発時の反映や配布用への取り込みを行う。
import './style.css';
import './settings.css';
// Three.js のベクトル計算と、自作の地形・プレイヤー・描画・設定機能を読み込む。
import * as THREE from 'three';
import { createWorld, raycastVoxel, BLOCK_TYPES } from './world.js';
import { PlayerPhysics, EYE_HEIGHT } from './physics.js';
import { WorldView } from './render.js';
import { createSensitivitySettings } from './settings.js';

// 内部で使う英語のブロック名を、画面に表示する日本語へ変換する。
const NAMES = { grass: '草ブロック', dirt: '土', stone: '石', wood: '原木', leaves: '葉', sand: '砂' };
// HTML の id から要素を探す処理を短く書くための関数。
const $ = (id) => document.getElementById(id);
const canvas = $('world');
// 押しているキーを記憶する。複数キーを同時に押す斜め移動にも対応できる。
const keys = new Set();
// 前回の感度をブラウザから読み込む。保存不可の場合も標準値で起動できる。
const sensitivity = createSensitivitySettings();
// 初期化後に使う描画担当・地形データ・プレイヤーを保持する。
let view, world, player;
// ready は起動完了、locked はマウス捕捉中、selected は選択ブロックの番号。
// target は照準が指しているブロックで、何も指していなければ null になる。
let ready = false, locked = false, selected = 0, target = null;
// yaw は左右、pitch は上下の視点角度。単位はラジアン。
let yaw = -.24, pitch = -.12;
// 前の描画時刻と、お知らせを消すタイマーの識別子を覚える。
let previousTime = 0, toastTimer;
// 視線の向きを表すベクトルは使い回し、毎フレームの作り直しを避ける。
const direction = new THREE.Vector3();

// 設定の数値をスライダー・表示・読み上げ用の情報へ反映する。
function updateSensitivityControls(result) {
  const value = sensitivity.value;
  const slider = $('mouse-sensitivity');
  slider.value = value;
  slider.setAttribute('aria-valuetext', `${value}%`);
  // 感度の最小〜最大を 0〜100% に換算し、スライダーの塗り分けに使う。
  slider.style.setProperty('--range-progress', `${(value - Number(slider.min)) / (Number(slider.max) - Number(slider.min)) * 100}%`);
  $('sensitivity-value').textContent = `${value}%`;
  // 実際に変更したときは、保存できたかも伝える。起動直後は既存の案内を残す。
  if (result) {
    $('sensitivity-note').textContent = result.saved
      ? 'このブラウザに保存しました · 次回起動時も使えます'
      : '今回の操作には反映済みです · ブラウザへの保存はできませんでした';
  }
}

// ドラッグや矢印キーで感度を変えたら、設定を保存して画面を更新する。
$('mouse-sensitivity').addEventListener('input', (event) => {
  updateSensitivityControls(sensitivity.set(event.target.value));
});
// 「標準に戻す」は感度を 100% に戻し、その値を保存する。
$('sensitivity-reset').addEventListener('click', () => {
  updateSensitivityControls(sensitivity.reset());
});
// 起動時に、読み込んだ感度を非表示の設定画面にも反映しておく。
updateSensitivityControls();

// 画面下に短いお知らせを出す。続けて呼ばれたら前の消去タイマーを取り消す。
function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  // 2.4 秒経過したら、お知らせを隠す。
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2400);
}

// 選択中のブロックと、画面下のパレットの強調表示を切り替える。
function selectBlock(index) {
  // 端を越えた番号は反対側へ戻すため、ホイールで何周でも切り替えられる。
  selected = (index + BLOCK_TYPES.length) % BLOCK_TYPES.length;
  document.querySelectorAll('.slot').forEach((button, i) => {
    button.classList.toggle('selected', i === selected);
    // 見た目だけでなく、スクリーンリーダーにも選択状態を伝える。
    button.setAttribute('aria-pressed', String(i === selected));
  });
  $('selected-name').textContent = NAMES[BLOCK_TYPES[selected]];
}

// カメラの視線を使い、手の届く範囲で最初に当たるブロックを調べる。
function refreshTarget() {
  // 左右角と上下角から、長さ 1 の視線ベクトルを作る。
  direction.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  // プレイヤー座標は足元なので、目の高さを足す。操作できる距離は 6 ブロック。
  target = raycastVoxel(world, { x: player.position.x, y: player.position.y + EYE_HEIGHT, z: player.position.z }, direction, 6);
  $('target-label').hidden = !locked || !target;
  if (target) $('target-label').textContent = `${NAMES[target.type]} · ${target.distance.toFixed(1)} m`;
}

// 左クリックで破壊、右クリックで隣のマスへ設置する。
function editBlock(button) {
  // 前フレームの照準ではなく、クリックした瞬間の視線で対象を取り直す。
  refreshTarget();
  if (!target) { notify('ブロックに近づいて、照準を合わせてください'); return; }
  let changed = false;
  // マウスの button 番号は、左が 0、右が 2。
  if (button === 0) changed = world.remove(target.x, target.y, target.z);
  if (button === 2) {
    // normal は指した面の外向き方向。これを足すと、その面の隣のマスになる。
    const { normal } = target;
    const x = target.x + normal.x, y = target.y + normal.y, z = target.z + normal.z;
    // プレイヤーがブロックに埋まってしまう設置は拒否する。
    if (player.intersectsBlock(x, y, z)) { notify('自分と重なる場所には置けません'); return; }
    changed = world.set(x, y, z, BLOCK_TYPES[selected]);
    if (!changed) notify('ここにはブロックを置けません');
  }
  // 地形が変わった場合だけ 3D メッシュを作り直し、照準も更新する。
  if (changed) {
    view.rebuild(world);
    refreshTarget();
  }
}

// 開始・再開ボタンから呼び、マウスをゲーム画面に捕捉する。
async function start() {
  if (!ready) return;
  // Pointer Lock API がない環境では操作できるブラウザを案内する。
  if (!canvas.requestPointerLock) {
    $('menu-note').textContent = 'マウスを使えるPC版の Chrome / Edge / Firefox で開いてください。';
    return;
  }
  // 捕捉はブラウザ側に許可される必要があるため、拒否される場合にも対応する。
  try {
    await canvas.requestPointerLock();
  } catch {
    $('menu-note').textContent = 'マウス操作を開始できませんでした。もう一度ボタンを押してください。';
  }
}

// HTML の開始ボタンとヘルプボタンを、それぞれの動作へ結び付ける。
$('play-button').addEventListener('click', start);
$('help-button').addEventListener('click', () => {
  if (locked) document.exitPointerLock();
  else $('menu').hidden = false;
});
// Esc や再開ボタンで捕捉状態が変わるたび、プレイ画面と停止画面を切り替える。
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  // 停止前に押していたキーが、再開後も押しっぱなしにならないようにする。
  keys.clear();
  $('menu').hidden = locked;
  document.body.classList.toggle('playing', locked);
  // 初回の紹介画面は、プレイ開始後に停止したら感度設定付きの画面へ変える。
  if (!locked) {
    $('menu').classList.add('is-paused');
    $('menu-title').textContent = 'ひと休み。';
    $('menu-description').textContent = '自分に合うマウス感度で、世界を歩こう。';
    $('sensitivity-settings').hidden = false;
    $('play-label').textContent = '草原にもどる';
    $('menu-note').textContent = 'クリックで再開 · 変更したブロックはそのままです';
    $('target-label').hidden = true;
    // キーボードだけでも、すぐに矢印キーで感度を変えられるようにする。
    $('mouse-sensitivity').focus({ preventScroll: true });
  }
});
// マウスの捕捉が拒否された場合、画面内の案内を更新する。
document.addEventListener('pointerlockerror', () => {
  $('menu-note').textContent = 'マウスの捕捉が許可されていません。PCのブラウザで直接開いてください。';
});
// 捕捉中のマウス移動量を、視点角度の変化に換算する。
document.addEventListener('mousemove', (event) => {
  if (!locked) return;
  // 100% なら元の速度。50% は半分、200% は 2 倍になる。
  const lookSpeed = .002 * sensitivity.value / 100;
  yaw -= event.movementX * lookSpeed;
  // 上下の向きは真上・真下の手前までに制限し、視点の裏返りを防ぐ。
  pitch = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, pitch - event.movementY * lookSpeed));
});
// キーを押したとき、移動状態を記録し、単発の操作も処理する。
document.addEventListener('keydown', (event) => {
  if (!locked) return;
  // Esc はマウスを解放する。停止画面の表示は pointerlockchange に任せる。
  if (event.code === 'Escape') {
    document.exitPointerLock();
    return;
  }
  // Space や矢印キーで、ブラウザのページがスクロールするのを防ぐ。
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  // 数字キーはパレットの切り替え、R は安全な開始地点への復帰。
  if (/^Digit[1-6]$/.test(event.code)) selectBlock(Number(event.code.slice(-1)) - 1);
  if (event.code === 'KeyR' && !event.repeat) { player.reset(); notify('はじまりの場所にもどりました'); }
});
// キーを離したら記録から消す。タブを離れた場合も押下状態を解除する。
document.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => {
  keys.clear();
  if (locked) document.exitPointerLock();
});
// タブ復帰直後に、大きな経過時間で急に移動してしまわないよう時刻を取り直す。
document.addEventListener('visibilitychange', () => { keys.clear(); previousTime = performance.now(); });
// 右クリックを設置に使うため、ゲーム画面ではブラウザのメニューを出さない。
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
// プレイ中の左・右クリックだけをブロック編集として扱う。
canvas.addEventListener('mousedown', (event) => {
  if (locked && (event.button === 0 || event.button === 2)) {
    event.preventDefault();
    editBlock(event.button);
  }
});
// ホイールの回転方向に応じて、選択ブロックを一つずつ送る。
window.addEventListener('wheel', (event) => {
  if (!locked || !event.deltaY) return;
  event.preventDefault();
  selectBlock(selected + Math.sign(event.deltaY));
// passive: false にすると、上の preventDefault でページのスクロールを止められる。
}, { passive: false });
// ウィンドウの大きさが変わったら、描画サイズとカメラの縦横比を合わせる。
window.addEventListener('resize', () => view?.resize());

// ブラウザの描画タイミングごとに呼ばれる、ゲームの繰り返し処理。
function frame(time) {
  // ミリ秒を秒に換算する。重いフレームでも一度に進める時間は最大 0.05 秒。
  const dt = Math.min((time - previousTime) / 1000 || 0, .05);
  previousTime = time;
  // マウスが捕捉されていない間は、移動や重力の更新を止める。
  if (locked) {
    // 前後・左右は -1〜1 にまとめ、物理演算側へ渡す。
    const input = {
      forward: Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')),
      right: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')),
      jump: keys.has('Space'),
      sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    };
    // 移動・重力・当たり判定を進めたあと、新しい位置から照準を調べる。
    player.step(dt, input, yaw);
    refreshTarget();
  }
  // 画面の座標表示と 3D 描画は、停止中も更新できるようにしておく。
  const p = player.position;
  $('coordinates').textContent = `X ${p.x.toFixed(1)} · Y ${p.y.toFixed(1)} · Z ${p.z.toFixed(1)}`;
  view.render(p, yaw, pitch, locked ? target : null);
  // 次の描画タイミングにも同じ関数を呼んでもらい、ループを続ける。
  requestAnimationFrame(frame);
}

// 初期化は一か所で行い、WebGL の作成などに失敗したら案内画面へ切り替える。
try {
  view = new WorldView(canvas);
  world = createWorld({ trees: true });
  player = new PlayerPhysics(world);
  view.rebuild(world);
  // ブロックの種類ごとに、番号・アイコン付きの選択ボタンを作る。
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
  // 最初は草ブロックを選び、準備完了後に開始ボタンを有効化する。
  selectBlock(0);
  ready = true;
  $('play-button').disabled = false;
  $('play-label').textContent = '世界に入る';
  requestAnimationFrame(frame);
} catch (error) {
  // 詳細は開発者コンソールへ、利用者には画面内で起動方法を案内する。
  console.error(error);
  $('fatal-message').textContent = 'WebGL を使えるPCのブラウザで開いてください。ブラウザのハードウェアアクセラレーション設定も確認してください。';
  $('fatal-error').hidden = false;
}

// URL に ?test=1 がある場合だけ、ブラウザテストが状態を読める関数を用意する。
// 地形の書き換え機能は公開せず、実際のキー・マウス操作で検証する。
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
