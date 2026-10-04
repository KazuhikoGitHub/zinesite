<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: https://mkazu.hiho.jp');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_samesite', 'Lax');
if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
    ini_set('session.cookie_secure', '1');
}
session_start();

function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

set_exception_handler(static function (Throwable $error): never {
    error_log('YOHaku API error: ' . $error->getMessage());
    respond(['error' => 'サーバー内部エラーが発生しました'], 500);
});

$action = $_GET['action'] ?? 'health';
if ($action === 'health') {
    respond(['ok' => true, 'service' => 'yohaku-api', 'php' => PHP_VERSION]);
}

$configCandidates = [
    __DIR__ . '/private/config.php',
    __DIR__ . '/config.local.php',
    __DIR__ . '/config.php',
];
$configPath = null;
foreach ($configCandidates as $candidate) {
    if (is_file($candidate)) {
        $configPath = $candidate;
        break;
    }
}
if ($configPath === null) {
    http_response_code(500);
    echo json_encode(['error' => 'Database configuration not found'], JSON_UNESCAPED_UNICODE);
    exit;
}
$config = require $configPath;

if ($action === 'media' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $requestedPath = (string) ($_GET['path'] ?? '');
    if (!preg_match('#^/data/(?:covers|zines)/[A-Za-z0-9._/-]+$#', $requestedPath)) {
        http_response_code(404);
        exit;
    }
    $dataRoot = realpath(__DIR__ . '/data');
    $filePath = realpath(__DIR__ . $requestedPath);
    if ($dataRoot === false || $filePath === false || !str_starts_with($filePath, $dataRoot . DIRECTORY_SEPARATOR) || !is_file($filePath)) {
        http_response_code(404);
        exit;
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($filePath) ?: 'application/octet-stream';
    $allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!in_array($mime, $allowedMimeTypes, true)) {
        http_response_code(415);
        exit;
    }
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string) filesize($filePath));
    header('Cache-Control: public, max-age=3600');
    header('X-Frame-Options: SAMEORIGIN');
    readfile($filePath);
    exit;
}

function requestBody(): array
{
    $body = json_decode(file_get_contents('php://input'), true);
    return is_array($body) ? $body : $_POST;
}

function currentUserId(): ?int
{
    return isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : null;
}

function requireLogin(): int
{
    $userId = currentUserId();
    if ($userId === null) {
        respond(['error' => 'ログインが必要です'], 401);
    }
    return $userId;
}

function requireAdmin(PDO $pdo, array $config): int
{
    $userId = requireLogin();
    $allowedIps = $config['allowed_admin_ips'] ?? [];
    if ($allowedIps !== [] && !in_array($_SERVER['REMOTE_ADDR'] ?? '', $allowedIps, true)) {
        respond(['error' => '管理画面へのアクセス元が許可されていません'], 403);
    }
    $statement = $pdo->prepare("SELECT id FROM zine_users WHERE id = :id AND role = 'admin' AND status = 'active' LIMIT 1");
    $statement->execute(['id' => $userId]);
    if (!$statement->fetch()) {
        respond(['error' => '管理者権限が必要です'], 403);
    }
    return $userId;
}

function logSecurity(PDO $pdo, ?int $userId, string $event): void
{
    $ip = inet_pton($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    if ($ip === false) {
        $ip = inet_pton('0.0.0.0');
    }
    $statement = $pdo->prepare('INSERT INTO security_logs (user_id, event, ip_address, user_agent) VALUES (:user_id, :event, :ip_address, :user_agent)');
    $statement->bindValue(':user_id', $userId, $userId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
    $statement->bindValue(':event', $event, PDO::PARAM_STR);
    $statement->bindValue(':ip_address', $ip, PDO::PARAM_LOB);
    $statement->bindValue(':user_agent', substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500), PDO::PARAM_STR);
    $statement->execute();
}

function checkRateLimit(PDO $pdo, string $event, int $maxAttempts = 10, int $windowSeconds = 900): void
{
    $ip = inet_pton($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    if ($ip === false) {
        $ip = inet_pton('0.0.0.0');
    }
    $statement = $pdo->prepare('SELECT COUNT(*) FROM security_logs WHERE event = :event AND ip_address = :ip_address AND created_at >= DATE_SUB(NOW(), INTERVAL :window SECOND)');
    $statement->bindValue(':event', $event, PDO::PARAM_STR);
    $statement->bindValue(':ip_address', $ip, PDO::PARAM_LOB);
    $statement->bindValue(':window', $windowSeconds, PDO::PARAM_INT);
    $statement->execute();
    $attempts = (int) $statement->fetchColumn();
    if ($attempts >= $maxAttempts) {
        respond(['error' => '試行回数の上限（10回）を超えました。しばらく時間をおいてから再度お試しください。'], 429);
    }
}

function removeFileIfExists(?string $relativePath): void
{
    if ($relativePath === null || $relativePath === '') {
        return;
    }
    $fullPath = __DIR__ . $relativePath;
    if (is_file($fullPath)) {
        @unlink($fullPath);
    }
}

function removeDirectoryRecursive(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    $items = scandir($dir);
    if ($items === false) {
        return;
    }
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $path = $dir . DIRECTORY_SEPARATOR . $item;
        if (is_dir($path)) {
            removeDirectoryRecursive($path);
        } else {
            @unlink($path);
        }
    }
    @rmdir($dir);
}

function base32Encode(string $bytes): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    for ($index = 0, $length = strlen($bytes); $index < $length; $index++) {
        $bits .= str_pad(decbin(ord($bytes[$index])), 8, '0', STR_PAD_LEFT);
    }
    $result = '';
    foreach (str_split($bits, 5) as $chunk) {
        $result .= $alphabet[bindec(str_pad($chunk, 5, '0'))];
    }
    return $result;
}

function totpCode(string $secret, ?int $timestamp = null): string
{
    $timestamp ??= time();
    $counter = intdiv($timestamp, 30);
    $binaryCounter = pack('N*', 0) . pack('N*', $counter);
    $key = base32Decode($secret);
    $hash = hash_hmac('sha1', $binaryCounter, $key, true);
    $offset = ord($hash[19]) & 0x0f;
    $value = ((ord($hash[$offset]) & 0x7f) << 24) | (ord($hash[$offset + 1]) << 16) | (ord($hash[$offset + 2]) << 8) | ord($hash[$offset + 3]);
    return str_pad((string) ($value % 1000000), 6, '0', STR_PAD_LEFT);
}

function base32Decode(string $value): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    foreach (str_split(strtoupper(rtrim($value, '='))) as $character) {
        $position = strpos($alphabet, $character);
        if ($position === false) {
            return '';
        }
        $bits .= str_pad(decbin($position), 5, '0', STR_PAD_LEFT);
    }
    $result = '';
    foreach (str_split($bits, 8) as $chunk) {
        if (strlen($chunk) === 8) {
            $result .= chr(bindec($chunk));
        }
    }
    return $result;
}

function validTotp(string $secret, string $code): bool
{
    for ($offset = -1; $offset <= 1; $offset++) {
        if (hash_equals(totpCode($secret, time() + ($offset * 30)), $code)) {
            return true;
        }
    }
    return false;
}

