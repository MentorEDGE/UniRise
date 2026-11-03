package in.co.mentoredge.unirise.tenancy;

/** The tenant of the current request or job. Set in one place (the filter or a job runner) and always cleared. */
public final class TenantContext {
	private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

	private TenantContext() {}

	public static void set(String slug) { CURRENT.set(slug); }

	public static void clear() { CURRENT.remove(); }

	/** Fails closed: any code path that reaches a tenant database without a tenant is a bug, not a default. */
	public static String require() {
		String slug = CURRENT.get();
		if (slug == null) throw new IllegalStateException("No tenant in context");
		return slug;
	}

	public static void run(String slug, Runnable job) {
		set(slug);
		try { job.run(); } finally { clear(); }
	}
}
