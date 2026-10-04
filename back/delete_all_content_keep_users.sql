USE `LAA1475494-mkazu`;

-- ユーザー本体 (zine_users) は削除しない。
-- 実行前に必ずバックアップを取得すること。
START TRANSACTION;

-- ユーザーやZINEに依存する明細から削除
DELETE FROM zine_view_events;
DELETE FROM reading_history;
DELETE FROM favorites;
DELETE FROM zine_pages;
DELETE FROM zine_tag_links;
DELETE FROM reports;
DELETE FROM password_reset_tokens;
DELETE FROM user_sessions;
DELETE FROM contact_messages;
DELETE FROM security_logs;

-- ZINE本体とタグを削除
DELETE FROM zines;
DELETE FROM zine_tags;

COMMIT;