try {
    $pdo = new PDO($config['db']['dsn'], $config['db']['user'], $config['db']['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed'], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'verify' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = (string) ($_GET['token'] ?? '');
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
        respond(['error' => '確認リンクが正しくありません'], 400);
    }
    $statement = $pdo->prepare('SELECT id FROM zine_users WHERE email_verification_token_hash = :token_hash AND email_verification_expires_at > NOW() AND email_verified_at IS NULL LIMIT 1');
    $statement->execute(['token_hash' => hash('sha256', $token)]);
    $user = $statement->fetch();
    if (!$user) {
        respond(['error' => '確認リンクが無効または期限切れです'], 400);
    }
    $statement = $pdo->prepare('UPDATE zine_users SET email_verified_at = NOW(), email_verification_token_hash = NULL, email_verification_expires_at = NULL WHERE id = :id');
    $statement->execute(['id' => $user['id']]);
    $baseUrl = rtrim((string) ($config['app']['base_url'] ?? ''), '/');
    header('Location: ' . $baseUrl . '/#login?verified=1', true, 303);
    exit;
}

if ($action === 'diagnose' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdmin($pdo, $config);
    try {
        $availableTables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
        $tables = [
            'zine_users' => in_array('zine_users', $availableTables, true),
            'zines' => in_array('zines', $availableTables, true),
        ];
        $columns = [];
        foreach (['zine_users', 'zines'] as $table) {
            if ($tables[$table]) {
                $columns[$table] = $pdo->query('SHOW COLUMNS FROM `' . $table . '`')->fetchAll(PDO::FETCH_COLUMN);
            }
        }
        respond(['ok' => true, 'tables' => $tables, 'columns' => $columns]);
    } catch (Throwable $error) {
        error_log('YOHaku diagnose error: ' . $error->getMessage());
        respond(['error' => 'データベース診断に失敗しました', 'code' => 'DB_DIAGNOSE_FAILED'], 500);
    }
}

if ($action === 'register' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = requestBody();
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $password = (string) ($body['password'] ?? '');
    $displayName = trim((string) ($body['display_name'] ?? ''));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8 || $displayName === '') {
        respond(['error' => 'メールアドレス、表示名、8文字以上のパスワードを入力してください'], 422);
    }
    try {
        $token = bin2hex(random_bytes(32));
        $statement = $pdo->prepare('INSERT INTO zine_users (email, password_hash, display_name, email_verification_token_hash, email_verification_expires_at) VALUES (:email, :password_hash, :display_name, :token_hash, DATE_ADD(NOW(), INTERVAL 24 HOUR))');
        $statement->execute(['email' => $email, 'password_hash' => password_hash($password, PASSWORD_DEFAULT), 'display_name' => $displayName, 'token_hash' => hash('sha256', $token)]);
        $baseUrl = rtrim((string) ($config['app']['base_url'] ?? ''), '/');
        $verificationUrl = $baseUrl . '/api.php?action=verify&token=' . urlencode($token);
        if (!function_exists('mb_send_mail')) {
            $pdo->prepare('DELETE FROM zine_users WHERE email = :email')->execute(['email' => $email]);
            respond(['error' => 'mbstring拡張が有効ではないため、確認メールを送信できません'], 503);
        }
        mb_language('Japanese');
        mb_internal_encoding('UTF-8');
        $mailFrom = (string) ($config['app']['mail_from'] ?? 'noreply@localhost');
        $subject = '【YOHaku】メールアドレスの確認';
        $message = "YOHakuへの登録ありがとうございます。\n\n以下のURLを24時間以内に開いて、メールアドレスを確認してください。\n\n{$verificationUrl}\n\nこのメールに心当たりがない場合は破棄してください。";
        $headers = "From: {$mailFrom}\r\n";
        $headers .= "Reply-To: {$mailFrom}\r\n";
        $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $headers .= "Content-Transfer-Encoding: 8bit\r\n";
        if (!mb_send_mail($email, $subject, $message, $headers)) {
            $pdo->prepare('DELETE FROM zine_users WHERE email = :email')->execute(['email' => $email]);
            respond(['error' => '確認メールを送信できませんでした。時間をおいて再度お試しください'], 503);
        }
        respond(['ok' => true, 'message' => '確認メールを送信しました。24時間以内にメール内のURLを開いてください。'], 201);
    } catch (PDOException $error) {
        if ((int) $error->errorInfo[1] === 1062) {
            respond(['error' => 'このメールアドレスは登録済みです'], 409);
        }
        respond(['error' => 'アカウントを作成できませんでした'], 500);
    }
}

if ($action === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    checkRateLimit($pdo, 'login_failed', 10, 900);
    $body = requestBody();
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $password = (string) ($body['password'] ?? '');
    $statement = $pdo->prepare('SELECT id, email, password_hash, display_name, role, status, email_verified_at, totp_secret FROM zine_users WHERE email = :email LIMIT 1');
    $statement->execute(['email' => $email]);
    $user = $statement->fetch();
    if (!$user || $user['status'] !== 'active' || !$user['email_verified_at'] || !password_verify($password, $user['password_hash'])) {
        logSecurity($pdo, $user ? (int) $user['id'] : null, 'login_failed');
        if ($user && !$user['email_verified_at']) {
            respond(['error' => '確認メールのリンクを開いてからログインしてください'], 403);
        }
        respond(['error' => 'メールアドレスまたはパスワードが正しくありません'], 401);
    }
    if (!empty($user['totp_secret'])) {
        $_SESSION['pending_2fa_user_id'] = (int) $user['id'];
        respond(['ok' => true, 'requires_2fa' => true, 'message' => '認証アプリのコードを入力してください']);
    }
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $user['id'];
    $sessionHash = hash('sha256', session_id());
    $sessionIp = inet_pton($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    try {
        $sessionStatement = $pdo->prepare('INSERT INTO user_sessions (user_id, session_id_hash, ip_address, user_agent) VALUES (:user_id, :session_id_hash, :ip_address, :user_agent) ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP');
        $sessionStatement->bindValue(':user_id', (int) $user['id'], PDO::PARAM_INT);
        $sessionStatement->bindValue(':session_id_hash', $sessionHash, PDO::PARAM_STR);
        $sessionStatement->bindValue(':ip_address', $sessionIp === false ? null : $sessionIp, $sessionIp === false ? PDO::PARAM_NULL : PDO::PARAM_LOB);
        $sessionStatement->bindValue(':user_agent', substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500), PDO::PARAM_STR);
        $sessionStatement->execute();
    } catch (Throwable $error) {
        error_log('YOHaku session tracking unavailable: ' . $error->getMessage());
    }
    logSecurity($pdo, (int) $user['id'], 'login_success');
    unset($user['password_hash'], $user['status'], $user['totp_secret']);
    respond(['ok' => true, 'user' => $user]);
}

if ($action === 'login_2fa' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    checkRateLimit($pdo, 'login_2fa_failed', 10, 900);
    $pendingUserId = (int) ($_SESSION['pending_2fa_user_id'] ?? 0);
    $code = preg_replace('/\D/', '', (string) (requestBody()['code'] ?? ''));
    if ($pendingUserId < 1 || strlen($code) !== 6) {
        respond(['error' => '認証コードが必要です'], 422);
    }
    $statement = $pdo->prepare("SELECT id, email, display_name, role, status, totp_secret FROM zine_users WHERE id = :id AND status = 'active' LIMIT 1");
    $statement->execute(['id' => $pendingUserId]);
    $user = $statement->fetch();
    if (!$user || !$user['totp_secret'] || !validTotp($user['totp_secret'], $code)) {
        logSecurity($pdo, $pendingUserId, 'login_2fa_failed');
        respond(['error' => '認証コードが正しくありません'], 401);
    }
    session_regenerate_id(true);
    $_SESSION['user_id'] = $pendingUserId;
    unset($_SESSION['pending_2fa_user_id']);
    logSecurity($pdo, $pendingUserId, 'login_success');
    unset($user['status'], $user['totp_secret']);
    respond(['ok' => true, 'user' => $user]);
}

