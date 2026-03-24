FROM hugomods/hugo:exts-0.124.1

WORKDIR /src

COPY docker/hugo/init.sh /init.sh
RUN chmod +x /init.sh

ENTRYPOINT ["/init.sh"]
