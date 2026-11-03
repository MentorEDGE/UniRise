package in.co.mentoredge.unirise.tenancy;

import java.io.IOException;
import java.io.OutputStream;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.postgresql.PGConnection;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Suspend, export, delete and meter tenants (TRD 9a, MULTI_TENANCY_DESIGN.md 8). Every action is written to platform_access_log. */
@Component
public class TenantLifecycle {
	public record Summary(String slug, String name, String status, String plan, String schemaVersion, java.time.OffsetDateTime createdAt) {}
	public record Usage(String slug, java.time.LocalDate month, int activeResearchers) {}

	private static final Set<String> SETTABLE = Set.of("sandbox", "pilot", "active", "suspended", "closing");
	private final JdbcClient control;
	private final TenantDirectory directory;
	private final TenantRoutingDataSource routing;
	private final AppProperties props;

	public TenantLifecycle(@Qualifier("controlJdbc") JdbcClient control, TenantDirectory directory, TenantRoutingDataSource routing, AppProperties props) {
		this.control = control;
		this.directory = directory;
		this.routing = routing;
		this.props = props;
	}

	public List<Summary> list() {
		return control.sql("SELECT slug, name, status, plan, schema_version, created_at FROM institution ORDER BY slug").query(Summary.class).list();
	}

	private record Row(long id, String status, String dbName, String dbUser) {}

	private Row row(String slug) {
		return control.sql("SELECT id, status, db_name, db_user FROM institution WHERE slug = :s").param("s", slug).query(Row.class).optional()
			.orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
	}

	public void log(String action, Long institutionId, String reason) {
		control.sql("INSERT INTO platform_access_log(actor, action, institution_id, reason) VALUES ('platform', :a, :i, :r)").param("a", action).param("i", institutionId).param("r", reason).update();
	}

	/** Sandbox, pilot and active are plan stages; suspended blocks sign-in; closing starts the exit and retention clock. */
	public void setStatus(String slug, String status, String reason) {
		if (status == null || !SETTABLE.contains(status)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "status");
		if (reason == null || reason.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "reason");
		Row r = row(slug);
		if (r.status().equals("closed") || r.status().equals("provisioning")) throw new ResponseStatusException(HttpStatus.CONFLICT, "status");
		control.sql("UPDATE institution SET status = :s, closing_since = CASE WHEN :s = 'closing' THEN COALESCE(closing_since, now()) ELSE NULL END WHERE id = :i").param("s", status).param("i", r.id()).update();
		routing.evict(slug);
		log("tenant.status." + status, r.id(), reason);
	}

	/** Every tenant table as a CSV file inside a zip: the contract-exit export in an open format. */
	public void export(String slug, String reason, OutputStream out) throws IOException {
		Row r = row(slug);
		if (r.status().equals("closed") || r.status().equals("provisioning")) throw new ResponseStatusException(HttpStatus.CONFLICT, "status");
		TenantInfo t = directory.bySlug(slug).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
		log("tenant.export", r.id(), reason);
		try (Connection c = DriverManager.getConnection(t.jdbcUrl(), t.user(), t.password()); ZipOutputStream zip = new ZipOutputStream(out)) {
			List<String> tables = new ArrayList<>();
			try (var st = c.createStatement(); var rs = st.executeQuery("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'flyway_schema_history' ORDER BY 1")) {
				while (rs.next()) tables.add(rs.getString(1));
			}
			for (String table : tables) {   // names come from the catalog, not from a request
				zip.putNextEntry(new ZipEntry(table + ".csv"));
				c.unwrap(PGConnection.class).getCopyAPI().copyOut("COPY (SELECT * FROM \"" + table + "\") TO STDOUT WITH (FORMAT csv, HEADER true)", zip);
				zip.closeEntry();
			}
		} catch (SQLException e) {
			throw new IllegalStateException("export failed", e);
		}
	}

	/** Drops the database and login after the retention period. The institution row stays so the slug is never reused. */
	public void delete(String slug, String confirm) {
		if (!slug.equals(confirm)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "confirm");
		Row r = row(slug);
		if (!r.status().equals("closing")) throw new ResponseStatusException(HttpStatus.CONFLICT, "not closing");
		boolean waited = control.sql("SELECT closing_since <= now() - make_interval(days => :d) FROM institution WHERE id = :i").param("d", props.tenants().retentionDays()).param("i", r.id()).query(Boolean.class).single();
		if (!waited) throw new ResponseStatusException(HttpStatus.CONFLICT, "retention period not over");
		routing.evict(slug);
		control.sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :d AND pid <> pg_backend_pid()").param("d", r.dbName()).query().listOfRows();
		control.sql("DROP DATABASE \"" + r.dbName() + "\"").update();   // names were validated when the tenant was provisioned
		control.sql("DROP ROLE \"" + r.dbUser() + "\"").update();
		control.sql("DELETE FROM institution_secret WHERE institution_id = :i").param("i", r.id()).update();
		control.sql("DELETE FROM user_token WHERE institution_id = :i").param("i", r.id()).update();
		control.sql("UPDATE institution_credential SET revoked_at = now() WHERE institution_id = :i AND revoked_at IS NULL").param("i", r.id()).update();
		control.sql("UPDATE institution SET status = 'closed', closed_at = now() WHERE id = :i").param("i", r.id()).update();
		log("tenant.delete", r.id(), "database " + r.dbName() + " dropped");
	}

	/** Monthly active researchers (people with a current appointment) per live tenant. */
	public List<Usage> refreshUsage() {
		for (TenantInfo t : directory.all()) {
			try (Connection c = DriverManager.getConnection(t.jdbcUrl(), t.user(), t.password());
				 var st = c.createStatement();
				 var rs = st.executeQuery("SELECT count(DISTINCT researcher_id) FROM appointment WHERE valid_from <= current_date AND (valid_to IS NULL OR valid_to >= current_date)")) {
				rs.next();
				control.sql("""
					INSERT INTO usage_counter(institution_id, month, active_researchers) VALUES (:i, date_trunc('month', current_date), :n)
					ON CONFLICT (institution_id, month) DO UPDATE SET active_researchers = EXCLUDED.active_researchers""").param("i", t.id()).param("n", rs.getInt(1)).update();
			} catch (SQLException e) {
				log("usage.failed", t.id(), e.getClass().getSimpleName());
			}
		}
		return usage();
	}

	public List<Usage> usage() {
		return control.sql("SELECT i.slug, u.month, u.active_researchers FROM usage_counter u JOIN institution i ON i.id = u.institution_id ORDER BY u.month DESC, i.slug").query(Usage.class).list();
	}
}