if ($action === 'password_reset_request' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = requestBody();
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(['error' => '有効なメールアドレスを入力してください'], 422);
    }
    $statement = $pdo->prepare('SELECT id FROM zine_users WHERE email = :email AND status = "active" LIMIT 1');
    $statement->execute(['email' => $email]);
    $user = $statement->fetch();
    if ($user) {
        $token = bin2hex(random_bytes(32));
        $pdo->prepare('DELETE FROM password_reset_tokens WHERE user_id = :user_id OR expires_at < NOW()')->execute(['user_id' => $user['id']]);
        $pdo->prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (:user_id, :token_hash, DATE_ADD(NOW(), INTERVAL 1 HOUR))')->execute(['user_id' => $user['id'], 'token_hash' => hash('sha256', $token)]);
        $baseUrl = rtrim((string) ($config['app']['base_url'] ?? ''), '/');
        $resetUrl = $baseUrl . '/#reset-password?token=' . urlencode($token);
        if (function_exists('mb_send_mail')) {
            mb_language('Japanese');
            mb_internal_encoding('UTF-8');
            $mailFrom = (string) ($config['app']['mail_from'] ?? 'noreply@localhost');
            $headers = "From: {$mailFrom}\r\nReply-To: {$mailFrom}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n";
            $message = "YOHakuのパスワード再設定を受け付けました。\n\n1時間以内に以下のURLを開いて、新しいパスワードを設定してください。\n\n{$resetUrl}\n\n心当たりがない場合は、このメールを破棄してください。";
            mb_send_mail($email, '【YOHaku】パスワード再設定', $message, $headers);
        }
    }
    respond(['ok' => true, 'message' => '登録済みの場合は、パスワード再設定メールを送信しました。']);
}

if ($action === 'password_reset' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    checkRateLimit($pdo, 'password_reset_failed', 10, 900);
    $body = requestBody();
    $token = (string) ($body['token'] ?? '');
    $password = (string) ($body['password'] ?? '');
    if (!preg_match('/^[a-f0-9]{64}$/', $token) || strlen($password) < 8) {
        respond(['error' => '有効なトークンと8文字以上のパスワードが必要です'], 422);
    }
    $statement = $pdo->prepare('SELECT id, user_id FROM password_reset_tokens WHERE token_hash = :token_hash AND expires_at > NOW() AND used_at IS NULL LIMIT 1');
    $statement->execute(['token_hash' => hash('sha256', $token)]);
    $reset = $statement->fetch();
    if (!$reset) {
        logSecurity($pdo, null, 'password_reset_failed');
        respond(['error' => '再設定リンクが無効または期限切れです'], 400);
    }
    $pdo->beginTransaction();
    $pdo->prepare('UPDATE zine_users SET password_hash = :password_hash WHERE id = :user_id')->execute(['password_hash' => password_hash($password, PASSWORD_DEFAULT), 'user_id' => $reset['user_id']]);
    $pdo->prepare('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = :id')->execute(['id' => $reset['id']]);
    $pdo->commit();
    logSecurity($pdo, (int) $reset['user_id'], 'password_reset_success');
    respond(['ok' => true, 'message' => 'パスワードを変更しました。ログインしてください。']);
}

if ($action === 'logout' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (currentUserId() !== null) {
        $pdo->prepare('DELETE FROM user_sessions WHERE session_id_hash = :session_id_hash')->execute(['session_id_hash' => hash('sha256', session_id())]);
    }
    logSecurity($pdo, currentUserId(), 'logout');
    $_SESSION = [];
    session_destroy();
    respond(['ok' => true]);
}

if ($action === 'sessions' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $userId = requireLogin();
    $statement = $pdo->prepare('SELECT id, INET6_NTOA(ip_address) AS ip_address, user_agent, last_seen_at, created_at, session_id_hash FROM user_sessions WHERE user_id = :user_id ORDER BY last_seen_at DESC');
    $statement->execute(['user_id' => $userId]);
    $items = $statement->fetchAll();
    $currentHash = hash('sha256', session_id());
    foreach ($items as &$item) {
        $item['current'] = hash_equals($currentHash, $item['session_id_hash']);
        unset($item['session_id_hash']);
    }
    respond(['items' => $items]);
}

if ($action === 'revoke_session' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $sessionId = (int) (requestBody()['session_id'] ?? 0);
    $statement = $pdo->prepare('DELETE FROM user_sessions WHERE id = :id AND user_id = :user_id');
    $statement->execute(['id' => $sessionId, 'user_id' => $userId]);
    respond(['ok' => true]);
}

if ($action === 'me') {
    if (empty($_SESSION['user_id'])) {
        respond(['user' => null]);
    }
    $statement = $pdo->prepare('SELECT id, email, display_name, bio, role FROM zine_users WHERE id = :id LIMIT 1');
    $statement->execute(['id' => (int) $_SESSION['user_id']]);
    respond(['user' => $statement->fetch() ?: null]);
}

