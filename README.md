# TinkrkniT

Colorwork design and knitting for electronic flatbed knitting machines. Draw a
Fair Isle, jacquard, slip-stitch or tuck pattern in the browser, check that it
will knit, then knit it straight from the page: on a Silver Reed or
Knitmaster electronic machine through a controller based on
[silver-reed-write](https://github.com/knitscape/silver-reed-write), or on a
Brother electronic machine fitted with an [AYAB](https://ayab-knitting.com)
interface. Only the Silver Reed SK840 has been tested so far.

## Installing

There are three ways to run TinkrkniT, all from the same code. Any of them
can also be installed as an app.

| Way | Who it suits | Where designs are saved |
|---|---|---|
| Use it online | Most people. Nothing to set up. | In your browser |
| Host it on a PHP server | Anyone with web hosting or a home server | Your choice |
| Docker | People who already run Docker | Your choice |

## Use it online

Open the site in Chrome or Edge. That's all you need to design.

**Installing it as an app** gives it its own window, a desktop or Start menu
shortcut, and lets it open without an internet connection:

- **Chrome or Edge:** click the install icon at the right of the address bar,
  or choose *File > Install TinkrkniT*.
- **Safari on a Mac (macOS 14 or later):** *File > Add to Dock*.

Once it's installed in Chrome or Edge, double-clicking a `.knitproj` file
opens it in TinkrkniT.

**Your designs are saved in your browser,** not on our server. To keep a copy
somewhere else, use the backup rows in the File menu:

- **Back up library** downloads one file with every project, stamp and yarn.
- **Back up to a folder** (Chrome and Edge) keeps a backup up to date in a
  folder you choose. Choose a folder inside OneDrive, Dropbox or iCloud and
  the copy is off your computer too.
- **Restore from backup** adds what's in a backup file to your library.

Safari deletes a site's saved data if you haven't visited it for about a
week. Add TinkrkniT to the Dock and keep a backup.

## Knitting needs Chrome or Edge

The Knit screen talks to the machine over USB using Web Serial. That works in
**Chrome, Edge and Firefox 151+** on a computer, and only when the page comes
from `https://`, `localhost` or `127.0.0.1`. Any browser can be used to
design; the Knit button shows a dot where knitting isn't available.

## Host it on a PHP server

Needs PHP 8.1 or newer. `pdo_sqlite` is needed only for server storage.

1. Download the zip of the latest release from
   <https://github.com/dekoboko-studio/tinkrknit/releases>, or clone it:
   `git clone https://github.com/dekoboko-studio/tinkrknit.git`
2. Point the web server's document root at `public/`. `src/`, `schema.sql`
   and `data/` stay beside it, outside the web root.
3. Choose where designs are saved: copy `config.example.php` to `config.php`
   and set `storage`:
   - `'browser'` (the default if there is no `config.php`): each visitor's
     designs stay in their own browser. Use this for anything public.
   - `'server'`: one library in `data/knit.sqlite`, shared by everyone who
     can reach the server. Use this for your own or a household copy, and
     make `data/` writable by the web server.

For a quick try on your own computer:

    php -S 127.0.0.1:8080 -t public

then open <http://127.0.0.1:8080>.

> **Server storage has no accounts or passwords.** Anyone who can open the
> page can see, change and delete every design on it. Keep a `'server'` copy
> on your own network, or behind a password your web server asks for.

## Docker

Docker builds straight from the repository, so there is nothing to download
first:

    docker build -t tinkrknit https://github.com/dekoboko-studio/tinkrknit.git
    docker run -d --name tinkrknit -p 8080:80 \
      -e KNIT_STORAGE=server \
      -v tinkrknit-data:/var/www/app/data \
      tinkrknit

Open <http://localhost:8080>. The volume keeps the library across updates.
Leave out `-e KNIT_STORAGE=server` to keep designs in each browser instead.
To build a particular release, add its tag to the URL:
`…/tinkrknit.git#v0.2.0`. From a clone, `docker build -t tinkrknit .` does
the same.

## Opening it from another computer

Knitting and installing as an app both need `https://`, `localhost` or
`127.0.0.1`. A copy opened by its network address, such as
`http://192.168.1.20:8080`, still lets you design but can't knit or be
installed. To use it from another computer, put it behind HTTPS (for example
Caddy, or a reverse proxy with a certificate), or open it on the computer
plugged into the machine.

## Updating

- **Online:** nothing to do. The app updates the next time it opens with a
  connection.
- **Self-hosted:** replace the files (or `git pull`), or rebuild the Docker
  image and recreate the container. Your `config.php` and `data/` are left
  alone.

Older design files always open in newer versions. A design made with a newer
version than yours says so instead of opening; update to open it.

## License

MIT, see [LICENSE](LICENSE). The TinkrkniT name and logo are not covered by
it: a modified version should have its own. Credits and third-party licenses
are in [NOTICE](NOTICE).
