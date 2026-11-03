package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.Provisioner;
import in.co.mentoredge.unirise.tenancy.TenantContext;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
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

	@Override
	protected boolean shouldNotFilter(HttpServletRequest r) { return !r.getRequestURI().startsWith("/api/"); }

	@Override
	protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
		if (req.getRequestURI().startsWith("/api/platform/")) {
			String given = req.getHeader("X-Admin-Key");
			boolean ok = adminKey.length > 0 && given != null && MessageDigest.isEqual(adminKey, given.getBytes(StandardCharsets.UTF_8));
			if (!ok) { res.sendError(401); return; }
			chain.doFilter(req, res);
			return;
		}
		String key = req.getHeader("X-API-Key");
		var tenant = key == null || key.length() > 200 ? java.util.Optional.<in.co.mentoredge.unirise.tenancy.TenantInfo>empty() : directory.byKeyHash(Provisioner.hash(key));
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
