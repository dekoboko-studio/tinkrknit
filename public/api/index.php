<?php
declare(strict_types=1);

/**
 * JSON front controller.
 *
 * Routes:  /api/<resource>            GET (list)  POST (create)
 *          /api/<resource>/<id>       GET  PUT/PATCH  DELETE
 *          /api/ping                  GET  health + schema check
 *
 * Works with or without URL rewriting. Without rewriting, call
 * api/index.php?r=projects/12 - see public/js/api.js which builds both forms.
 */

use Knit\ApiError;
use Knit\Config;
use Knit\Db;
use Knit\Resources;

spl_autoload_register(static function (string $class): void {
    $prefix = 'Knit\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $file = dirname(__DIR__, 2) . '/src/' . str_replace('\\', '/', $relative) . '.php';
    if (is_readable($file)) {
        require_once $file;
    }
});

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/** @param mixed $data */
function respond($data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode(
        $status >= 400 ? ['ok' => false, 'error' => $data] : ['ok' => true, 'data' => $data],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );
    exit;
}

function requestBody(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if (trim($raw) === '') {
        return [];
    }
    try {
        $decoded = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        throw new ApiError('Malformed JSON body: ' . $e->getMessage(), 400);
    }
    return is_array($decoded) ? $decoded : [];
}

try {
    // Prefer PATH_INFO, fall back to ?r= for servers without rewriting.
    $path   = $_SERVER['PATH_INFO'] ?? ($_GET['r'] ?? '');
    $parts  = array_values(array_filter(explode('/', trim((string) $path, '/')), 'strlen'));
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    $storage = Config::storage();

    if ($parts === [] || $parts[0] === 'ping') {
        if ($storage === 'server') {
            Db::conn();
        }
        respond([
            'php'       => PHP_VERSION,
            'storage'   => $storage,
            'resources' => $storage === 'server' ? array_keys(Resources::map()) : [],
        ]);
    }

    $name = $parts[0];
    $map  = Resources::map();
    if (!isset($map[$name])) {
        throw new ApiError("Unknown resource '$name'", 404);
    }
    // In browser mode the personal library is each visitor's own; a public
    // server that answered here would be free storage for anyone (Config.php).
    if ($storage !== 'server' && in_array($name, Resources::PERSONAL, true)) {
        throw new ApiError("This server keeps $name in the browser, not on the server", 403);
    }
    $repo = $map[$name];
    $id   = isset($parts[1]) ? (int) $parts[1] : null;

    switch ($method) {
        case 'GET':
            if ($id === null) {
                respond($repo->list($_GET));
            }
            $row = $repo->find($id);
            respond($row ?? "No $name with id $id", $row === null ? 404 : 200);

            // respond() exits; no break needed but kept for static analyzers
        case 'POST':
            respond($repo->create(requestBody()), 201);

        case 'PUT':
        case 'PATCH':
            if ($id === null) {
                throw new ApiError('Update requires an id', 400);
            }
            $row = $repo->update($id, requestBody());
            respond($row ?? "No $name with id $id", $row === null ? 404 : 200);

        case 'DELETE':
            if ($id === null) {
                throw new ApiError('Delete requires an id', 400);
            }
            respond(['deleted' => $repo->delete($id)]);

        default:
            throw new ApiError("Method $method not allowed", 405);
    }
} catch (ApiError $e) {
    respond($e->getMessage(), $e->status());
} catch (Throwable $e) {
    respond($e->getMessage(), 500);
}
