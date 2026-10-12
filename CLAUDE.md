# Repository rules for Claude

このリポジトリで作業するエージェント向けの決まりです。

## このリポジトリについて

- 公開リポジトリ。`public/` の中身が、そのまま Cloudflare Pages（pages.dev）で配信される
- ビルドは無い。`public/index.html`・`app.js`・`style.css` を直接直す
- 発表の資料（PDF など）、メンバーの名前、費用などの内輪の情報を入れない（`.gitignore` で PDF を除外している）

## Git push policy

- `main` へ直接 push しない。作業ブランチを push して、PR で `main` に入れる
- push・PR・デプロイは、毎回ユーザーの許可を得てから行う
- `git push --force` / `--force-with-lease` / `--all`、`origin` 以外への push は、明示の指示が無い限り使わない
- commit の author email は GitHub の noreply 形式だけを使う

## デプロイ

```bash
npx wrangler pages deploy public --project-name=shooter-presenter --branch=main --commit-message="$(git rev-parse --short HEAD)" --commit-hash="$(git rev-parse HEAD)"
```

`--commit-message` を省くと、日本語のコミットメッセージが原因で失敗する。

## 変えるときの注意

- `index.html` の CSP（`<meta http-equiv>`）と `public/_headers` の CSP は同じ内容にそろえる
- CSP で外部の読みこみとインラインのスクリプト・スタイルを止めている。CSS は `style.css`、JS は `app.js` に書く
- `pdfjsLib.getDocument` の `isEvalSupported: false` を外さない（PDF.js 3.x の既知の弱点への対策）
- 動作確認は `?sim=1`（シューターの代わりに `simLine('S 5 -3')` などで行を流せる）
