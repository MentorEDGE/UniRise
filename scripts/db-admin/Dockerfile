FROM postgres:16-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends awscli ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/db-admin/entrypoint.sh /usr/local/bin/unirise-db-admin
COPY scripts/tenant-backup.sh scripts/restore-drill.sh /scripts/
# chmod as a step of its own, so the image builds with or without BuildKit
RUN chmod 755 /usr/local/bin/unirise-db-admin /scripts/tenant-backup.sh /scripts/restore-drill.sh
USER postgres
ENTRYPOINT ["/usr/local/bin/unirise-db-admin"]
