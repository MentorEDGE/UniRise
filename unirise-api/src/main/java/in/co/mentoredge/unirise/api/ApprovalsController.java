package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/**
 * The Office of Research's approvals (G18, G39), as in the prototype server: the queue for each stage of the review,
 * counts, starting a review, decisions on entries and profile updates, and grant funding outcomes. Every decision is
 * recorded in the institution's audit log (G23).
 */
@RestController
@RequestMapping("/api/office/approvals")
public class ApprovalsController {
	/** awaiting, review, returned, approved, rejected; pending = awaiting + review; decided = approved + returned + rejected. */
	static final Map<String, List<String>> VIEWS = Map.of("awaiting", List.of("Submitted"), "review", List.of("UnderReview"), "returned", List.of("Rework"),
		"approved", List.of("Approved"), "rejected", List.of("Rejected"), "pending", List.of("Submitted", "UnderReview"), "decided", List.of("Approved", "Rework", "Rejected"));
	static final List<String> DECISION_ACTIONS = List.of("Approved", "Sent for rework", "Returned for correction", "Rejected");

	private final AccessService access;
	private final Records records;
	private final Profiles profiles;
	private final AdminLog log;

	public ApprovalsController(AccessService access, Records records, Profiles profiles, AdminLog log) {
		this.access = access;
		this.records = records;
		this.profiles = profiles;
		this.log = log;
	}

	private Actor office(HttpServletRequest req) {
		Actor a = access.actor(req);
		Records.requireOffice(a);
		return a;
	}

	@GetMapping
	Map<String, Object> queue(@RequestParam(defaultValue = "pending") String view, HttpServletRequest req) {
		office(req);
		List<String> want = VIEWS.getOrDefault(view, VIEWS.get("pending"));
		boolean decided = List.of("approved", "rejected", "decided", "returned").contains(view);
		Map<String, Object> recs = new LinkedHashMap<>();
		for (String k : Records.KINDS) recs.put(k, pick(records.all(k), want, decided));
		List<Map<String, Object>> changes = pick(profiles.profileChanges("", Map.of()), want, decided);
		Map<String, Object> current = new LinkedHashMap<>();
		for (var c : changes) current.put((String) c.get("facultyId"), profiles.biodataOf((String) c.get("facultyId")).orElse(null));
		return Json.of("records", recs, "profiles", changes, "currentProfiles", current);
	}

	private static List<Map<String, Object>> pick(List<Map<String, Object>> xs, List<String> want, boolean decided) {
		var s = xs.stream().filter(r -> want.contains(r.get("status")));
		if (!decided) return s.toList();
		return s.filter(r -> Json.arr(r.get("history")).stream().anyMatch(h -> DECISION_ACTIONS.contains(Json.obj(h).get("action"))))
			.sorted(Comparator.comparing((Map<String, Object> r) -> (String) r.get("updatedAt")).reversed()).limit(300).toList();
	}

	@GetMapping("/count")
	Map<String, Object> count(HttpServletRequest req) {
		office(req);
		long awaiting = 0, review = 0, returned = 0;
		for (String k : Records.KINDS) for (var r : records.all(k)) switch ((String) r.get("status")) {
			case "Submitted" -> awaiting++;
			case "UnderReview" -> review++;
			case "Rework" -> returned++;
			default -> { }
		}
		for (var c : profiles.profileChanges("", Map.of())) switch ((String) c.get("status")) {
			case "Submitted" -> awaiting++;
			case "UnderReview" -> review++;
			case "Rework" -> returned++;
			default -> { }
		}
		return Json.of("total", awaiting + review, "awaiting", awaiting, "review", review, "returned", returned);
	}

	/** Opening a submission moves it to Under Review, so the faculty member can see it is being looked at. */
	@PostMapping("/profiles/{id}/start")
	Map<String, Object> startProfile(@PathVariable String id, HttpServletRequest req) {
		profiles.startReview(office(req), id);
		return Json.of("ok", true);
	}

	@PostMapping("/{kind}/{id}/start")
	Map<String, Object> start(@PathVariable String kind, @PathVariable String id, HttpServletRequest req) {
		records.startReview(office(req), kind, id);
		return Json.of("ok", true);
	}

	@PostMapping("/profiles/{id}/review")
	Map<String, Object> reviewProfile(@PathVariable String id, @RequestBody(required = false) Map<String, Object> b, HttpServletRequest req) {
		Actor a = office(req);
		Map<String, Object> body = b == null ? Map.of() : b;
		profiles.review(a, id, Json.str(body.get("decision")), Json.str(body.get("remark"), 1000));
		log.record(a, decisionAction(body.get("decision"), "Profile update"), id, null);
		return Json.of("ok", true);
	}

	@PostMapping("/grants/{id}/outcome")
	Map<String, Object> outcome(@PathVariable String id, @RequestBody(required = false) Map<String, Object> b, HttpServletRequest req) {
		Actor a = office(req);
		Map<String, Object> body = b == null ? Map.of() : b;
		records.grantOutcome(a, id, body);
		log.record(a, "Grant outcome set to " + Json.str(body.get("outcome"), 40), id, null);
		return Json.of("ok", true);
	}

	@PostMapping("/{kind}/{id}/review")
	Map<String, Object> review(@PathVariable String kind, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b, HttpServletRequest req) {
		Actor a = office(req);
		Map<String, Object> body = b == null ? Map.of() : b;
		records.review(a, kind, id, Json.str(body.get("decision")), Json.str(body.get("remark"), 1000), body.get("sanctionedAmount"));
		log.record(a, decisionAction(body.get("decision"), "Entry"), id, kind);
		return Json.of("ok", true);
	}

	static String decisionAction(Object d, String what) {
		return switch (String.valueOf(d)) {
			case "Approved" -> what + " approved";
			case "Rework" -> what + " returned for correction";
			case "Rejected" -> what + " rejected";
			default -> what + " reviewed";
		};
	}
}
