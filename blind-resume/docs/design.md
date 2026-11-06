# 設計メモ

コードにはインラインコメントを書かない方針なので、設計の判断と注意点をここにまとめます。安全性に関わる判断は [security.md](security.md) にあります。

## 全体の構成

- `src/pdf/`：PDF.js の設定と、文書の開閉（Worker、同梱データ、描画設定）
- `src/ui/`：画面（DOM は `ui/dom.ts` の `h()` だけで組み立てる）
- `src/core/`：DOM に依存しない処理（座標、正規化、検索など。M2 以降）
- `src/export/`：画像化、黒塗り、組み立て、自動検査（M3 以降）
- `src/config/`：文言、チェックリスト、上限値などの設定
- `scripts/`：ビルドの補助（仮想モジュール、ビルド後の検査、静的サーバー）

## PDF.js の設定（`src/pdf/settings.ts`）

| 設定 | 値 | 理由 |
|---|---|---|
| Worker | PDF.js の `pdf.worker.min.mjs` を classic 形式に変換し、blob: から起動する | file:// では blob: から module 形式の Worker を起動できない（Chromium で確認）。変換は `export` 1 か所の削除と `import.meta.url` 2 か所の置換だけで、ビルド時に構文を検査する |
| `useWorkerFetch` | `false` | Worker に通信させない。cMap などは、メイン側の `BundledDataFactory` がメモリから渡す |
| `BinaryDataFactory` | `BundledDataFactory` | cMap、標準フォント、WASM を、ビルド時に埋め込んだ base64 から返す |
| `cMapUrl` / `wasmUrl` | `bundled:cmaps/` / `bundled:wasm/` | 実際には読みに行かない識別用の文字列。PDF.js が末尾の `/` を要求する |
| `standardFontDataUrl` | 指定しない | 指定すると、PDF.js が代わりのフォントの指定に `url()` を混ぜ、CSP の違反が出る。指定しなくても、Symbol と ZapfDingbats は `BundledDataFactory` から渡る |
| `useSystemFonts` | `true` | 埋め込みのない欧文の標準フォント（Helvetica など）は、PC のフォント（Windows なら Arial など）で描く |
| `useWasm` | `true` | CCITT・JBIG2・JPEG 2000 の復号に要る（CSP に `'wasm-unsafe-eval'` が必要） |
| `enableXfa` | `false` | XFA フォームを HTML として描かない |
| `disableWorkerRendering` | `true` | 描画はメインスレッドの canvas で行う（書き出しで画素を扱うため） |

同梱する標準フォントは、Symbol と ZapfDingbats 用の Foxit フォント（BSD 系）だけです。PDF.js が同梱する Liberation Sans は GPLv2（フォント例外つき）で、依頼の「許容的なライセンスのものに限る」に合わないため、入れていません。`useSystemFonts: true` の設定では、ほかの標準フォントは PC のフォントで描かれるので、Liberation と Foxit の残りは使われません。

ICC プロファイル（qcms）と JavaScript の実行環境（QuickJS）は入れていません。ICC を使わない場合、PDF.js は代わりの色空間で描きます。

## 描画の設定（画面と書き出しで共通）

`RENDER_SETTINGS` を 1 か所で定義し、画面の描画と書き出しの両方で使います。

- `intent: "display"`
- `annotationMode: AnnotationMode.ENABLE`：注釈とフォームの見た目を canvas に描く。コメントの本文のように画面に描かれないものは、書き出しにも出ない
- `background: rgb(255,255,255)`：書き出しの画像が透明にならないようにする

注釈とテキストの層は DOM として作りません。PDF の中のリンクも、画面には作りません。

## 座標の扱い（M2）

- 塗る範囲は、ページごとに「表示の向きで、倍率 1 のときのポイント」で持つ（原点は表示の左上）。これは PDF.js の `getViewport({ scale: 1 })` の座標系と同じで、回転（/Rotate）、CropBox のずれ、UserUnit を反映した後の座標である。
- 画面の CSS ピクセルへは「1 ポイントあたりの CSS ピクセル」を掛けるだけ、書き出しの画素へは「dpi ÷ 72」を掛けるだけで変換できる。倍率を変えても、保存した座標は変わらない。
- PDF の座標（文字の位置など）から表示の座標への変換は、`src/core/geometry.ts` の `displayTransform()` で行う。開いたページごとに PDF.js の viewport の変換行列と照合し（`PageModel.transformVerified`）、一致しないページでは文字の候補を出さない。
- 書き出しで塗る画素は、`toPixelBox()` で外側の画素の境界まで広げる（左上は切り捨て、右下は切り上げ）。

単体テスト（`tests/unit/geometry.test.ts`）では、`displayTransform()` を次の 2 つと突き合わせている。

1. テスト側に別に書いた変換式（`tests/e2e/geometry.ts`。回転 0・90・180・270 と、負の値も含む CropBox のずれ）
2. ダミー PDF（回転、CropBox、原点が負のページ）を実際に PDF.js で開いたときの viewport

