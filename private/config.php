<?php
// This file must stay outside the public web directory.
return [
    'db' => [
        'dsn' => 'mysql:host=mysql403.phy.lolipop.lan;dbname=LAA1475494-mkazu;charset=utf8mb4',
        'user' => '書き換え',
        'password' => '書き換え',
    ],
    'app' => [
        'base_url' => 'https://mkazu.hiho.jp/zinesite/yohaku',
        'mail_from' => 'noreply@mkazu.hiho.jp',
    ],
    'allowed_admin_ips' => ['127.0.0.1', '::1'],
];