if ($action === '2fa_setup' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $secret = base32Encode(random_bytes(20));
    $_SESSION['pending_totp_secret'] = $secret;
    $statement = $pdo->prepare('SELECT email FROM zine_users WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $userId]);
    $email = (string) $statement->fetchColumn();
    $issuer = rawurlencode('YOHaku');
    $label = rawurlencode('YOHaku:' . $email);
    respond(['ok' => true, 'secret' => $secret, 'otpauth_url' => "otpauth://totp/{$label}?secret={$secret}&issuer={$issuer}"]);
}

if ($action === '2fa_enable' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $code = preg_replace('/\D/', '', (string) (requestBody()['code'] ?? ''));
    $secret = (string) ($_SESSION['pending_totp_secret'] ?? '');
    if ($secret === '' || strlen($code) !== 6 || !validTotp($secret, $code)) {
        respond(['error' => '認証コードが正しくありません'], 422);
    }
    $statement = $pdo->prepare('UPDATE zine_users SET totp_secret = :secret WHERE id = :id');
    $statement->bindValue(':secret', $secret, PDO::PARAM_STR);
    $statement->bindValue(':id', $userId, PDO::PARAM_INT);
    $statement->execute();
    unset($_SESSION['pending_totp_secret']);
    respond(['ok' => true, 'message' => '2段階認証を有効にしました']);
}

if ($action === '2fa_disable' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $body = requestBody();
    $statement = $pdo->prepare('SELECT totp_secret, password_hash FROM zine_users WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $userId]);
    $user = $statement->fetch();
    $code = preg_replace('/\D/', '', (string) ($body['code'] ?? ''));
    if (!$user || !$user['totp_secret'] || !password_verify((string) ($body['password'] ?? ''), $user['password_hash']) || !validTotp($user['totp_secret'], $code)) {
        respond(['error' => 'パスワードまたは認証コードが正しくありません'], 403);
    }
    $pdo->prepare('UPDATE zine_users SET totp_secret = NULL WHERE id = :id')->execute(['id' => $userId]);
    respond(['ok' => true, 'message' => '2段階認証を解除しました']);
}

if ($action === 'update_profile' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $body = requestBody();
    $displayName = trim((string) ($body['display_name'] ?? ''));
    $bio = trim((string) ($body['bio'] ?? ''));
    if ($displayName === '' || mb_strlen($displayName) > 80 || mb_strlen($bio) > 2000) {
        respond(['error' => '表示名は1〜80文字、自己紹介は2000文字以内で入力してください'], 422);
    }
    $statement = $pdo->prepare('UPDATE zine_users SET display_name = :display_name, bio = :bio WHERE id = :id');
    $statement->execute(['display_name' => $displayName, 'bio' => $bio, 'id' => $userId]);
    respond(['ok' => true]);
}

if ($action === 'change_password' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $body = requestBody();
    $currentPassword = (string) ($body['current_password'] ?? '');
    $newPassword = (string) ($body['new_password'] ?? '');
    if (strlen($newPassword) < 8) {
        respond(['error' => '新しいパスワードは8文字以上で入力してください'], 422);
    }
    $statement = $pdo->prepare('SELECT password_hash FROM zine_users WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $userId]);
    $user = $statement->fetch();
    if (!$user || !password_verify($currentPassword, $user['password_hash'])) {
        respond(['error' => '現在のパスワードが正しくありません'], 403);
    }
    $statement = $pdo->prepare('UPDATE zine_users SET password_hash = :password_hash WHERE id = :id');
    $statement->execute(['password_hash' => password_hash($newPassword, PASSWORD_DEFAULT), 'id' => $userId]);
    respond(['ok' => true, 'message' => 'パスワードを変更しました']);
}

if ($action === 'change_email' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $newEmail = strtolower(trim((string) (requestBody()['email'] ?? '')));
    if (!filter_var($newEmail, FILTER_VALIDATE_EMAIL)) {
        respond(['error' => '有効なメールアドレスを入力してください'], 422);
    }
    $statement = $pdo->prepare('SELECT id, email FROM zine_users WHERE email = :email LIMIT 1');
    $statement->execute(['email' => $newEmail]);
    if ($statement->fetch()) {
        respond(['error' => 'このメールアドレスはすでに使用されています'], 409);
    }
    $token = bin2hex(random_bytes(32));
    $pdo->beginTransaction();
    $statement = $pdo->prepare('UPDATE zine_users SET email = :email, email_verified_at = NULL, email_verification_token_hash = :token_hash, email_verification_expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE id = :id');
    $statement->execute(['email' => $newEmail, 'token_hash' => hash('sha256', $token), 'id' => $userId]);
    $baseUrl = rtrim((string) ($config['app']['base_url'] ?? ''), '/');
    $verificationUrl = $baseUrl . '/api.php?action=verify&token=' . urlencode($token);
    $mailFrom = (string) ($config['app']['mail_from'] ?? 'noreply@localhost');
    if (!function_exists('mb_send_mail')) {
        $pdo->rollBack();
        respond(['error' => 'mbstring拡張が有効ではないため、確認メールを送信できません'], 503);
    }
    mb_language('Japanese');
    mb_internal_encoding('UTF-8');
    $headers = "From: {$mailFrom}\r\nReply-To: {$mailFrom}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n";
    $message = "YOHakuのメールアドレス変更を受け付けました。\n\n24時間以内に以下のURLを開いて変更を確定してください。\n\n{$verificationUrl}";
    if (!mb_send_mail($newEmail, '【YOHaku】メールアドレス変更の確認', $message, $headers)) {
        $pdo->rollBack();
        respond(['error' => '確認メールを送信できませんでした'], 503);
    }
    $pdo->commit();
    respond(['ok' => true, 'message' => '新しいメールアドレスへ確認メールを送信しました']);
}

if ($action === 'my_zines' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $userId = requireLogin();
    $statement = $pdo->prepare('SELECT z.id, z.title, z.slug, z.description, z.cover_path, z.category, z.age_restricted, z.status, z.view_count, z.favorite_count, z.published_at, z.created_at, z.updated_at, COUNT(p.id) AS page_count, (SELECT GROUP_CONCAT(t.name SEPARATOR ",") FROM zine_tag_links l JOIN zine_tags t ON t.id = l.tag_id WHERE l.zine_id = z.id) AS tags FROM zines z LEFT JOIN zine_pages p ON p.zine_id = z.id WHERE z.author_id = :author_id GROUP BY z.id ORDER BY z.updated_at DESC');
    $statement->execute(['author_id' => $userId]);
    $items = $statement->fetchAll();
    foreach ($items as &$item) {
        $item['workflow'] = $item['cover_path'] === null ? 'cover' : ((int) $item['page_count'] === 0 ? 'content' : ($item['status'] === 'published' ? 'published' : 'ready'));
    }
    respond(['items' => $items]);
}

if ($action === 'create_zine' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $body = requestBody();
    $title = trim((string) ($body['title'] ?? ''));
    $description = trim((string) ($body['description'] ?? ''));
    $category = trim((string) ($body['category'] ?? ''));
    if ($title === '' || mb_strlen($title) > 200 || $description === '' || $category === '') {
        respond(['error' => 'タイトル、説明文、カテゴリを入力してください'], 422);
    }
    $slug = trim((string) ($body['slug'] ?? ''));
    if ($slug === '') {
        $slug = trim((string) preg_replace('/[^a-z0-9-]+/i', '-', strtolower($title)), '-');
    }
    if ($slug === '') {
        $slug = 'zine-' . bin2hex(random_bytes(4));
    }
    try {
        $statement = $pdo->prepare('INSERT INTO zines (author_id, title, slug, description, category, age_restricted, status) VALUES (:author_id, :title, :slug, :description, :category, :age_restricted, :status)');
        $statement->execute([
            'author_id' => $userId,
            'title' => $title,
            'slug' => $slug,
            'description' => $description,
            'category' => $category,
            'age_restricted' => !empty($body['age_restricted']) ? 1 : 0,
            'status' => 'draft',
        ]);
        $zineId = (int) $pdo->lastInsertId();
        $tags = $body['tags'] ?? [];
        if (is_string($tags)) {
            $tags = explode(',', $tags);
        }
        if (is_array($tags)) {
            foreach (array_unique(array_filter(array_map(static fn ($tag): string => trim((string) $tag), $tags))) as $tag) {
                $pdo->prepare('INSERT INTO zine_tags (name) VALUES (:name) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)')->execute(['name' => mb_substr($tag, 0, 50)]);
                $tagId = (int) $pdo->lastInsertId();
                $pdo->prepare('INSERT IGNORE INTO zine_tag_links (zine_id, tag_id) VALUES (:zine_id, :tag_id)')->execute(['zine_id' => $zineId, 'tag_id' => $tagId]);
            }
        }
        respond(['ok' => true, 'zine_id' => $zineId, 'status' => 'draft'], 201);
    } catch (PDOException $error) {
        if ((int) ($error->errorInfo[1] ?? 0) === 1062) {
            respond(['error' => 'このスラッグはすでに使用されています'], 409);
        }
        throw $error;
    }
}

if ($action === 'update_zine' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $body = requestBody();
    $zineId = (int) ($body['zine_id'] ?? 0);
    $title = trim((string) ($body['title'] ?? ''));
    $description = trim((string) ($body['description'] ?? ''));
    $category = trim((string) ($body['category'] ?? ''));
    if ($zineId < 1 || $title === '' || $description === '' || $category === '') {
        respond(['error' => 'タイトル、説明文、カテゴリを入力してください'], 422);
    }
    $statement = $pdo->prepare('UPDATE zines SET title = :title, description = :description, category = :category, age_restricted = :age_restricted WHERE id = :id AND author_id = :author_id');
    $statement->execute(['title' => $title, 'description' => $description, 'category' => $category, 'age_restricted' => !empty($body['age_restricted']) ? 1 : 0, 'id' => $zineId, 'author_id' => $userId]);
    respond(['ok' => true]);
}

if ($action === 'pages' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $userId = requireLogin();
    $zineId = (int) ($_GET['zine_id'] ?? 0);
    $statement = $pdo->prepare('SELECT p.id, p.page_number, p.file_path FROM zine_pages p JOIN zines z ON z.id = p.zine_id WHERE p.zine_id = :zine_id AND z.author_id = :author_id ORDER BY p.page_number');
    $statement->execute(['zine_id' => $zineId, 'author_id' => $userId]);
    respond(['items' => $statement->fetchAll()]);
}

if ($action === 'upload_page' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $zineId = (int) ($_POST['zine_id'] ?? 0);
    $pageNumber = max(1, (int) ($_POST['page_number'] ?? 0));
    $file = $_FILES['page'] ?? null;
    if ($zineId < 1 || $file === null || $file['error'] !== UPLOAD_ERR_OK) {
        respond(['error' => 'ZINE IDとページ画像が必要です'], 422);
    }
    if ($file['size'] > 10 * 1024 * 1024) {
        respond(['error' => '1ページあたり10MBまでです'], 422);
    }
    $imageInfo = @getimagesize($file['tmp_name']);
    $allowedTypes = [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF];
    if ($imageInfo === false || !in_array($imageInfo[2], $allowedTypes, true)) {
        respond(['error' => 'JPG、PNG、WEBPの画像を指定してください'], 422);
    }
    $statement = $pdo->prepare('SELECT id FROM zines WHERE id = :zine_id AND author_id = :author_id LIMIT 1');
    $statement->execute(['zine_id' => $zineId, 'author_id' => $userId]);
    if (!$statement->fetch()) {
        respond(['error' => 'ZINEが見つかりません'], 404);
    }
    $countStatement = $pdo->prepare('SELECT COUNT(*) FROM zine_pages WHERE zine_id = :zine_id');
    $countStatement->execute(['zine_id' => $zineId]);
    $currentPageCount = (int) $countStatement->fetchColumn();
    $existingPageStatement = $pdo->prepare('SELECT file_path FROM zine_pages WHERE zine_id = :zine_id AND page_number = :page_number LIMIT 1');
    $existingPageStatement->execute(['zine_id' => $zineId, 'page_number' => $pageNumber]);
    $existingPage = $existingPageStatement->fetch();
    if (!$existingPage && $currentPageCount >= 50) {
        respond(['error' => '1作品あたりの最大ページ数は50ページです'], 422);
    }
    $extension = image_type_to_extension($imageInfo[2], false);
    $directory = __DIR__ . '/data/zines/' . $zineId;
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        respond(['error' => 'アップロード先を作成できません'], 500);
    }
    $filename = sprintf('%04d-%s.%s', $pageNumber, bin2hex(random_bytes(8)), $extension);
    $destination = $directory . '/' . $filename;
    if (!move_uploaded_file($file['tmp_name'], $destination)) {
        respond(['error' => 'ページを保存できませんでした'], 500);
    }
    chmod($destination, 0644);
    $path = '/data/zines/' . $zineId . '/' . $filename;
    $statement = $pdo->prepare('INSERT INTO zine_pages (zine_id, page_number, file_path) VALUES (:zine_id, :page_number, :file_path) ON DUPLICATE KEY UPDATE file_path = VALUES(file_path)');
    $statement->execute(['zine_id' => $zineId, 'page_number' => $pageNumber, 'file_path' => $path]);
    if ($existingPage && !empty($existingPage['file_path']) && $existingPage['file_path'] !== $path) {
        removeFileIfExists((string) $existingPage['file_path']);
    }
    respond(['ok' => true, 'page_number' => $pageNumber, 'file_path' => $path], 201);
}

if ($action === 'upload_cover' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $zineId = (int) ($_POST['zine_id'] ?? 0);
    $file = $_FILES['cover'] ?? null;
    if ($zineId < 1 || $file === null || $file['error'] !== UPLOAD_ERR_OK) {
        respond(['error' => 'ZINE IDと表紙画像が必要です'], 422);
    }
    if ($file['size'] > 10 * 1024 * 1024) {
        respond(['error' => '表紙画像は10MBまでです'], 422);
    }
    $imageInfo = @getimagesize($file['tmp_name']);
    $allowedTypes = [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP];
    if ($imageInfo === false || !in_array($imageInfo[2], $allowedTypes, true)) {
        respond(['error' => 'JPG、PNG、WEBPの画像を指定してください'], 422);
    }
    $statement = $pdo->prepare('SELECT id, cover_path FROM zines WHERE id = :zine_id AND author_id = :author_id LIMIT 1');
    $statement->execute(['zine_id' => $zineId, 'author_id' => $userId]);
    $zine = $statement->fetch();
    if (!$zine) {
        respond(['error' => 'ZINEが見つかりません'], 404);
    }
    $oldCoverPath = $zine['cover_path'] ?? null;
    $directory = __DIR__ . '/data/covers';
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        respond(['error' => 'アップロード先を作成できません'], 500);
    }
    $filename = $zineId . '-' . bin2hex(random_bytes(8)) . '.' . image_type_to_extension($imageInfo[2], false);
    $destination = $directory . '/' . $filename;
    if (!move_uploaded_file($file['tmp_name'], $destination)) {
        respond(['error' => '表紙を保存できませんでした'], 500);
    }
    chmod($destination, 0644);
    $path = '/data/covers/' . $filename;
    $pdo->prepare('UPDATE zines SET cover_path = :cover_path WHERE id = :id AND author_id = :author_id')->execute(['cover_path' => $path, 'id' => $zineId, 'author_id' => $userId]);
    if (!empty($oldCoverPath) && $oldCoverPath !== $path) {
        removeFileIfExists((string) $oldCoverPath);
    }
    respond(['ok' => true, 'cover_path' => $path], 201);
}

if ($action === 'upload_pdf' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $zineId = (int) ($_POST['zine_id'] ?? 0);
    $file = $_FILES['pdf'] ?? null;
    if ($zineId < 1 || $file === null || $file['error'] !== UPLOAD_ERR_OK) {
        respond(['error' => 'PDFファイルが必要です'], 422);
    }
    if ($file['size'] > 50 * 1024 * 1024) {
        respond(['error' => 'PDFは50MBまでです'], 422);
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    if ($mime !== 'application/pdf') {
        respond(['error' => 'PDFファイルを指定してください'], 422);
    }
    $statement = $pdo->prepare('SELECT id FROM zines WHERE id = :zine_id AND author_id = :author_id LIMIT 1');
    $statement->execute(['zine_id' => $zineId, 'author_id' => $userId]);
    if (!$statement->fetch()) {
        respond(['error' => 'ZINEが見つかりません'], 404);
    }
    $oldPagesStatement = $pdo->prepare('SELECT file_path FROM zine_pages WHERE zine_id = :zine_id');
    $oldPagesStatement->execute(['zine_id' => $zineId]);
    $oldPages = $oldPagesStatement->fetchAll(PDO::FETCH_COLUMN);
    $directory = __DIR__ . '/data/zines/' . $zineId;
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        respond(['error' => 'アップロード先を作成できません'], 500);
    }
    $filename = 'source-' . bin2hex(random_bytes(8)) . '.pdf';
    $pdfPath = $directory . '/' . $filename;
    if (!move_uploaded_file($file['tmp_name'], $pdfPath)) {
        respond(['error' => 'PDFを保存できませんでした'], 500);
    }
    chmod($pdfPath, 0644);
    $path = '/data/zines/' . $zineId . '/' . $filename;
    $pdo->prepare('DELETE FROM zine_pages WHERE zine_id = :zine_id')->execute(['zine_id' => $zineId]);
    $pdo->prepare('INSERT INTO zine_pages (zine_id, page_number, file_path) VALUES (:zine_id, 1, :file_path)')->execute(['zine_id' => $zineId, 'file_path' => $path]);
    foreach ($oldPages as $oldPagePath) {
        if (!empty($oldPagePath) && $oldPagePath !== $path) {
            removeFileIfExists((string) $oldPagePath);
        }
    }
    respond(['ok' => true, 'file_path' => $path], 201);
}

if ($action === 'delete_page' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $pageId = (int) (requestBody()['page_id'] ?? 0);
    $statement = $pdo->prepare('SELECT p.file_path FROM zine_pages p JOIN zines z ON z.id = p.zine_id WHERE p.id = :page_id AND z.author_id = :author_id LIMIT 1');
    $statement->execute(['page_id' => $pageId, 'author_id' => $userId]);
    $page = $statement->fetch();
    if (!$page) {
        respond(['error' => 'ページが見つかりません'], 404);
    }
    $pdo->prepare('DELETE FROM zine_pages WHERE id = :id')->execute(['id' => $pageId]);
    removeFileIfExists((string) $page['file_path']);
    respond(['ok' => true]);
}

if ($action === 'delete_cover' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $zineId = (int) (requestBody()['zine_id'] ?? 0);
    $statement = $pdo->prepare('SELECT cover_path FROM zines WHERE id = :id AND author_id = :author_id LIMIT 1');
    $statement->execute(['id' => $zineId, 'author_id' => $userId]);
    $zine = $statement->fetch();
    if (!$zine) {
        respond(['error' => 'ZINEが見つかりません'], 404);
    }
    $pdo->prepare('UPDATE zines SET cover_path = NULL WHERE id = :id AND author_id = :author_id')->execute(['id' => $zineId, 'author_id' => $userId]);
    if (!empty($zine['cover_path'])) {
        removeFileIfExists((string) $zine['cover_path']);
    }
    respond(['ok' => true]);
}

if ($action === 'reorder_pages' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $body = requestBody();
    $zineId = (int) ($body['zine_id'] ?? 0);
    $pageIds = $body['page_ids'] ?? [];
    if ($zineId < 1 || !is_array($pageIds) || $pageIds === []) {
        respond(['error' => 'ZINE IDとページ順が必要です'], 422);
    }
    $statement = $pdo->prepare('SELECT p.id FROM zine_pages p JOIN zines z ON z.id = p.zine_id WHERE p.zine_id = :zine_id AND z.author_id = :author_id');
    $statement->execute(['zine_id' => $zineId, 'author_id' => $userId]);
    $ownedIds = array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));
    $requestedIds = array_map('intval', $pageIds);
    sort($ownedIds);
    $compareIds = $requestedIds;
    sort($compareIds);
    if ($ownedIds !== $compareIds) {
        respond(['error' => 'ページ順に不正なIDが含まれています'], 422);
    }
    $pdo->beginTransaction();
    $update = $pdo->prepare('UPDATE zine_pages SET page_number = :page_number WHERE id = :id');
    foreach ($requestedIds as $index => $pageId) {
        $update->execute(['page_number' => 60000 + $index, 'id' => $pageId]);
    }
    foreach ($requestedIds as $index => $pageId) {
        $update->execute(['page_number' => $index + 1, 'id' => $pageId]);
    }
    $pdo->commit();
    respond(['ok' => true]);
}

