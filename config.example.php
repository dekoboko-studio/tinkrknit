<?php
// Copy to config.php (beside src/, outside the web root) and edit.
// config.php is not committed: it belongs to one server.

return [
    // Where projects, stamps and yarns are saved.
    //   'browser'  in each visitor's browser. Use this for a public site.
    //   'server'   in SQLite under data/, shared by everyone who can reach
    //              this server. Use this for your own or a household copy.
    // Leaving it out means 'browser'. The KNIT_STORAGE environment variable
    // overrides this file (see the Dockerfile).
    'storage' => 'server',
];
