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
 * Creates a tenant: control-plane row, dedicated database and login, schema, starter row, API key, and (when an email is
 * given) the institution's first Office of Research account with a temporary password.
 * Re-running for a tenant stuck in 'provisioning' resumes it; an existing tenant is a 409.
 */
@Component
public class Provisioner {
	/** The API key and the temporary password are shown once; only their hashes are stored. */
	public record Created(String slug, String apiKey, String officeEmail, String temporaryPassword) {}

	private static final SecureRandom RANDOM = new SecureRandom();
	private final JdbcClient control;
	private final TenantDirectory directory;
	private final Migrator migrator;
	private final AppProperties props;

	private final SecretStore secrets;

	public Provisioner(@Qualifier("controlJdbc") JdbcClient control, TenantDirectory directory, Migrator migrator, AppProperties props, SecretStore secrets) {
		this.secrets = secrets;
		this.control = control;
		this.directory = directory;
		this.migrator = migrator;
		this.props = props;
	}

	public Created provision(String slug, String name) { return provision(slug, name, null, null); }

	public Created provision(String slug, String name, String officeEmail, String officeName) {
		if (slug == null || !slug.matches("[a-z][a-z0-9_]{2,30}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "slug");
		if (name == null || name.isBlank() || name.length() > 200) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "name");
		String email = officeEmail == null ? null : officeEmail.trim().toLowerCase();
		if (email != null && (!email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$") || email.length() > 200)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "officeEmail");
		if (email != null && control.sql("SELECT count(*) FROM account_login WHERE email = :e").param("e", email).query(Long.class).single() > 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "officeEmail");
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
		secrets.put(slug, password); // Secrets Manager on AWS; the control-plane table only for local runs and tests

		boolean dbExists = control.sql("SELECT count(*) FROM pg_database WHERE datname = :d").param("d", db).query(Long.class).single() > 0;
		if (!dbExists) control.sql("CREATE DATABASE \"" + db + "\" OWNER \"" + role + "\"").update();
		control.sql("REVOKE ALL ON DATABASE \"" + db + "\" FROM PUBLIC").update(); // no other tenant's login can even connect

		TenantInfo t = directory.bySlug(slug).orElseThrow();
		Migrator.Result m = migrator.migrate(t);
		if (!m.ok()) throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "migration");
		Long officeUserId = null;
		try (var c = java.sql.DriverManager.getConnection(t.jdbcUrl(), t.user(), t.password());
			 var st = c.prepareStatement("INSERT INTO institution(name) VALUES (?) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name")) {
			st.setString(1, name);
			st.executeUpdate();
			if (email != null) try (var u = c.prepareStatement("INSERT INTO app_user(email, role, name, designation, created_by) VALUES (?, 'office', ?, 'Office of Research', 'UniRise provisioning') RETURNING id")) {
				u.setString(1, email);
				u.setString(2, officeName == null || officeName.isBlank() ? "Office of Research, " + name : officeName.trim());
				try (var rs = u.executeQuery()) { rs.next(); officeUserId = rs.getLong(1); }
			}
		} catch (java.sql.SQLException e) {
			throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "seed");
		}
		String temporaryPassword = null;
		if (officeUserId != null) {
			temporaryPassword = in.co.mentoredge.unirise.api.Passwords.randomPassword();
			control.sql("INSERT INTO account_login(email, institution_id, app_user_id, password_hash, must_change_password) VALUES (:e, :i, :u, :h, true)")
				.param("e", email).param("i", id).param("u", officeUserId).param("h", in.co.mentoredge.unirise.api.Passwords.hash(temporaryPassword)).update();
		}

		String apiKey = randomHex(32);
		control.sql("INSERT INTO institution_credential(institution_id, key_hash) VALUES (:i, :h)").param("i", id).param("h", hash(apiKey)).update();
		control.sql("UPDATE institution SET status = 'sandbox' WHERE id = :i").param("i", id).update();
		control.sql("INSERT INTO platform_access_log(actor, action, institution_id) VALUES ('platform', 'tenant.provision', :i)").param("i", id).update();
		return new Created(slug, apiKey, email, temporaryPassword);
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