if ($action === 'publish_zine' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $body = requestBody();
    $zineId = (int) ($body['zine_id'] ?? 0);
    if ($zineId < 1) {
        respond(['error' => 'ZINE IDが必要です'], 422);
    }
    $statement = $pdo->prepare('SELECT cover_path, (SELECT COUNT(*) FROM zine_pages WHERE zine_id = zines.id) AS page_count FROM zines WHERE id = :id AND author_id = :author_id LIMIT 1');
    $statement->execute(['id' => $zineId, 'author_id' => $userId]);
    $zine = $statement->fetch();
    if (!$zine) {
        respond(['error' => 'ZINEが見つかりません'], 404);
    }
    if (empty($zine['cover_path'])) {
        respond(['error' => '表紙を登録してください'], 422);
    }
    if ((int) $zine['page_count'] < 1) {
        respond(['error' => '本文ページを1ページ以上登録してください'], 422);
    }
    $statement = $pdo->prepare("UPDATE zines SET status = 'published', published_at = COALESCE(published_at, NOW()) WHERE id = :id AND author_id = :author_id");
    $statement->execute(['id' => $zineId, 'author_id' => $userId]);
    respond(['ok' => true, 'zine_id' => $zineId, 'status' => 'published']);
}

if ($action === 'unpublish_zine' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $zineId = (int) (requestBody()['zine_id'] ?? 0);
    if ($zineId < 1) {
        respond(['error' => 'ZINE IDが必要です'], 422);
    }
    $statement = $pdo->prepare("UPDATE zines SET status = 'private' WHERE id = :id AND author_id = :author_id");
    $statement->execute(['id' => $zineId, 'author_id' => $userId]);
    if ($statement->rowCount() === 0) {
        respond(['error' => '公開中のZINEが見つかりません'], 404);
    }
    respond(['ok' => true, 'zine_id' => $zineId, 'status' => 'private']);
}

