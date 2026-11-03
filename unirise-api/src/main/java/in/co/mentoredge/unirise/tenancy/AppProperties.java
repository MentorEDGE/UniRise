package in.co.mentoredge.unirise.tenancy;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("app")
public record AppProperties(Control control, Tenants tenants, String adminKey) {
	public record Control(String url, String user, String password) {}

	public record Tenants(String host, int port, int maxPoolSize, int maxOpenPools, int migrateConcurrency) {}
}
