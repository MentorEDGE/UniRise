package in.co.mentoredge.unirise.tenancy;

public record TenantInfo(long id, String slug, String status, String host, int port, String dbName, String user, String password, String jdbcParams) {
	public String jdbcUrl() { return "jdbc:postgresql://" + host + ":" + port + "/" + dbName + (jdbcParams == null || jdbcParams.isBlank() ? "" : "?" + jdbcParams); }
}