if ($action === 'delete_zine' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $body = requestBody();
    $zineId = (int) ($body['zine_id'] ?? 0);
    $statement = $pdo->prepare('SELECT cover_path FROM zines WHERE id = :id AND author_id = :author_id LIMIT 1');
    $statement->execute(['id' => $zineId, 'author_id' => $userId]);
    $zine = $statement->fetch();
    if ($zine) {
        if (!empty($zine['cover_path'])) {
            removeFileIfExists((string) $zine['cover_path']);
        }
        removeDirectoryRecursive(__DIR__ . '/data/zines/' . $zineId);
        $deleteStatement = $pdo->prepare('DELETE FROM zines WHERE id = :id AND author_id = :author_id');
        $deleteStatement->execute(['id' => $zineId, 'author_id' => $userId]);
    }
    respond(['ok' => true]);
}

if ($action === 'favorite' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $body = requestBody();
    $zineId = (int) ($body['zine_id'] ?? 0);
    if ($zineId < 1) {
        respond(['error' => 'ZINE IDが必要です'], 422);
    }
    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare('INSERT INTO favorites (user_id, zine_id) VALUES (:user_id, :zine_id)');
        $statement->execute(['user_id' => $userId, 'zine_id' => $zineId]);
        $pdo->prepare('UPDATE zines SET favorite_count = favorite_count + 1 WHERE id = :id')->execute(['id' => $zineId]);
        $pdo->commit();
        respond(['ok' => true, 'favorited' => true]);
    } catch (PDOException $error) {
        $pdo->rollBack();
        if ((int) ($error->errorInfo[1] ?? 0) === 1062) {
            respond(['error' => 'すでにお気に入り登録されています'], 409);
        }
        throw $error;
    }
}

if ($action === 'unfavorite' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $body = requestBody();
    $zineId = (int) ($body['zine_id'] ?? 0);
    $pdo->beginTransaction();
    $statement = $pdo->prepare('DELETE FROM favorites WHERE user_id = :user_id AND zine_id = :zine_id');
    $statement->execute(['user_id' => $userId, 'zine_id' => $zineId]);
    if ($statement->rowCount() > 0) {
        $pdo->prepare('UPDATE zines SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = :id')->execute(['id' => $zineId]);
    }
    $pdo->commit();
    respond(['ok' => true, 'favorited' => false]);
}

