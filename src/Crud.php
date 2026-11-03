<?php
declare(strict_types=1);

namespace Knit;

/**
 * Generic table CRUD driven by a column whitelist.
 *
 * Adding a new resource to the API should mean adding one entry to
 * Resources::map() and nothing else. Columns not in $cols are ignored on write,
 * which is what keeps this safe to interpolate into SQL - callers never choose
 * identifiers.
 */
final class Crud
{
    /**
     * @param list<string> $cols     writable columns, in any order
     * @param list<string> $jsonCols subset of $cols stored as JSON text
     */
    public function __construct(
        private string $table,
        private array $cols,
        private array $jsonCols = [],
        private string $orderBy = 'id DESC',
        private array $listCols = ['*']
    ) {
    }

    /** @return list<array<string,mixed>> */
    public function list(array $query = []): array
    {
        $sel   = implode(', ', $this->listCols);
        $where = '';
        $args  = [];

        if (isset($query['q']) && $query['q'] !== '') {
            $where  = ' WHERE name LIKE :q';
            $args[':q'] = '%' . $query['q'] . '%';
        }

        // Archiving is a soft delete, so the default listing has to be able to
        // leave archived rows out without the caller naming a column.
        if (isset($query['archived']) && $this->hasColumn('archived')) {
            $clause = 'archived = :archived';
            $where  = $where === '' ? " WHERE $clause" : "$where AND $clause";
            $args[':archived'] = (int) $query['archived'];
        }

        $limit = isset($query['limit']) ? max(1, min(500, (int) $query['limit'])) : 200;

        $rows = Db::all(
            "SELECT $sel FROM {$this->table}{$where} ORDER BY {$this->orderBy} LIMIT $limit",
            $args
        );
        return array_map([$this, 'decode'], $rows);
    }

    public function find(int $id): ?array
    {
        $row = Db::one("SELECT * FROM {$this->table} WHERE id = :id", [':id' => $id]);
        return $row === null ? null : $this->decode($row);
    }

    public function create(array $in): array
    {
        $data = $this->encode($in);
        if ($data === []) {
            throw new ApiError('No writable fields supplied', 422);
        }
        $names  = array_keys($data);
        $cols   = implode(', ', $names);
        $binds  = implode(', ', array_map(static fn($c) => ':' . $c, $names));
        $params = [];
        foreach ($data as $k => $v) {
            $params[':' . $k] = $v;
        }

        $id = Db::insert("INSERT INTO {$this->table} ($cols) VALUES ($binds)", $params);
        return $this->find($id) ?? throw new ApiError('Insert succeeded but row vanished', 500);
    }

    public function update(int $id, array $in): ?array
    {
        if ($this->find($id) === null) {
            return null;
        }
        $data = $this->encode($in);
        if ($data !== []) {
            $sets   = [];
            $params = [':id' => $id];
            foreach ($data as $k => $v) {
                $sets[]          = "$k = :$k";
                $params[':' . $k] = $v;
            }
            if ($this->hasColumn('updated_at')) {
                $sets[] = "updated_at = datetime('now')";
            }
            Db::run(
                "UPDATE {$this->table} SET " . implode(', ', $sets) . ' WHERE id = :id',
                $params
            );
        }
        return $this->find($id);
    }

    public function delete(int $id): bool
    {
        return Db::run("DELETE FROM {$this->table} WHERE id = :id", [':id' => $id]) > 0;
    }

    private function hasColumn(string $name): bool
    {
        static $cache = [];
        if (!isset($cache[$this->table])) {
            $cache[$this->table] = array_column(
                Db::all("PRAGMA table_info({$this->table})"),
                'name'
            );
        }
        return in_array($name, $cache[$this->table], true);
    }

    /** Keep only whitelisted columns; JSON-encode the ones declared as JSON. */
    private function encode(array $in): array
    {
        $out = [];
        foreach ($this->cols as $col) {
            if (!array_key_exists($col, $in)) {
                continue;
            }
            $v = $in[$col];
            $out[$col] = in_array($col, $this->jsonCols, true)
                ? json_encode($v, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)
                : $v;
        }
        return $out;
    }

    private function decode(array $row): array
    {
        foreach ($this->jsonCols as $col) {
            if (isset($row[$col]) && is_string($row[$col])) {
                $row[$col] = json_decode($row[$col], true) ?? $row[$col];
            }
        }
        if (isset($row['id'])) {
            $row['id'] = (int) $row['id'];
        }
        return $row;
    }
}
