<?php
declare(strict_types=1);

namespace Knit;

/**
 * Server settings, from config.php beside src/ and the environment.
 *
 * `storage` says where projects, stamps and yarns live:
 *   browser  each visitor's own browser (IndexedDB); SQLite holds nothing personal
 *   server   SQLite in data/, one library for everyone who can reach this server
 *
 * Browser is the default on purpose. Nearly every PHP host has pdo_sqlite, so
 * guessing "server" from what is installed would turn a public site into one
 * library that every visitor can read, overwrite and delete. A self-hosted copy
 * that forgets the setting merely shows an empty library; data/ is untouched.
 *
 * KNIT_STORAGE in the environment wins over the file, for Docker.
 */
final class Config
{
    public const STORAGE_MODES = ['browser', 'server'];

    /** @return array<string,mixed> */
    private static function file(): array
    {
        static $config = null;
        if ($config !== null) {
            return $config;
        }
        $path = dirname(__DIR__) . '/config.php';
        $loaded = is_readable($path) ? require $path : [];
        return $config = is_array($loaded) ? $loaded : [];
    }

    public static function storage(): string
    {
        $value = getenv('KNIT_STORAGE');
        if ($value === false || $value === '') {
            $value = self::file()['storage'] ?? 'browser';
        }
        $value = strtolower(trim((string) $value));
        return in_array($value, self::STORAGE_MODES, true) ? $value : 'browser';
    }

    public static function serverStorage(): bool
    {
        return self::storage() === 'server';
    }
}
