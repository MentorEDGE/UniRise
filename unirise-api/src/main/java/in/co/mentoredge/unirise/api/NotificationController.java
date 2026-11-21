package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** GET /api/notifications: the caller's latest notifications and unread count. POST /api/notifications/read {ids} or {all: true}. */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
	private final AccessService access;
	private final Notifier notifier;

	public NotificationController(AccessService access, Notifier notifier) { this.access = access; this.notifier = notifier; }

	@GetMapping
	Map<String, Object> mine(HttpServletRequest req) {
		Actor a = access.actor(req);
		if (a.userId() == null) return Json.of("items", List.of(), "unread", 0);
		return Json.of("items", notifier.latest(a.userId()), "unread", notifier.unread(a.userId()));
	}

	@PostMapping("/read")
	Map<String, Object> read(@RequestBody(required = false) Map<String, Object> b, HttpServletRequest req) {
		Actor a = access.actor(req);
		if (a.userId() != null) {
			if (b != null && Boolean.TRUE.equals(b.get("all"))) notifier.markRead(a.userId(), null);
			else notifier.markRead(a.userId(), Json.arr(b == null ? null : b.get("ids")).stream().filter(x -> x instanceof Number).map(x -> ((Number) x).longValue()).limit(200).toList());
		}
		return Json.of("ok", true, "unread", a.userId() == null ? 0 : notifier.unread(a.userId()));
	}
}
