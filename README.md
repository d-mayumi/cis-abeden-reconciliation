# CIS・あべでん料金突合システム

CIS料金突合用ファイルと、あべでん料金計算ファイルをブラウザ内で突合する専用Webアプリです。

## 開発

```bash
npm install --include=dev
npm run dev
```

ローカルURL:

- http://localhost:3000
- 同一LAN: `npm run dev` の Network URL

## 検証

```bash
npm run test
npm run lint
npm run build
```

## 入力

- CIS: CSV(CP932/UTF-8) または xlsx、1〜4ファイル
- あべでん: xlsx、「事業者契約時」シート

## OCRのGoogleスプレッドシート出力

OCRモードでは、アップロードされた資料の内容から、CIS①・CIS②・あべでんのどれかを自動で判定します。画面右上の切り替えは、保存済みの結果を見るタブを選ぶためのもので、書き込み先の指定には使いません。

書き込み前に対象タブの実際の見出しを確認し、見出し名に合う列だけに値を追加します。タブごとに列の並びが違っても、見出しを基準に書き込みます。資料の種類を判断できない場合や、必要な見出しが足りない場合は、何も書き込まずに停止します。

保存先は次の3タブです。

- CIS①: `1YC2ATCjiusNBoQ30XEj-bc6BYBsIhcbUtzI1arbSS20` / gid `1215098227`
- CIS②: `1YC2ATCjiusNBoQ30XEj-bc6BYBsIhcbUtzI1arbSS20` / gid `2079880305`
- あべでん: `1YC2ATCjiusNBoQ30XEj-bc6BYBsIhcbUtzI1arbSS20` / gid `1678193460`

Vercelには `OPENAI_API_KEY`、`GOOGLE_SERVICE_ACCOUNT_EMAIL`、`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` を設定し、上記1つのスプレッドシート（3タブ）をサービスアカウントへ編集者として共有してください。


## デプロイ

ViteアプリとしてVercelへデプロイできます。デプロイ先は `d-mayumi` 想定です。

- Build command: `npm run build`
- Output directory: `dist`
