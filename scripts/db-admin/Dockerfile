FROM postgres:16-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends awscli ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --chmod=755 scripts/db-admin/entrypoint.sh /usr/local/bin/unirise-db-admin
COPY --chmod=755 scripts/tenant-backup.sh scripts/restore-drill.sh /scripts/
USER postgres
ENTRYPOINT ["/usr/local/bin/unirise-db-admin"]
