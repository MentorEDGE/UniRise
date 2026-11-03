package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.Provisioner;
import in.co.mentoredge.unirise.tenancy.TenantContext;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
import in.co.mentoredge.unirise.tenancy.TenantInfo;
import java.util.Optional;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * The one place the tenant is chosen: from the API key, never from anything else the client sends.
 * /api/platform/** needs the operator key and gets no tenant. Everything else under /api needs a tenant key.
 */
public class ApiKeyFilter extends OncePerRequestFilter {
	private final TenantDirectory directory;
	private final byte[] adminKey;

	public ApiKeyFilter(TenantDirectory directory, String adminKey) {
		this.directory = directory;
		this.adminKey = adminKey == null ? new byte[0] : adminKey.getBytes(StandardCharsets.UTF_8);
	}

	/** Default deny: every path needs a credential except these exact ones. Matched on the container-normalised path, not the raw URI. */
	private static String path(HttpServletRequest r) {
		return (r.getServletPath() == null ? "" : r.getServletPath()) + (r.getPathInfo() == null ? "" : r.getPathInfo());
	}

	@Override
	protected boolean shouldNotFilter(HttpServletRequest r) {
		String p = path(r);
		return p.equals("/actuator/health") || p.equals("/actuator/health/liveness") || p.equals("/actuator/health/readiness");
	}

	@Override
	protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
		if (path(req).startsWith("/api/platform/")) {
			String given = req.getHeader("X-Admin-Key");
			boolean ok = adminKey.length > 0 && given != null && MessageDigest.isEqual(adminKey, given.getBytes(StandardCharsets.UTF_8));
			if (!ok) { res.sendError(401); return; }
			req.setAttribute("platform", true);
			chain.doFilter(req, res);
			return;
		}
		if (path(req).equals("/api/auth/redeem")) { chain.doFilter(req, res); return; } // public: the invitation token names the tenant
		String key = req.getHeader("X-API-Key");
		String auth = req.getHeader("Authorization");
		Optional<TenantInfo> tenant = Optional.empty();
		if (key != null && key.length() <= 200) {
			tenant = directory.byKeyHash(Provisioner.hash(key));
			if (tenant.isPresent()) req.setAttribute("service", true);
		} else if (auth != null && auth.startsWith("Bearer ") && auth.length() <= 220) {
			var hit = directory.byToken(Provisioner.hash(auth.substring(7)), "session");
			if (hit.isPresent()) { tenant = Optional.of(hit.get().tenant()); req.setAttribute("userId", hit.get().userId()); }
		}
		if (tenant.isEmpty()) { res.sendError(401); return; }
		if (!tenant.get().status().matches("sandbox|pilot|active")) { res.sendError(403); return; }
		TenantContext.set(tenant.get().slug());
		try {
			chain.doFilter(req, res);
		} finally {
			TenantContext.clear();
		}
	}
}
