-- Execute with a MySQL admin account (root or equivalent)
CREATE DATABASE IF NOT EXISTS myoptiwealth CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'myoptiwealth'@'localhost' IDENTIFIED BY 'CHANGE_ME_STRONG_DB_PASSWORD';
GRANT ALL PRIVILEGES ON myoptiwealth.* TO 'myoptiwealth'@'localhost';
FLUSH PRIVILEGES;