if ($action === 'favorites' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $userId = requireLogin();
    $statement = $pdo->prepare('SELECT z.id, z.title, z.description, z.cover_path, z.view_count, z.favorite_count, u.display_name AS author FROM favorites f JOIN zines z ON z.id = f.zine_id JOIN zine_users u ON u.id = z.author_id WHERE f.user_id = :user_id ORDER BY f.created_at DESC');
    $statement->execute(['user_id' => $userId]);
    respond(['items' => $statement->fetchAll()]);
}

if ($action === 'history' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $userId = requireLogin();
    $statement = $pdo->prepare('SELECT z.id, z.title, z.description, z.cover_path, h.last_page, h.viewed_at, u.display_name AS author FROM reading_history h JOIN zines z ON z.id = h.zine_id JOIN zine_users u ON u.id = z.author_id WHERE h.user_id = :user_id ORDER BY h.viewed_at DESC');
    $statement->execute(['user_id' => $userId]);
    respond(['items' => $statement->fetchAll()]);
}

if ($action === 'record_view' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = currentUserId();
    $body = requestBody();
    $zineId = (int) ($body['zine_id'] ?? 0);
    $lastPage = max(1, (int) ($body['last_page'] ?? 1));
    if ($zineId < 1) {
        respond(['error' => 'ZINE IDが必要です'], 422);
    }
    $pdo->prepare('UPDATE zines SET view_count = view_count + 1 WHERE id = :id AND status = "published"')->execute(['id' => $zineId]);
    $ip = inet_pton($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    $viewStatement = $pdo->prepare('INSERT INTO zine_view_events (zine_id, user_id, ip_address) VALUES (:zine_id, :user_id, :ip_address)');
    $viewStatement->bindValue(':zine_id', $zineId, PDO::PARAM_INT);
    $viewStatement->bindValue(':user_id', $userId, $userId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
    $viewStatement->bindValue(':ip_address', $ip === false ? null : $ip, $ip === false ? PDO::PARAM_NULL : PDO::PARAM_LOB);
    $viewStatement->execute();
    if ($userId !== null) {
        $statement = $pdo->prepare('INSERT INTO reading_history (user_id, zine_id, last_page) VALUES (:user_id, :zine_id, :last_page) ON DUPLICATE KEY UPDATE last_page = VALUES(last_page), viewed_at = CURRENT_TIMESTAMP');
        $statement->execute(['user_id' => $userId, 'zine_id' => $zineId, 'last_page' => $lastPage]);
    }
    respond(['ok' => true]);
}

if ($action === 'zine' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $zineId = (int) ($_GET['id'] ?? 0);
    if ($zineId < 1) {
        respond(['error' => 'ZINE IDが必要です'], 422);
    }
    $statement = $pdo->prepare('SELECT z.id, z.title, z.description, z.cover_path, z.category, z.age_restricted, z.status, z.view_count, z.favorite_count, z.published_at, u.id AS author_id, u.display_name AS author, u.bio AS author_bio FROM zines z JOIN zine_users u ON u.id = z.author_id WHERE z.id = :id AND z.status = "published" LIMIT 1');
    $statement->execute(['id' => $zineId]);
    $zine = $statement->fetch();
    if (!$zine) {
        respond(['error' => 'ZINEが見つかりません'], 404);
    }
    $statement = $pdo->prepare('SELECT id, page_number, file_path FROM zine_pages WHERE zine_id = :zine_id ORDER BY page_number');
    $statement->execute(['zine_id' => $zineId]);
    $zine['pages'] = $statement->fetchAll();
    respond(['item' => $zine]);
}

if ($action === 'author' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $authorId = (int) ($_GET['id'] ?? 0);
    $statement = $pdo->prepare("SELECT u.id, u.display_name, u.bio, COALESCE(SUM(z.view_count), 0) AS total_views FROM zine_users u LEFT JOIN zines z ON z.author_id = u.id AND z.status = 'published' WHERE u.id = :id GROUP BY u.id");
    $statement->execute(['id' => $authorId]);
    $author = $statement->fetch();
    if (!$author) {
        respond(['error' => '著者が見つかりません'], 404);
    }
    $statement = $pdo->prepare("SELECT id, title, description, cover_path, category, view_count, favorite_count FROM zines WHERE author_id = :author_id AND status = 'published' ORDER BY published_at DESC");
    $statement->execute(['author_id' => $authorId]);
    $author['zines'] = $statement->fetchAll();
    respond(['item' => $author]);
}

if ($action === 'analytics' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $userId = requireLogin();
    $zineId = (int) ($_GET['zine_id'] ?? 0);
    $statement = $pdo->prepare('SELECT id FROM zines WHERE id = :zine_id AND author_id = :author_id LIMIT 1');
    $statement->execute(['zine_id' => $zineId, 'author_id' => $userId]);
    if (!$statement->fetch()) {
        respond(['error' => 'ZINEが見つかりません'], 404);
    }
    $statement = $pdo->prepare('SELECT DATE(viewed_at) AS view_date, COUNT(*) AS views FROM zine_view_events WHERE zine_id = :zine_id AND viewed_at >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY) GROUP BY DATE(viewed_at) ORDER BY view_date');
    $statement->execute(['zine_id' => $zineId]);
    respond(['items' => $statement->fetchAll()]);
}

if ($action === 'report' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $userId = requireLogin();
    $body = requestBody();
    $zineId = (int) ($body['zine_id'] ?? 0);
    $reason = trim((string) ($body['reason'] ?? ''));
    $detail = trim((string) ($body['detail'] ?? ''));
    $allowedReasons = ['copyright', 'inappropriate', 'privacy', 'other'];
    if ($zineId < 1 || !in_array($reason, $allowedReasons, true) || $detail === '') {
        respond(['error' => '対象ZINE、通報理由、詳細を入力してください'], 422);
    }
    $statement = $pdo->prepare("SELECT id FROM zines WHERE id = :id AND status = 'published' LIMIT 1");
    $statement->execute(['id' => $zineId]);
    if (!$statement->fetch()) {
        respond(['error' => 'ZINEが見つかりません'], 404);
    }
    $statement = $pdo->prepare('INSERT INTO reports (reporter_id, zine_id, reason, detail) VALUES (:reporter_id, :zine_id, :reason, :detail)');
    $statement->execute(['reporter_id' => $userId, 'zine_id' => $zineId, 'reason' => $reason, 'detail' => $detail]);
    respond(['ok' => true, 'report_id' => (int) $pdo->lastInsertId()], 201);
}

if ($action === 'contact' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = requestBody();
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $subject = trim((string) ($body['subject'] ?? ''));
    $message = trim((string) ($body['message'] ?? ''));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $subject === '' || $message === '') {
        respond(['error' => 'メールアドレス、件名、本文を入力してください'], 422);
    }
    $statement = $pdo->prepare('INSERT INTO contact_messages (user_id, email, subject, message) VALUES (:user_id, :email, :subject, :message)');
    $statement->execute(['user_id' => currentUserId(), 'email' => $email, 'subject' => $subject, 'message' => $message]);
    respond(['ok' => true, 'message' => 'お問い合わせを受け付けました'], 201);
}

if ($action === 'admin_stats' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdmin($pdo, $config);
    $stats = [];
    $stats['users'] = (int) $pdo->query('SELECT COUNT(*) FROM zine_users')->fetchColumn();
    $stats['published_zines'] = (int) $pdo->query("SELECT COUNT(*) FROM zines WHERE status = 'published'")->fetchColumn();
    $stats['total_views'] = (int) $pdo->query('SELECT COALESCE(SUM(view_count), 0) FROM zines')->fetchColumn();
    $stats['open_reports'] = (int) $pdo->query("SELECT COUNT(*) FROM reports WHERE status = 'open'")->fetchColumn();
    respond(['stats' => $stats]);
}

if ($action === 'admin_reports' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdmin($pdo, $config);
    $statement = $pdo->query('SELECT r.id, r.reason, r.detail, r.status, r.created_at, z.title AS zine_title, u.email AS reporter_email FROM reports r LEFT JOIN zines z ON z.id = r.zine_id LEFT JOIN zine_users u ON u.id = r.reporter_id ORDER BY r.created_at DESC LIMIT 100');
    respond(['items' => $statement->fetchAll()]);
}

if ($action === 'admin_contacts' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdmin($pdo, $config);
    $statement = $pdo->query('SELECT id, email, subject, message, status, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 100');
    respond(['items' => $statement->fetchAll()]);
}

if ($action === 'admin_report_status' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdmin($pdo, $config);
    $body = requestBody();
    $status = (string) ($body['status'] ?? '');
    if (!in_array($status, ['open', 'reviewing', 'resolved'], true)) {
        respond(['error' => '通報ステータスが正しくありません'], 422);
    }
    $statement = $pdo->prepare('UPDATE reports SET status = :status WHERE id = :id');
    $statement->execute(['status' => $status, 'id' => (int) ($body['report_id'] ?? 0)]);
    respond(['ok' => true]);
}

if ($action === 'admin_security_logs' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdmin($pdo, $config);
    $statement = $pdo->query('SELECT s.id, s.event, INET6_NTOA(s.ip_address) AS ip_address, s.user_agent, s.created_at, u.email FROM security_logs s LEFT JOIN zine_users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 200');
    respond(['items' => $statement->fetchAll()]);
}

if ($action === 'admin_users' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdmin($pdo, $config);
    $query = trim((string) ($_GET['q'] ?? ''));
    $statement = $pdo->prepare('SELECT id, email, display_name, role, status, email_verified_at, created_at FROM zine_users WHERE email LIKE :query OR display_name LIKE :query ORDER BY created_at DESC LIMIT 100');
    $statement->execute(['query' => '%' . $query . '%']);
    respond(['items' => $statement->fetchAll()]);
}

if ($action === 'admin_user_status' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $adminId = requireAdmin($pdo, $config);
    $body = requestBody();
    $userId = (int) ($body['user_id'] ?? 0);
    $status = (string) ($body['status'] ?? '');
    if ($userId === $adminId || !in_array($status, ['active', 'suspended', 'banned'], true)) {
        respond(['error' => 'ユーザー状態を変更できません'], 422);
    }
    $statement = $pdo->prepare('UPDATE zine_users SET status = :status WHERE id = :id');
    $statement->execute(['status' => $status, 'id' => $userId]);
    respond(['ok' => true]);
}

if ($action === 'admin_zines' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdmin($pdo, $config);
    $query = trim((string) ($_GET['q'] ?? ''));
    $statement = $pdo->prepare('SELECT z.id, z.title, z.status, z.view_count, z.favorite_count, z.created_at, u.display_name AS author FROM zines z JOIN zine_users u ON u.id = z.author_id WHERE z.title LIKE :query OR u.display_name LIKE :query ORDER BY z.created_at DESC LIMIT 100');
    $statement->execute(['query' => '%' . $query . '%']);
    respond(['items' => $statement->fetchAll()]);
}

if ($action === 'admin_zine_status' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdmin($pdo, $config);
    $body = requestBody();
    $status = (string) ($body['status'] ?? '');
    if (!in_array($status, ['draft', 'published', 'private'], true)) {
        respond(['error' => 'ZINE状態が正しくありません'], 422);
    }
    $statement = $pdo->prepare('UPDATE zines SET status = :status, published_at = CASE WHEN :status = "published" THEN COALESCE(published_at, NOW()) ELSE published_at END WHERE id = :id');
    $statement->execute(['status' => $status, 'id' => (int) ($body['zine_id'] ?? 0)]);
    respond(['ok' => true]);
}

if ($action === 'zines') {
    try {
        $query = trim((string) ($_GET['q'] ?? ''));
        $category = trim((string) ($_GET['category'] ?? ''));
        $tag = trim((string) ($_GET['tag'] ?? ''));
        $sort = (string) ($_GET['sort'] ?? 'new');
        $order = match ($sort) {
            'popular' => 'z.favorite_count DESC, z.published_at DESC',
            'views' => 'z.view_count DESC, z.published_at DESC',
            default => 'z.published_at DESC',
        };
        $sql = 'SELECT z.id, z.title, z.description, z.category, z.cover_path, z.view_count, z.favorite_count, u.display_name AS author FROM zines z JOIN zine_users u ON u.id = z.author_id WHERE z.status = :status';
        $parameters = ['status' => 'published'];
        if ($query !== '') {
            $sql .= ' AND (z.title LIKE :keyword_title OR z.description LIKE :keyword_description)';
            $keyword = "%{$query}%";
            $parameters['keyword_title'] = $keyword;
            $parameters['keyword_description'] = $keyword;
        }
        if ($category !== '') {
            $sql .= ' AND z.category = :category';
            $parameters['category'] = $category;
        }
        if ($tag !== '') {
            $sql .= ' AND EXISTS (SELECT 1 FROM zine_tag_links ztl JOIN zine_tags zt ON zt.id = ztl.tag_id WHERE ztl.zine_id = z.id AND zt.name = :tag)';
            $parameters['tag'] = $tag;
        }
        $sql .= ' ORDER BY ' . $order . ' LIMIT 40';
        $statement = $pdo->prepare($sql);
        $statement->execute($parameters);
        respond(['items' => $statement->fetchAll()]);
    } catch (Throwable $error) {
        error_log('YOHaku zines query error: ' . $error->getMessage());
        respond(['error' => 'ZINE一覧を取得できませんでした', 'code' => 'ZINE_QUERY_FAILED'], 500);
    }
}

if ($action === 'categories' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $statement = $pdo->query("SELECT category AS name, COUNT(*) AS count FROM zines WHERE status = 'published' GROUP BY category ORDER BY count DESC, name");
    respond(['items' => $statement->fetchAll()]);
}

if ($action === 'tags' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $statement = $pdo->query("SELECT t.name, COUNT(*) AS count FROM zine_tags t JOIN zine_tag_links l ON l.tag_id = t.id JOIN zines z ON z.id = l.zine_id WHERE z.status = 'published' GROUP BY t.id ORDER BY count DESC, t.name");
    respond(['items' => $statement->fetchAll()]);
}

if ($action === 'ranking' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $type = (string) ($_GET['type'] ?? 'zine');
    if ($type === 'author') {
        $statement = $pdo->query("SELECT u.id, u.display_name AS author, COALESCE(SUM(z.view_count), 0) AS views FROM zine_users u JOIN zines z ON z.author_id = u.id WHERE z.status = 'published' GROUP BY u.id ORDER BY views DESC LIMIT 20");
    } elseif ($type === 'favorite') {
        $statement = $pdo->query("SELECT z.id, z.title, z.cover_path, z.favorite_count AS favorites, z.view_count AS views, u.display_name AS author FROM zines z JOIN zine_users u ON u.id = z.author_id WHERE z.status = 'published' ORDER BY z.favorite_count DESC, z.view_count DESC LIMIT 20");
    } else {
        $statement = $pdo->query("SELECT z.id, z.title, z.cover_path, z.view_count AS views, u.display_name AS author FROM zines z JOIN zine_users u ON u.id = z.author_id WHERE z.status = 'published' ORDER BY z.view_count DESC LIMIT 20");
    }
    respond(['items' => $statement->fetchAll()]);
}

http_response_code(404);
echo json_encode(['error' => 'Unknown action'], JSON_UNESCAPED_UNICODE);
