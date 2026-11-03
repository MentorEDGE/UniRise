package in.co.mentoredge.unirise.tenancy;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;

@Configuration
@EnableConfigurationProperties(AppProperties.class)
public class DataSourceConfig {

	@Bean(destroyMethod = "close")
	HikariDataSource controlDataSource(AppProperties p) {
		HikariConfig c = new HikariConfig();
		c.setPoolName("control");
		c.setJdbcUrl(p.control().url());
		c.setUsername(p.control().user());
		c.setPassword(p.control().password());
		c.setMaximumPoolSize(5);
		return new HikariDataSource(c);
	}

	@Bean
	JdbcClient controlJdbc(@Qualifier("controlDataSource") DataSource ds) {
		Flyway.configure().dataSource(ds).locations("classpath:db/control").load().migrate();
		return JdbcClient.create(ds);
	}

	@Bean
	TenantRoutingDataSource tenantDataSource(TenantDirectory directory, AppProperties p) {
		return new TenantRoutingDataSource(directory, p.tenants().maxPoolSize(), p.tenants().maxOpenPools());
	}

	/** The only way code reaches tenant data; every call goes through TenantContext. */
	@Bean
	JdbcClient tenantJdbc(TenantRoutingDataSource ds) { return JdbcClient.create(ds); }
}
