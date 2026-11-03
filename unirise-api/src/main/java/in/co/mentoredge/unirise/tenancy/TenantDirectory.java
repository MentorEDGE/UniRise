package in.co.mentoredge.unirise.tenancy;

import java.util.Optional;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** Reads the control plane: which tenants exist and where their databases are. */
@Component
public class TenantDirectory {
	private static final String SELECT = """
		SELECT i.id, i.slug, i.status, i.db_host, i.db_port, i.db_name, i.db_user, s.db_password
		FROM institution i JOIN institution_secret s ON s.institution_id = i.id""";
	private final JdbcClient control;

	public TenantDirectory(@Qualifier("controlJdbc") JdbcClient control) { this.control = control; }

	public Optional<TenantInfo> bySlug(String slug) {
		return control.sql(SELECT + " WHERE i.slug = :slug").param("slug", slug).query(TenantDirectory::map).optional();
	}

	public Optional<TenantInfo> byKeyHash(String keyHash) {
		return control.sql(SELECT + " JOIN institution_credential c ON c.institution_id = i.id WHERE c.key_hash = :h AND c.revoked_at IS NULL")
			.param("h", keyHash).query(TenantDirectory::map).optional();
	}

	public java.util.List<TenantInfo> all() {
		return control.sql(SELECT + " WHERE i.status NOT IN ('provisioning','closed') ORDER BY i.slug").query(TenantDirectory::map).list();
	}

	private static TenantInfo map(java.sql.ResultSet r, int n) throws java.sql.SQLException {
		return new TenantInfo(r.getLong("id"), r.getString("slug"), r.getString("status"), r.getString("db_host"), r.getInt("db_port"),
			r.getString("db_name"), r.getString("db_user"), r.getString("db_password"));
	}
}
