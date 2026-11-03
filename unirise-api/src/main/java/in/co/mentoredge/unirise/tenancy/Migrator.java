package in.co.mentoredge.unirise.tenancy;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.flywaydb.core.Flyway;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** Applies the tenant schema to every tenant database. One tenant failing never blocks the others. */
@Component
public class Migrator {
	public record Result(String slug, boolean ok, String version, String error) {}

	private final JdbcClient control;
	private final TenantDirectory directory;
	private final int concurrency;

	public Migrator(@Qualifier("controlJdbc") JdbcClient control, TenantDirectory directory, AppProperties props) {
		this.control = control;
		this.directory = directory;
		this.concurrency = props.tenants().migrateConcurrency();
	}

	public Result migrate(TenantInfo t) {
		long run = control.sql("INSERT INTO migration_run(institution_id, status) VALUES (:i, 'running') RETURNING id")
			.param("i", t.id()).query(Long.class).single();
		try {
			Flyway f = Flyway.configure().dataSource(t.jdbcUrl(), t.user(), t.password()).locations("classpath:db/tenant").load();
			f.migrate();
			String version = f.info().current().getVersion().toString();
			control.sql("UPDATE migration_run SET status='ok', to_version=:v, finished_at=now() WHERE id=:r").param("v", version).param("r", run).update();
			control.sql("UPDATE institution SET schema_version=:v WHERE id=:i").param("v", version).param("i", t.id()).update();
			return new Result(t.slug(), true, version, null);
		} catch (Exception e) {
			String msg = e.getClass().getSimpleName();
			control.sql("UPDATE migration_run SET status='failed', error=:e, finished_at=now() WHERE id=:r").param("e", msg + ": " + e.getMessage()).param("r", run).update();
			return new Result(t.slug(), false, null, msg);
		}
	}

	/** Deploy step. shortcut: no sandbox-first canary ordering yet, add it before the first paying tenant. */
	public List<Result> migrateAll() {
		ExecutorService pool = Executors.newFixedThreadPool(concurrency);
		try {
			List<Future<Result>> futures = new ArrayList<>();
			for (TenantInfo t : directory.all()) futures.add(pool.submit(() -> migrate(t)));
			List<Result> out = new ArrayList<>();
			for (Future<Result> f : futures) {
				try { out.add(f.get()); } catch (Exception e) { out.add(new Result("?", false, null, e.getClass().getSimpleName())); }
			}
			return out;
		} finally {
			pool.shutdown();
		}
	}
}
