package in.co.mentoredge.unirise.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Request limits for every API call (2026-11-24), so a stolen session or a script cannot scrape the institution's data
 * or flood the API. Counted per signed-in browser (its session cookie) or, without one, per client address, in one-minute
 * windows. Generous on purpose: a whole campus may sign in from one address. Over the limit: 429 with Retry-After.
 * Kept in memory: with several API tasks each counts its own share, which only makes the limit looser, never stricter.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 5)
public class RateLimitFilter extends OncePerRequestFilter {
	private final int perMinute, writesPerMinute, perAddressPerMinute;
	private final ConcurrentHashMap<String, AtomicInteger> counts = new ConcurrentHashMap<>();
	private volatile long window = currentWindow();

	public RateLimitFilter(@Value("${app.rate-limit.per-minute:600}") int perMinute, @Value("${app.rate-limit.writes-per-minute:120}") int writesPerMinute,
		@Value("${app.rate-limit.per-address-per-minute:600}") int perAddressPerMinute) {
		this.perMinute = perMinute;
		this.writesPerMinute = writesPerMinute;
		this.perAddressPerMinute = perAddressPerMinute;
	}

	private static long currentWindow() { return System.currentTimeMillis() / 60_000; }

	@Override
	protected boolean shouldNotFilter(HttpServletRequest req) {
		return !req.getRequestURI().startsWith("/api/") || "OPTIONS".equals(req.getMethod());
	}

	@Override
	protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
		long w = currentWindow();
		if (w != window) { synchronized (this) { if (w != window) { counts.clear(); window = w; } } }
		String sid = ApiKeyFilter.cookie(req);
		String who = sid != null && !sid.isEmpty() ? "s:" + Integer.toHexString(sid.hashCode()) + sid.length() : "a:" + req.getRemoteAddr();
		boolean write = !"GET".equals(req.getMethod()) && !"HEAD".equals(req.getMethod());
		int all = counts.computeIfAbsent(who, (k) -> new AtomicInteger()).incrementAndGet();
		int writes = write ? counts.computeIfAbsent(who + ":w", (k) -> new AtomicInteger()).incrementAndGet() : 0;
		int limit = who.startsWith("a:") ? perAddressPerMinute : perMinute;
		if (all > limit || writes > writesPerMinute) {
			res.setStatus(429);
			res.setHeader("Retry-After", "60");
			res.setContentType("application/json");
			res.getWriter().write("{\"error\":\"Too many requests. Please wait a minute and try again.\"}");
			return;
		}
		chain.doFilter(req, res);
	}
}
