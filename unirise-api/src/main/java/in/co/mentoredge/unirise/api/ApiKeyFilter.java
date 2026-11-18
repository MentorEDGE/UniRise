package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.Provisioner;
import in.co.mentoredge.unirise.tenancy.TenantContext;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
import in.co.mentoredge.unirise.tenancy.TenantInfo;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * The one place the tenant is chosen: from the credential, never from anything else the client sends.
 * - /api/platform/** needs the operator key and gets no tenant.
 * - Integrations use the institution's API key (X-API-Key), which acts as the Office of Research.
 * - Browsers use the session cookie set at sign-in. Every change from a browser must carry "X-RDMS: 1": a cross-site form
 *   cannot set that header, so together with the SameSite=Strict cookie it stops cross-site request forgery.
 * - The sign-in and password-link endpoints are the only public ones; they find the institution from the account themselves.
 */
public class ApiKeyFilter extends OncePerRequestFilter {
	/** Public: no session yet. The handlers find the tenant from the account. */
	static final Set<String> PUBLIC = Set.of("/api/login", "/api/admin/login", "/api/logout", "/api/enquiries", "/api/password/forgot", "/api/password/check", "/api/password/set");
	/** Old-model modules with no screen, parked by decision D3 (2026-11-14): tables kept, endpoints not exposed. */
	static final List<String> PARKED = List.of("/api/milestones", "/api/meeting-logs", "/api/reminders", "/api/progress-settings", "/api/projects", "/api/periods", "/api/relationships", "/api/role-grants", "/api/auth/");

	private final TenantDirectory directory;
	private final Sessions sessions;
	private final byte[] adminKey;

	public ApiKeyFilter(TenantDirectory directory, Sessions sessions, String adminKey) {
		this.directory = directory;
		this.sessions = sessions;
		this.adminKey = adminKey == null ? new byte[0] : adminKey.getBytes(StandardCharsets.UTF_8);
	}

	/** Default deny: every path needs a credential except these exact ones. Matched on the container-normalised path, not the raw URI. */
	private static String path(HttpServletRequest r) {
		return (r.getServletPath() == null ? "" : r.getServletPath()) + (r.getPathInfo() == null ? "" : r.getPathInfo());
	}

	static String cookie(HttpServletRequest req) {
		if (req.getCookies() == null) return null;
		for (Cookie c : req.getCookies()) if (Sessions.COOKIE.equals(c.getName())) return c.getValue();
		return null;
	}

	private static boolean isChange(HttpServletRequest req) {
		return !Set.of("GET", "HEAD", "OPTIONS").contains(req.getMethod());
	}

	@Override
	protected boolean shouldNotFilter(HttpServletRequest r) {
		String p = path(r);
		return p.equals("/actuator/health") || p.equals("/actuator/health/liveness") || p.equals("/actuator/health/readiness");
	}

	@Override
	protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
		String p = path(req);
		if (p.startsWith("/api/platform/")) {
			String given = req.getHeader("X-Admin-Key");
			boolean ok = adminKey.length > 0 && given != null && MessageDigest.isEqual(adminKey, given.getBytes(StandardCharsets.UTF_8));
			if (!ok) { res.sendError(401); return; }
			req.setAttribute("platform", true);
			chain.doFilter(req, res);
			return;
		}
		if (PARKED.stream().anyMatch(x -> p.equals(x) || p.startsWith(x.endsWith("/") ? x : x + "/"))) { res.sendError(404); return; }
		String key = req.getHeader("X-API-Key");
		String cookie = cookie(req);
		boolean browser = key == null;
		if (browser && !PUBLIC.contains(p) && cookie == null) { res.sendError(401); return; } // no credential at all
		if (browser && isChange(req) && !"1".equals(req.getHeader("X-RDMS"))) { res.sendError(403, "Missing request header."); return; }
		if (PUBLIC.contains(p)) { chain.doFilter(req, res); return; }

		Optional<TenantInfo> tenant = Optional.empty();
		if (key != null) {
			if (key.length() <= 200) tenant = directory.byKeyHash(Provisioner.hash(key));
			if (tenant.isPresent()) req.setAttribute("service", true);
		} else {
			var session = sessions.read(cookie);
			if (session.isPresent()) {
				tenant = directory.byId(session.get().institutionId());
				req.setAttribute("userId", session.get().userId());
				req.setAttribute("sessionHash", session.get().tokenHash());
				req.setAttribute("institutionId", session.get().institutionId());
			}
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
