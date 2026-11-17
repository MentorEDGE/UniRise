package in.co.mentoredge.unirise.tenancy;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.jdbc.core.simple.JdbcClient;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.ResourceNotFoundException;
import software.amazon.awssdk.services.secretsmanager.model.Tag;

/**
 * Where each institution's database password is kept, by institution slug (slugs are never reused).
 *
 * <ul>
 * <li>{@link Database}: the control-plane table {@code institution_secret}. Local runs and tests only.</li>
 * <li>{@link Aws}: AWS Secrets Manager, one secret per institution named {@code <prefix><slug>} (for example
 * {@code unirise/dev/tenant/abc}). Required before any real data (BACKEND_PLAN A2).</li>
 * <li>{@link Cached}: keeps passwords in memory for a few minutes, because every request looks its institution up.</li>
 * </ul>
 * No method ever logs or returns a password anywhere but to the caller that connects with it.
 */
public interface SecretStore {
	void put(String slug, String password);

	Optional<String> get(String slug);

	void delete(String slug);

	/** The control-plane table, keyed by the institution's id. */
	final class Database implements SecretStore {
		private final JdbcClient control;

		public Database(JdbcClient control) { this.control = control; }

		@Override public void put(String slug, String password) {
			control.sql("""
				INSERT INTO institution_secret(institution_id, db_password) SELECT id, :p FROM institution WHERE slug = :s
				ON CONFLICT (institution_id) DO UPDATE SET db_password = EXCLUDED.db_password""").param("s", slug).param("p", password).update();
		}

		@Override public Optional<String> get(String slug) {
			return control.sql("SELECT s.db_password FROM institution_secret s JOIN institution i ON i.id = s.institution_id WHERE i.slug = :s")
				.param("s", slug).query(String.class).optional();
		}

		@Override public void delete(String slug) {
			control.sql("DELETE FROM institution_secret WHERE institution_id = (SELECT id FROM institution WHERE slug = :s)").param("s", slug).update();
		}

		/** Institutions whose password is still in the table. */
		public List<String> slugs() {
			return control.sql("SELECT i.slug FROM institution_secret s JOIN institution i ON i.id = s.institution_id ORDER BY i.slug").query(String.class).list();
		}
	}

	/**
	 * AWS Secrets Manager. While existing passwords are being moved out of the table ({@link #moveFrom}), a password
	 * not yet in Secrets Manager is read from the table, so no request fails during the move.
	 */
	final class Aws implements SecretStore {
		private final SecretsManagerClient client;
		private final String prefix;
		private final Database legacy;

		public Aws(SecretsManagerClient client, String prefix, Database legacy) {
			if (!prefix.matches("^[A-Za-z0-9/_+=.@-]+/$")) throw new IllegalArgumentException("app.secrets.prefix must end with / (for example unirise/dev/tenant/)");
			this.client = client;
			this.prefix = prefix;
			this.legacy = legacy;
		}

		String name(String slug) { return prefix + slug; }

		@Override public void put(String slug, String password) {
			try {
				client.putSecretValue((b) -> b.secretId(name(slug)).secretString(password));
			} catch (ResourceNotFoundException missing) {
				client.createSecret((b) -> b.name(name(slug)).secretString(password).description("UniRise: database password of institution " + slug)
					.tags(Tag.builder().key("Project").value("UniRise").build(), Tag.builder().key("Institution").value(slug).build()));
			}
		}

		@Override public Optional<String> get(String slug) {
			try {
				return Optional.ofNullable(client.getSecretValue((b) -> b.secretId(name(slug))).secretString());
			} catch (ResourceNotFoundException missing) {
				return legacy.get(slug); // not moved yet
			}
		}

		/** The secret can still be restored for 7 days, in case an institution was deleted by mistake. */
		@Override public void delete(String slug) {
			try {
				client.deleteSecret((b) -> b.secretId(name(slug)).recoveryWindowInDays(7L));
			} catch (ResourceNotFoundException alreadyGone) {
				// nothing to delete
			}
			legacy.delete(slug);
		}

		public record Moved(int moved, int failed) {}

		/**
		 * Moves every password still in the table into Secrets Manager. Each is written, read back and compared before
		 * its table row is removed; a failure leaves that row in place (the institution keeps working) and is retried at
		 * the next start.
		 */
		public Moved moveFrom(Database table, org.slf4j.Logger log) {
			int moved = 0, failed = 0;
			for (String slug : table.slugs()) {
				try {
					String password = table.get(slug).orElseThrow();
					put(slug, password);
					String back = client.getSecretValue((b) -> b.secretId(name(slug))).secretString();
					if (!password.equals(back)) throw new IllegalStateException("read-back differs");
					table.delete(slug);
					moved++;
					log.info("Database password of institution {} moved to Secrets Manager ({})", slug, name(slug));
				} catch (RuntimeException e) {
					failed++;
					log.error("Could not move the database password of institution {} to Secrets Manager: {}", slug, e.getMessage());
				}
			}
			return new Moved(moved, failed);
		}
	}

	/** Keeps each password for a few minutes; a change through this store replaces the cached value at once. */
	final class Cached implements SecretStore {
		private record Entry(String password, Instant until) {}
		private final SecretStore store;
		private final Duration ttl;
		private final Map<String, Entry> cache = new ConcurrentHashMap<>();

		public Cached(SecretStore store, Duration ttl) { this.store = store; this.ttl = ttl; }

		public SecretStore inner() { return store; }

		@Override public void put(String slug, String password) {
			store.put(slug, password);
			cache.put(slug, new Entry(password, Instant.now().plus(ttl)));
		}

		@Override public Optional<String> get(String slug) {
			Entry e = cache.get(slug);
			if (e != null && e.until().isAfter(Instant.now())) return Optional.of(e.password());
			Optional<String> found = store.get(slug);
			found.ifPresentOrElse((p) -> cache.put(slug, new Entry(p, Instant.now().plus(ttl))), () -> cache.remove(slug));
			return found;
		}

		@Override public void delete(String slug) {
			store.delete(slug);
			cache.remove(slug);
		}
	}
}
