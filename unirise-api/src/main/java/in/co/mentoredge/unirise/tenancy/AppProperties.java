package in.co.mentoredge.unirise.tenancy;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("app")
public record AppProperties(Control control, Tenants tenants, String adminKey, @DefaultValue Secrets secrets, @DefaultValue Uploads uploads) {
	public record Control(String url, String user, String password) {}

	/** Where institution database passwords live: "database" (local, tests) or "aws" (Secrets Manager, names prefix + slug). */
	public record Secrets(@DefaultValue("database") String store, @DefaultValue("unirise/local/tenant/") String prefix) {}

	/** Record files (A1b): the private S3 bucket. Empty: uploads are switched off and the UI keeps file names only. */
	public record Uploads(@DefaultValue("") String bucket, @DefaultValue("10485760") long maxBytes) {}

	public record Tenants(String host, int port, int maxPoolSize, int maxOpenPools, int migrateConcurrency, @DefaultValue("30") int retentionDays, @DefaultValue("") String jdbcParams) {}
}
