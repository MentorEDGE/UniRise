package in.co.mentoredge.unirise.tenancy;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HexFormat;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Creates a tenant: control-plane row, dedicated database and login, schema, starter row, API key.
 * Re-running for a tenant stuck in 'provisioning' resumes it; an existing tenant is a 409.
 */
@Component
public class Provisioner {
	public record Created(String slug, String apiKey) {}

	private static final SecureRandom RANDOM = new SecureRandom();
	private final JdbcClient control;
	private final TenantDirectory directory;
	private final Migrator migrator;
	private final AppProperties props;

	public Provisioner(@Qualifier("controlJdbc") JdbcClient control, TenantDirectory directory, Migrator migrator, AppProperties props) {
		this.control = control;
		this.directory = directory;
		this.migrator = migrator;
		this.props = props;
	}

	public Created provision(String slug, String name) {
		if (slug == null || !slug.matches("[a-z][a-z0-9_]{2,30}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "slug");
		if (name == null || name.isBlank() || name.length() > 200) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "name");
		String db = "tenant_" + slug, role = "app_" + slug;   // slug is validated above, so quoting these identifiers is safe
		String password = randomHex(24);

		var existing = control.sql("SELECT status FROM institution WHERE slug = :s").param("s", slug).query(String.class).optional();
		if (existing.isPresent() && !existing.get().equals("provisioning")) throw new ResponseStatusException(HttpStatus.CONFLICT, "exists");

		long id = control.sql("""
			INSERT INTO institution(slug, name, db_host, db_port, db_name, db_user) VALUES (:s, :n, :h, :p, :d, :u)
			ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id""")
			.param("s", slug).param("n", name).param("h", props.tenants().host()).param("p", props.tenants().port())
			.param("d", db).param("u", role).query(Long.class).single();

		boolean roleExists = control.sql("SELECT count(*) FROM pg_roles WHERE rolname = :r").param("r", role).query(Long.class).single() > 0;
		control.sql((roleExists ? "ALTER ROLE \"" + role + "\" LOGIN PASSWORD '" + password + "'" : "CREATE ROLE \"" + role + "\" LOGIN PASSWORD '" + password + "'")).update();
		control.sql("GRANT \"" + role + "\" TO CURRENT_USER").update(); // lets a non-superuser (RDS master) create a database owned by the role
		control.sql("INSERT INTO institution_secret(institution_id, db_password) VALUES (:i, :p) ON CONFLICT (institution_id) DO UPDATE SET db_password = EXCLUDED.db_password")
			.param("i", id).param("p", password).update();

		boolean dbExists = control.sql("SELECT count(*) FROM pg_database WHERE datname = :d").param("d", db).query(Long.class).single() > 0;
		if (!dbExists) control.sql("CREATE DATABASE \"" + db + "\" OWNER \"" + role + "\"").update();
		control.sql("REVOKE ALL ON DATABASE \"" + db + "\" FROM PUBLIC").update(); // no other tenant's login can even connect

		TenantInfo t = directory.bySlug(slug).orElseThrow();
		Migrator.Result m = migrator.migrate(t);
		if (!m.ok()) throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "migration");
		try (var c = java.sql.DriverManager.getConnection(t.jdbcUrl(), t.user(), t.password());
			 var st = c.prepareStatement("INSERT INTO institution(name) VALUES (?) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name")) {
			st.setString(1, name);
			st.executeUpdate();
		} catch (java.sql.SQLException e) {
			throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "seed");
		}

		String apiKey = randomHex(32);
		control.sql("INSERT INTO institution_credential(institution_id, key_hash) VALUES (:i, :h)").param("i", id).param("h", hash(apiKey)).update();
		control.sql("UPDATE institution SET status = 'sandbox' WHERE id = :i").param("i", id).update();
		control.sql("INSERT INTO platform_access_log(actor, action, institution_id) VALUES ('platform', 'tenant.provision', :i)").param("i", id).update();
		return new Created(slug, apiKey);
	}

	public static String randomHex(int bytes) {
		byte[] b = new byte[bytes];
		RANDOM.nextBytes(b);
		return HexFormat.of().formatHex(b);
	}

	public static String hash(String key) {
		try {
			return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(key.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
		} catch (java.security.NoSuchAlgorithmException e) {
			throw new IllegalStateException(e);
		}
	}
}
