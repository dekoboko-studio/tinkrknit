<?php
declare(strict_types=1);

namespace Knit;

use PDO;
use RuntimeException;

/**
 * SQLite connection holder. Creates and migrates the database on first use so
 * there is no separate install step - see CLAUDE.md section 2.
 */
final class Db
{
    private static ?PDO $pdo = null;

    public static function conn(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $root = dirname(__DIR__);
        $dir  = $root . '/data';

        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException("Cannot create data directory: $dir");
        }
        if (!is_writable($dir)) {
            throw new RuntimeException("Data directory is not writable: $dir");
        }

        $file  = $dir . '/knit.sqlite';
        $fresh = !file_exists($file);

        $pdo = new PDO('sqlite:' . $file, null, null, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        $pdo->exec('PRAGMA foreign_keys = ON');

        // Schema is idempotent (CREATE TABLE IF NOT EXISTS), so running it on
        // every boot is cheap and keeps new tables appearing without a migration
        // runner. Revisit if the schema ever needs destructive changes.
        $schema = $root . '/schema.sql';
        if (is_readable($schema)) {
            $pdo->exec((string) file_get_contents($schema));
        } elseif ($fresh) {
            throw new RuntimeException("Missing schema.sql at $schema");
        }

        return self::$pdo = $pdo;
    }

    /** @param array<string,mixed> $params @return array<int,array<string,mixed>> */
    public static function all(string $sql, array $params = []): array
    {
        $st = self::conn()->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    /** @param array<string,mixed> $params @return array<string,mixed>|null */
    public static function one(string $sql, array $params = []): ?array
    {
        $st = self::conn()->prepare($sql);
        $st->execute($params);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    /** @param array<string,mixed> $params */
    public static function run(string $sql, array $params = []): int
    {
        $st = self::conn()->prepare($sql);
        $st->execute($params);
        return $st->rowCount();
    }

    /** @param array<string,mixed> $params */
    public static function insert(string $sql, array $params = []): int
    {
        self::run($sql, $params);
        return (int) self::conn()->lastInsertId();
    }
}
