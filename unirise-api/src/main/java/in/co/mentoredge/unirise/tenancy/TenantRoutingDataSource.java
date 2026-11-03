package in.co.mentoredge.unirise.tenancy;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.datasource.AbstractDataSource;

/**
 * Hands out connections to the current tenant's database only. One small pool per tenant, created on first use;
 * the least recently used pool is closed when the global cap is reached, so idle tenants hold no connections.
 */
public class TenantRoutingDataSource extends AbstractDataSource {
	private final TenantDirectory directory;
	private final int maxPoolSize;
	private final Map<String, HikariDataSource> pools;

	public TenantRoutingDataSource(TenantDirectory directory, int maxPoolSize, int maxOpenPools) {
		this.directory = directory;
		this.maxPoolSize = maxPoolSize;
		this.pools = new LinkedHashMap<>(16, 0.75f, true) {
			@Override
			protected boolean removeEldestEntry(Map.Entry<String, HikariDataSource> eldest) {
				if (size() <= maxOpenPools) return false;
				eldest.getValue().close();
				return true;
			}
		};
	}

	@Override
	public Connection getConnection() throws SQLException {
		return pool(TenantContext.require()).getConnection();
	}

	@Override
	public Connection getConnection(String username, String password) throws SQLException { return getConnection(); }

	private synchronized HikariDataSource pool(String slug) {
		HikariDataSource ds = pools.get(slug);
		if (ds != null && !ds.isClosed()) return ds;
		TenantInfo t = directory.bySlug(slug).orElseThrow(() -> new IllegalStateException("Unknown tenant"));
		if (!t.status().matches("sandbox|pilot|active")) throw new IllegalStateException("Tenant not available");
		HikariConfig c = new HikariConfig();
		c.setPoolName("tenant-" + slug);
		c.setJdbcUrl(t.jdbcUrl());
		c.setUsername(t.user());
		c.setPassword(t.password());
		c.setMaximumPoolSize(maxPoolSize);
		c.setMinimumIdle(0);
		c.setIdleTimeout(120_000);
		ds = new HikariDataSource(c);
		pools.put(slug, ds);
		return ds;
	}

	/** Drops a tenant's pool, for suspend, restore or credential change. */
	public synchronized void evict(String slug) {
		HikariDataSource ds = pools.remove(slug);
		if (ds != null) ds.close();
	}

	public synchronized int openPools() { return pools.size(); }
}
