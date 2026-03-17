# FiveM メカニック経費申請システム

GitHub Pages × Cloudflare Workers × D1 × R2 によるサーバーレス構成の経費申請Webアプリ。

---

## ⚡ 爆速セットアップ (推奨)

環境構築（データベース作成、シークレット設定、デプロイ）を一挙に行うスクリプトを用意しました。

```powershell
# プロジェクトルートで実行
./setup.ps1
```

※ ブラウザ認証や GitHub ユーザー名の入力を求められます。

---

## 📁 ディレクトリ構成

```
fivem-mechanic-expense/
├── .github/workflows/deploy.yml   # GitHub Actions CI/CD
├── frontend/                      # GitHub Pages (静的ファイル)
│   ├── index.html                 # ログイン
│   ├── dashboard.html             # ダッシュボード
│   ├── submit.html                # 申請フォーム
│   ├── history.html               # 申請履歴
│   ├── approve.html               # 承認・支払い管理
│   ├── users.html                 # ユーザー管理
│   ├── css/style.css
│   └── js/api.js
└── worker/                        # Cloudflare Workers API
    ├── src/
    │   ├── index.js
    │   ├── routes/ (auth / expenses / users / categories / upload)
    │   └── utils/ (auth / response / discord)
    ├── migrations/0001_init.sql
    ├── wrangler.toml
    └── package.json
```

---

## 🚀 初回セットアップ手順

### 1. 前提条件
- [Node.js](https://nodejs.org/) 20以上
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/): `npm install -g wrangler`
- Cloudflare アカウント（Freeプランで利用可）

### 2. Cloudflare リソースの作成

```bash
# Wrangler にログイン
wrangler login

# D1 データベースの作成
wrangler d1 create mechanic-expense-db

# KV ネームスペースの作成（セッション管理用）
wrangler kv:namespace create SESSIONS

# R2 バケットの作成（レシート保管）
wrangler r2 bucket create mechanic-expense-receipts
```

出力された `database_id` と `KV namespace_id` を `worker/wrangler.toml` に貼り付けてください。

```toml
# wrangler.toml を編集
[[d1_databases]]
database_id = "ここにD1のIDを貼り付け"

[[kv_namespaces]]
id = "ここにKVのIDを貼り付け"
```

### 3. Cloudflare Secrets の設定

```bash
cd worker

# JWT 署名シークレット（ランダム文字列を設定）
echo "YOUR_RANDOM_SECRET_STRING" | wrangler secret put JWT_SECRET

# Discord Webhook URL (省略可)
echo "https://discord.com/api/webhooks/..." | wrangler secret put DISCORD_WEBHOOK_URL

# GitHub Pages の URL (CORS 用)
echo "https://YOUR_GITHUB_USERNAME.github.io/fivem-mechanic-expense" | wrangler secret put FRONTEND_ORIGIN
```

### 4. D1 マイグレーション実行（ローカル）

```bash
cd worker
npm install
wrangler d1 migrations apply mechanic-expense-db
```

### 5. フロントエンドの API URL 変更

`frontend/js/config.js` の以下を Workers のデプロイ URL に変更:

```js
window.API_BASE_URL = 'https://fivem-mechanic-expense-api.YOUR_SUBDOMAIN.workers.dev';
```

---

## 📦 GitHub へのデプロイ (CI/CD)

### 一度だけ: GitHub Secrets の設定

リポジトリの `Settings > Secrets and variables > Actions` に以下を追加:

| シークレット名 | 説明 |
|---|---|
| `CF_API_TOKEN` | Cloudflare API Token（Workers, D1, R2 の Edit 権限） |
| `CF_ACCOUNT_ID` | Cloudflare アカウントID |

### GitHub Pages の有効化

リポジトリの `Settings > Pages > Source` を
**GitHub Actions** に設定してください。

### デプロイ

```bash
git add .
git commit -m "初回デプロイ"
git push origin main
```

`main` ブランチへの Push で自動的に:
1. Workers + D1マイグレーション がデプロイ
2. GitHub Pages がデプロイ

---

## 🔧 ローカル開発

```bash
cd worker
npm install
wrangler dev  # http://localhost:8787 で起動

# フロントエンドはブラウザで直接 frontend/index.html を開いてください
# API_BASE_URL は 'http://localhost:8787' に変更してください
```

ローカル開発時は `frontend/js/config.js` を以下に設定してください。

```js
window.API_BASE_URL = 'http://localhost:8787';
```

---

## ✅ デプロイ前チェック

認証・Secrets入力を含む実行手順は `DEPLOY_PREP.md` を参照してください。

---

## 👤 初期ユーザー

| ユーザー名 | PIN  | ロール |
|-----------|------|--------|
| Admin     | 0000 | 管理者 |

> ⚠️ **初回ログイン後、必ず PIN を変更してください。**

---

## 🔐 ロールと権限

| 機能 | Staff | Manager | Admin |
|------|:-----:|:-------:|:-----:|
| 申請作成 | ✅ | ✅ | ✅ |
| 自分の履歴閲覧 | ✅ | ✅ | ✅ |
| 全員の申請閲覧 | ❌ | ✅ | ✅ |
| 承認・却下 | ❌ | ✅ | ✅ |
| 支払い完了マーク | ❌ | ✅ | ✅ |
| ユーザー管理 | ❌ | ✅ | ✅ |
| 申請強制削除 | ❌ | ❌ | ✅ |
| Admin作成・昇格 | ❌ | ❌ | ✅ |

---

## 💬 Discord 通知

1. Discordサーバーの `チャンネル設定 > 連携サービス > ウェブフック` から Webhook を作成
2. Webhook URL を `DISCORD_WEBHOOK_URL` シークレットに設定
3. 申請作成時・承認・却下・支払い完了のたびに Embed メッセージが自動更新されます
