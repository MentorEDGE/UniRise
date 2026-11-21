package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.AppProperties;
import java.util.Collection;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;

/**
 * Removes record files that no entry refers to any more: a file replaced or removed on an entry, and the files of a
 * deleted draft (QA finding 2026-11-20: they stayed in the uploads bucket for ever). A key still attached to another
 * entry is kept. The bucket keeps deleted versions for 30 days (lifecycle rule), so a mistake can be undone. Never
 * throws: the entry is already saved, and a file that could not be removed only takes space.
 * <p>
 * {@link #sweep()} also removes files uploaded on a form that was then abandoned (never saved on any entry): every few
 * hours, any file older than a day that no entry of its institution uses is deleted (QA follow-up 2026-11-21).
 */
@Component
public class UploadCleanup {
	private static final Logger log = LoggerFactory.getLogger(UploadCleanup.class);
	private final JdbcClient db;
	private final AppProperties props;
	private final S3Client s3;
	private final in.co.mentoredge.unirise.tenancy.TenantDirectory directory;
	/** A file younger than this may still be on a form being filled in. */
	static final java.time.Duration GRACE = java.time.Duration.ofHours(24);

	public UploadCleanup(@Qualifier("tenantJdbc") JdbcClient db, AppProperties props, Optional<S3Client> s3, in.co.mentoredge.unirise.tenancy.TenantDirectory directory) {
		this.db = db;
		this.props = props;
		this.s3 = s3.orElse(null);
		this.directory = directory;
	}

	/** Deletes abandoned uploads: files older than a day that no entry of their institution refers to. Returns how many. */
	@org.springframework.scheduling.annotation.Scheduled(initialDelay = 15 * 60_000, fixedDelay = 6 * 60 * 60_000)
	public int sweep() {
		if (s3 == null || props.uploads().bucket().isEmpty()) return 0;
		java.time.Instant cutoff = java.time.Instant.now().minus(GRACE);
		int removed = 0;
		try {
			for (var page : s3.listObjectsV2Paginator((l) -> l.bucket(props.uploads().bucket()))) {
				for (var o : page.contents()) {
					String key = o.key();
					if (!Records.FILE_KEY.matcher(key).matches() || o.lastModified().isAfter(cutoff)) continue;
					String slug = key.substring(0, key.indexOf('/'));
					var tenant = directory.bySlug(slug).filter((t) -> t.status().matches("sandbox|pilot|active"));
					if (tenant.isEmpty()) continue; // a suspended or closing institution keeps its files until it is deleted
					String before = in.co.mentoredge.unirise.tenancy.TenantContext.current();
					in.co.mentoredge.unirise.tenancy.TenantContext.set(slug);
					try {
						if (!used(key)) { s3.deleteObject((d) -> d.bucket(props.uploads().bucket()).key(key)); removed++; log.info("Removed an abandoned upload: {}", key); }
					} finally {
						if (before == null) in.co.mentoredge.unirise.tenancy.TenantContext.clear(); else in.co.mentoredge.unirise.tenancy.TenantContext.set(before);
					}
				}
			}
		} catch (RuntimeException e) {
			log.warn("Abandoned-upload sweep stopped: {}", e.getMessage());
		}
		return removed;
	}

	private boolean used(String key) {
		return db.sql("SELECT count(*) FROM record WHERE data->'attachments' @> CAST(:a AS jsonb)")
			.param("a", Json.write(java.util.List.of(java.util.Map.of("key", key)))).query(Long.class).single() > 0;
	}

	/** Deletes each key that is no longer attached to any entry of the current institution. */
	public void forget(Collection<String> keys) {
		if (s3 == null || props.uploads().bucket().isEmpty() || keys.isEmpty()) return;
		for (String key : keys) {
			if (key == null || !Records.FILE_KEY.matcher(key).matches()) continue;
			if (used(key)) continue;
			try {
				s3.deleteObject((d) -> d.bucket(props.uploads().bucket()).key(key));
				log.info("Removed a file no entry uses any more: {}", key);
			} catch (RuntimeException e) {
				log.warn("Could not remove unused file {}: {}", key, e.getMessage());
			}
		}
	}

	/** The file keys attached to a record in the UI's shape. */
	static java.util.Set<String> keysOf(java.util.Map<String, Object> record) {
		java.util.Set<String> out = new java.util.LinkedHashSet<>();
		if (record == null) return out;
		for (Object f : Json.arr(record.get("attachments"))) { String k = Json.str(Json.obj(f).get("key")); if (!k.isEmpty()) out.add(k); }
		return out;
	}
}
