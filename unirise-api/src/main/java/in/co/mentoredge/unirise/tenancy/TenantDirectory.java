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
	private final String jdbcParams;

	public TenantDirectory(@Qualifier("controlJdbc") JdbcClient control, AppProperties props) {
		this.control = control;
		this.jdbcParams = props.tenants().jdbcParams();
	}

	public Optional<TenantInfo> bySlug(String slug) {
		return control.sql(SELECT + " WHERE i.slug = :slug").param("slug", slug).query(this::map).optional();
	}

	public Optional<TenantInfo> byKeyHash(String keyHash) {
		return control.sql(SELECT + " JOIN institution_credential c ON c.institution_id = i.id WHERE c.key_hash = :h AND c.revoked_at IS NULL")
			.param("h", keyHash).query(this::map).optional();
	}

	public record TokenHit(TenantInfo tenant, long userId) {}

	/** A live token of the given kind; an invitation token is marked used by the caller. */
	public Optional<TokenHit> byToken(String tokenHash, String kind) {
		return control.sql(SELECT + " JOIN user_token t ON t.institution_id = i.id WHERE t.token_hash = :h AND t.kind = :k AND t.expires_at > now() AND (t.kind = 'session' OR t.used_at IS NULL)")
			.param("h", tokenHash).param("k", kind)
			.query((r, n) -> new TokenHit(map(r, n), 0)).optional()
			.map(h -> new TokenHit(h.tenant(), control.sql("SELECT app_user_id FROM user_token WHERE token_hash = :h").param("h", tokenHash).query(Long.class).single()));
	}

	public java.util.List<TenantInfo> all() {
		return control.sql(SELECT + " WHERE i.status NOT IN ('provisioning','closed') ORDER BY i.slug").query(this::map).list();
	}

	private TenantInfo map(java.sql.ResultSet r, int n) throws java.sql.SQLException {
		return new TenantInfo(r.getLong("id"), r.getString("slug"), r.getString("status"), r.getString("db_host"), r.getInt("db_port"),
			r.getString("db_name"), r.getString("db_user"), r.getString("db_password"), jdbcParams);
	}
}
