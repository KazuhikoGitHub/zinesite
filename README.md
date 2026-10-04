# YOHaku

個人制作のマガジン、ZINEを公開・閲覧するためのプロトタイプです。

## フロントエンド

プロジェクトルートで次を実行します。

```sh
cd /path/to/yohaku
php -S localhost:8080
```

http://localhost:8080 を開いてください。純粋なHTML / CSS / JavaScriptで、ハッシュルーティングによりトップ、検索、詳細、ビューワー、会員、クリエイター、静的ページを確認できます。

## バックエンド

1. 初回はMySQL 8で `back/schema.sql` を実行
2. 既存DBの場合は `back/migration_email_verification.sql`、`back/migration_password_reset.sql`、`back/migration_view_events.sql`、`back/migration_user_sessions.sql`、`back/migration_tags.sql`、`back/migration_contact_messages.sql` を追加実行
3. `private/config.php` のDB情報、公開URL、送信元メールアドレスを設定
4. `api.php` と `app.js` をサーバーへアップロード

確認メールはLolipopのPHP標準メール送信機能 `mb_send_mail()` を使用します。Composer、PHPMailer、SMTPパスワードは不要です。`private/config.php` の `mail_from` には、Lolipopで作成した自ドメインのメールアドレスを設定してください。

`data/.htaccess` もアップロードしてください。アップロードされた画像ディレクトリ内でPHPなどのスクリプトが実行されないようにするための設定です。

```sh
cd /path/to/yohaku
php -S localhost:8081
```

`GET /api.php?action=health` と `GET /api.php?action=zines&q=slow` が利用できます。登録APIは `mb_send_mail()` で確認メールを送信し、メール内URLを開くまでログインできません。
