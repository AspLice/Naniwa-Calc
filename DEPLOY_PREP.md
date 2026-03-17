# Deploy Preflight (デプロイ前チェック)

この文書は「デプロイ実行直前まで」を最短で進めるための手順です。

## 1. ここまで代行済み
- Workers APIのMVP実装
- D1マイグレーション作成
- frontend画面一式実装
- Discord通知の送信/編集対応
- GitHub Actionsデプロイワークフロー作成

## 2. あなたの操作が必要な箇所
以下は認証・秘密情報が必要なため、所有者操作が必要です。

1. Cloudflareログイン認証
2. Cloudflareリソース作成結果のID入力
3. Secretsの投入

## 3. 推奨: 自動セットアップ
プロジェクトルートで実行:

```powershell
./setup.ps1
```

このスクリプト中で必要になる入力値:
- D1 database_id
- KV namespace id
- FRONTEND_ORIGIN（例: https://asplice.github.io のようにパスなし）
- JWT_SECRET
- DISCORD_WEBHOOK_URL（任意）

## 4. 手動で行う場合
### 4.1 Cloudflareリソース作成
```powershell
Set-Location worker
wrangler login
wrangler d1 create mechanic-expense-db
wrangler kv namespace create SESSIONS
wrangler r2 bucket create mechanic-expense-receipts
```

### 4.2 wrangler.toml反映
- worker/wrangler.toml の以下を置換
  - REPLACE_WITH_D1_DATABASE_ID
  - REPLACE_WITH_KV_NAMESPACE_ID

### 4.3 Secrets設定
```powershell
Set-Location worker
"<RANDOM_SECRET>" | wrangler secret put JWT_SECRET
"https://discord.com/api/webhooks/..." | wrangler secret put DISCORD_WEBHOOK_URL
```

`FRONTEND_ORIGIN` は `worker/wrangler.toml` の `[vars]` で設定します。

### 4.4 D1適用
```powershell
Set-Location worker
wrangler d1 migrations apply mechanic-expense-db
```

## 5. デプロイ前の最終変更
- frontend/js/config.js のAPI URLを本番Workers URLに更新

例:
```js
window.API_BASE_URL = "https://fivem-mechanic-expense-api.<subdomain>.workers.dev";
```

## 6. デプロイ直前チェック
- worker/wrangler.toml のIDが実値になっている
- FRONTEND_ORIGIN がGitHub Pages URLと一致
- frontend/js/config.js が本番API URL
- GitHub Secretsに CF_API_TOKEN / CF_ACCOUNT_ID を登録済み

## 7. デプロイ
```powershell
git add .
git commit -m "feat: prepare pre-deploy configuration"
git push origin main
```
