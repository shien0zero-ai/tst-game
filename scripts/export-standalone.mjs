// 配布用ビルドの JavaScript・CSS・アイコンを、一つの HTML にまとめるスクリプトです。
// `npm run export` からビルド後に呼ばれ、遊ぶ人がサーバーを起動しなくても開ける版を作ります。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 実行したターミナルの場所ではなく、このスクリプトの場所を基準にファイルを探します。
// root はプロジェクトのフォルダー、dist は Vite が作った配布用ビルドのフォルダーです。
const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
let html = await readFile(new URL('index.html', dist), 'utf8');

// 外部 JavaScript を読む script タグを探し、中身を HTML に直接埋め込みます。
// これにより、配布ファイルから別ファイルや CDN を読み込む必要がなくなります。
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
// 想定と違うビルド形式では、欠けたゲームを出力する前にエラーで止めます。
if (scripts.length !== 1) throw new Error('Expected one built JavaScript entry point');
for (const [tag, path] of scripts) {
  // HTML 内の /assets/... を、dist 内の実際のファイルとして読みます。
  const code = await readFile(new URL(path.replace(/^\//, ''), dist), 'utf8');
  // コード内の文字列が HTML の script 終了タグとして解釈されるのを防ぎます。
  const escaped = code.replace(/<\/script/gi, '<\\/script');
  // 置換内容は関数から返します。コード内の $& などが replace の特殊記号になりません。
  // type="module" を残すため、HTML 本文の読み込み後にゲームが初期化されます。
  html = html.replace(tag, () => `<script type="module">\n${escaped}\n</script>`);
}

// 外部 CSS を読む link タグも、中身を直接書いた style タグに置き換えます。
const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
if (styles.length === 0) throw new Error('Expected a built stylesheet');
for (const [tag, path] of styles) {
  const css = await readFile(new URL(path.replace(/^\//, ''), dist), 'utf8');
  html = html.replace(tag, () => `<style>\n${css}\n</style>`);
}

// タブのアイコンは Base64（バイナリを文字列にする形式）へ変換し、data URL として埋め込みます。
const favicon = await readFile(new URL('public/favicon.svg', root));
html = html.replace('href="/favicon.svg"', `href="data:image/svg+xml;base64,${favicon.toString('base64')}"`);
// ダウンロード版でロゴを押しても、PC の別フォルダーへ移動しないリンクにします。
html = html.replace('class="brand" href="./"', 'class="brand" href="#"');

// 配布用の出力先を用意して書き込み、保存場所とファイルサイズをターミナルに表示します。
// artifacts は生成物の置き場なので、元のソースコードとは別に Git の対象から外しています。
const output = new URL('artifacts/fieldcraft.html', root);
await mkdir(new URL('./', output), { recursive: true });
await writeFile(output, html);
console.log(`Standalone game: ${fileURLToPath(output)} (${Buffer.byteLength(html)} bytes)`);
