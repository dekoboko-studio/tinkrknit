<?php
declare(strict_types=1);

/**
 * Single-page shell.
 *
 * There is no build step: the browser loads ES modules directly (CLAUDE.md 2).
 * The only thing PHP does here is fail loudly and early if the environment is
 * missing something, because a blank page with a console error is a much worse
 * first run than a sentence explaining what to install.
 *
 * The storage mode (src/Config.php) is written into the page as a meta tag, so
 * the client knows where the library lives before it makes a single request.
 * SQLite and data/ are only checked when this server keeps the library.
 */

$problems = [];

if (PHP_VERSION_ID < 80100) {
    $problems[] = 'PHP 8.1 or newer is required; this is ' . PHP_VERSION . '.';
}

require_once dirname(__DIR__) . '/src/Config.php';
$storage = \Knit\Config::storage();

if ($storage === 'server') {
    if (!extension_loaded('pdo_sqlite')) {
        $problems[] = 'The pdo_sqlite extension is not enabled. Uncomment extension=pdo_sqlite in php.ini.';
    }

    $dataDir = dirname(__DIR__) . '/data';
    if (!is_dir($dataDir) && !@mkdir($dataDir, 0777, true) && !is_dir($dataDir)) {
        $problems[] = 'Could not create the data/ directory next to public/. Create it and make it writable.';
    } elseif (is_dir($dataDir) && !is_writable($dataDir)) {
        $problems[] = 'The data/ directory is not writable, so projects cannot be saved.';
    }
}

/**
 * Cache busting with no build step. Every module's URL carries a hash of its
 * own contents, through an import map, so `import './core/bus.js'` resolves to
 * `js/core/bus.js?v=<hash>`. A deploy changes the URL of exactly the files that
 * changed, and no browser can pair a new main.js with a stale module from its
 * HTTP cache - which left a blank page until the cache was cleared. A content
 * hash rather than a mtime, because uploads that keep file times would leave
 * the URL unchanged.
 */
$asset = static fn (string $path): string =>
    $path . '?v=' . substr((string) @md5_file(__DIR__ . '/' . $path), 0, 10);

$imports = [];
$modules = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator(__DIR__ . '/js', FilesystemIterator::SKIP_DOTS)
);
foreach ($modules as $file) {
    if ($file->getExtension() !== 'js') continue;
    $path = 'js/' . str_replace('\\', '/', substr($file->getPathname(), strlen(__DIR__ . '/js/')));
    $imports['./' . $path] = './' . $asset($path);
}
ksort($imports);
$importMap = json_encode(['imports' => $imports], JSON_UNESCAPED_SLASHES | JSON_HEX_TAG);

// The page holds the map, so it must never be reused without asking.
header('Cache-Control: no-cache');
?>
<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="knit-storage" content="<?= htmlspecialchars($storage, ENT_QUOTES) ?>">
<meta name="theme-color" content="#1f1f1f">
<title>TinkrkniT</title>
<link rel="icon" type="image/png" href="img/logo-white-notxt.png">
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="img/icon-180.png">
<link rel="stylesheet" href="<?= htmlspecialchars($asset('css/app.css'), ENT_QUOTES) ?>">
<script type="importmap"><?= $importMap ?></script>
</head>
<body>

<?php if ($problems): ?>
<div class="boot-error">
  <h1>TinkrkniT cannot start</h1>
  <ul>
    <?php foreach ($problems as $problem): ?>
      <li><?= htmlspecialchars($problem, ENT_QUOTES) ?></li>
    <?php endforeach; ?>
  </ul>
  <p>Fix the above and reload. Nothing else on this page will work until then.</p>
</div>
<?php else: ?>

<div class="app">
  <header id="toolbar" class="toolbar"></header>

  <main class="workspace">
    <aside id="dock-left" class="dock dock-side"></aside>
    <div id="resize-left" class="resizer" title="Drag to resize"></div>

    <section class="stage">
      <div id="options-bar" class="options-bar"></div>
      <div class="grid-wrap">
        <canvas id="grid" class="grid-canvas"></canvas>
        <div id="view-controls" class="view-controls"></div>
      </div>
      <div id="dock-bottom" class="dock dock-bottom"></div>
    </section>

    <div id="resize-right" class="resizer" title="Drag to resize"></div>
    <aside id="dock-right" class="dock dock-side"></aside>
  </main>

  <footer id="statusbar" class="statusbar"></footer>
</div>

<!-- The knit screen (js/knit/screen.js) swaps in for the designer above. -->
<div id="knit" class="knit-app" hidden></div>

<noscript>
  <p class="boot-error">This is a JavaScript application. Enable JavaScript to use it.</p>
</noscript>

<script type="module" src="<?= htmlspecialchars($asset('js/main.js'), ENT_QUOTES) ?>"></script>
<?php foreach (\Knit\Config::scripts() as $script): ?>
<script type="module" src="<?= htmlspecialchars($script, ENT_QUOTES) ?>"></script>
<?php endforeach; ?>
<?php endif; ?>

</body>
</html>
