FROM hugomods/hugo:exts-0.124.1

WORKDIR /src

RUN apk add --no-cache git

COPY docker/hugo/init.sh /init.sh
RUN chmod +x /init.sh

ENTRYPOINT ["/init.sh"]