## 範囲の編集（M2）

- 状態は `src/core/editor.ts` の `EditorStore` が持ち、操作の履歴（元に戻す・やり直す）は `History` で管理する。ドラッグ中の位置は履歴に積まず、離したときに 1 回分として積む。
- 「全ページの同じ位置に適用」は、表示の向きでの幅と高さが 0.5pt 以内で一致するページにだけ写す。向きや大きさが違うページは除外し、ページ番号を表示する。同じ範囲がすでにあるページには重ねない。適用は 1 回の操作として元に戻せる。
- 操作：ドラッグで作成、範囲の中をドラッグで移動、角と辺のつまみで大きさの変更、Delete・Backspace で削除、矢印キーで 1pt（Shift で 10pt）移動、Esc で選択の解除とドラッグの取り消し、Ctrl+Z・⌘Z で元に戻す、Ctrl+Y・Ctrl+Shift+Z・⌘⇧Z でやり直す。

## ページの表示（`src/ui/viewer.ts`）

- 各ページの大きさは、`getViewport({ scale: 1 })` の幅と高さ（回転と CropBox を反映した、表示の向きでのポイント）を基準にする。
- 画面での倍率は「1 ポイントあたりの CSS ピクセル」で持つ。canvas は、その倍率に `devicePixelRatio` を掛けて描く。1 ページの canvas が 1,677 万画素を超える場合は、解像度を下げる。
- 見えている付近（上下 1,200px）のページだけを描き、離れたページの canvas は解放する。

## 文書の開閉（`src/pdf/document.ts`）

- 文書ごとに Worker を新しく作り、閉じるときに `loadingTask.destroy()` のあとで Worker を終了する（6.x の `PDFDocumentProxy` には `destroy()` がない）。
- 読み込んだバイト列は Worker に移されるので、メイン側に元の PDF のコピーは残らない。
- パスワードは、入力欄の値を PDF.js に渡したらすぐ消す。保存しない。

## ビルド（`scripts/`）

- `build-plugin.mjs`：仮想モジュールを提供する。
  - `virtual:pdfjs-worker-source`：classic 形式に変換した Worker のソース
  - `virtual:pdfjs-data`：cMap（全 168 種）、標準フォント（2 種）、WASM（2 種）の base64
  - `virtual:licenses`：第三者ライセンスの本文
  - `virtual:build-info`：版の表示用
  - あわせて、実際に同梱されたパッケージとライセンス一覧の対応を検査し、ずれていればビルドを止める。
- `postbuild.mjs`：`dist/index.html` を検査して仕上げる。
  - インラインのスクリプトが 1 個、style が 1 個以下であること、`link` 要素・`src`/`href` 属性・インラインのイベント属性・`style` 属性がないこと
  - innerHTML、eval、new Function、保存系の API などが成果物にないこと
  - URL の文字列が許可リストの中だけであること（名前空間やライセンス条文など、通信しないもの）
  - スクリプトと style の SHA-256 を計算して CSP の meta タグに入れ、同じ CSP（と `frame-ancestors`）を `vercel.json` のヘッダーにも書く
  - `dist/THIRD_PARTY_LICENSES.txt` と `dist/index.html.sha256` を書き出す

ビルドの結果は決定的です（日時などを埋め込まない）。CI では、コミットされた `dist/` と `vercel.json` がビルド結果と一致するかを確かめます。

## PDF.js を更新するとき

1. `package.json` の `pdfjs-dist` を新しい版に固定し、`npm install` する（npm 10 の `npm install` には依存解決の不具合があるため、`npx npm@11 install` を使う。`npm ci` は npm 10 でも動く）。
2. `npm run build` が通るか確かめる。Worker の変換が想定どおりでない場合（`export` の形や `import.meta.url` の数が変わった場合）は、ビルドが止まる。変換の内容を確認してから、`scripts/build-plugin.mjs` の想定を直す。
3. `npm test` と `npm run test:e2e` を通す。特に、スキャン PDF（CCITT、JPEG 2000）とフォント非埋め込みの PDF を確かめる。
4. URL の許可リストに新しい文字列が出た場合は、通信に使われないことを確認してから足す。

## ダミー PDF（`tests/fixtures/`）

- `generate.py` で作る（reportlab、pypdf、pikepdf、Pillow、img2pdf）。必要な Python パッケージは `tests/requirements.txt`、日本語フォントは IPA ゴシック（`FIXTURE_FONT` で変更可）。
- 生成物は `tests/fixtures/pdf/` にコミットし、テストはそれを使う。09（パスワード付き）以外は、生成し直しても同じバイト列になる。
- `manifest.json` に、各ページの MediaBox、CropBox、回転、氏名などの位置（PDF の座標）を記録する。E2E テストは、この位置をテスト側の独立した計算で画面の座標に直し、アプリの描画と照合する。
