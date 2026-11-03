# TinkrkniT, self-hosted.
#
#   docker build -t tinkrknit .
#   docker run -d -p 8080:80 -e KNIT_STORAGE=server -v tinkrknit-data:/var/www/app/data tinkrknit
#
# KNIT_STORAGE=server keeps one shared library in SQLite on the volume; leave
# it out (browser, the default) and each visitor's library stays in their own
# browser and the volume stays empty. See README.md.
#
# The official image already has pdo_sqlite. Only public/ is served; src/,
# schema.sql and data/ sit beside it, as in CLAUDE.md section 2.

FROM php:8.3-apache

ENV APACHE_DOCUMENT_ROOT=/var/www/app/public
RUN sed -ri 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' \
        /etc/apache2/sites-available/*.conf /etc/apache2/apache2.conf \
    && mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

WORKDIR /var/www/app
COPY public/ public/
COPY src/ src/
COPY schema.sql ./

RUN mkdir -p data && chown www-data:www-data data
VOLUME /var/www/app/data

EXPOSE 80
