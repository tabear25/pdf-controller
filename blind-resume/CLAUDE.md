# CLAUDE.md（blind-resume）

このディレクトリは、ブラウザで完結する PDF 黒塗りツール（ブラインドレジュメ作成ツール）です。リポジトリのルートにある Tkinter アプリとは別のプロジェクトで、ルートの CLAUDE.md の規約（出力ファイルを入力の隣に書く、など）は適用しません。

## 基準となる文書

- `docs/requirements.md`：依頼文（判断の基準）
- `docs/plan.md`、`docs/decisions.md`：計画と決定事項
- `docs/design.md`、`docs/security.md`：設計と安全性の判断

## 作業のルール

- コードにインラインコメントを書かない。設計の判断や注意点は README と docs/ に書く。
- 画面の文言は日本語。PDF から取り出した文字列は textContent で出し、HTML の文字列を組み立てない（`src/ui/dom.ts` の `h()` を使う）。
- localStorage などの保存系の API、外部への通信、アクセス解析を入れない。
- 第 2 章の前提（ブラウザ内で完結、画像化による書き出し、入力 PDF を信頼しない、最終判断は人）を変える場合は、実装を止めて利用者に相談する。
- 依存は完全に固定する。追加するときは `npx npm@11 install --save-exact`（npm 10 の `npm install` は依存解決に失敗する）。ビルド用のツールは公開から 2 週間以上たった版を選ぶ。
- リポジトリに入れてよい PDF は `tests/fixtures/pdf/` のダミーだけ。

## コマンド

```bash
npm ci
npm run build        # 型検査、1 ファイルのビルド、ビルド後の検査（dist/ と vercel.json を更新）
npm test             # 単体テスト（Vitest）
npm run test:e2e     # E2E テスト（Playwright。file:// と静的サーバーの両方）
python3 tests/fixtures/generate.py   # ダミー PDF の再生成（tests/requirements.txt が必要）
```

`dist/` と `vercel.json` はコミットする成果物です。ソースを変えたら `npm run build` をして、一緒にコミットします。
