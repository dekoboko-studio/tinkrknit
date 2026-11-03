<?php
declare(strict_types=1);

namespace Knit;

/**
 * The API surface, declared in one place.
 *
 * To expose a new table: add the table to schema.sql and one entry here. The
 * router picks it up automatically - no new endpoint code.
 */
final class Resources
{
    /**
     * One person's library. Served only with `storage` = server (Config.php);
     * in browser mode public/js/localdb.js keeps the same tables in IndexedDB,
     * so mirror any column change there. Shared designs, when they come, are
     * public and do not belong in this list.
     */
    public const PERSONAL = ['projects', 'yarns', 'palettes', 'stamps', 'gauges'];

    /** @return array<string,Crud> */
    public static function map(): array
    {
        static $map = null;
        if ($map !== null) {
            return $map;
        }

        return $map = [
            // `doc` holds the whole design document and can be large, so the
            // list projection deliberately omits it. Fetch one project to edit.
            'projects' => new Crud(
                'projects',
                ['name', 'machine', 'tile_w', 'tile_h', 'panel_w', 'panel_h', 'doc', 'thumbnail'],
                ['doc'],
                'updated_at DESC',
                ['id', 'name', 'machine', 'tile_w', 'tile_h', 'panel_w', 'panel_h',
                 'thumbnail', 'created_at', 'updated_at']
            ),

            'yarns' => new Crud(
                'yarns',
                ['name', 'brand', 'color', 'fiber', 'weight', 'grams', 'notes', 'archived'],
                [],
                'name COLLATE NOCASE ASC'
            ),

            'palettes' => new Crud(
                'palettes',
                ['name', 'slots'],
                ['slots'],
                'created_at DESC'
            ),

            'stamps' => new Crud(
                'stamps',
                ['name', 'tags', 'w', 'h', 'cells', 'colors'],
                ['cells', 'colors'],
                'name COLLATE NOCASE ASC'
            ),

            'gauges' => new Crud(
                'gauges',
                ['name', 'yarn_note', 'tension', 'sts_per_10cm', 'rows_per_10cm'],
                [],
                'name COLLATE NOCASE ASC'
            ),
        ];
    }
}
