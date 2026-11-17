package in.co.mentoredge.unirise.api;

import static in.co.mentoredge.unirise.api.RuleException.forbid;
import static in.co.mentoredge.unirise.api.RuleException.invalid;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

/**
 * The institution's data for the three roles, with the same requests and responses as the rdms-web prototype server
 * (phases 4 and 5): the scoped data slice, entries, profile updates, official faculty details, settings and notices.
 */
@RestController
@RequestMapping("/api")
public class InstitutionController {
	private final JdbcClient db;
	private final AccessService access;
	private final DataSlice slice;
	private final Records records;
	private final Profiles profiles;
	private final InstitutionSettings settings;
	private final AdminLog log;
	private final Sessions sessions;
	private final in.co.mentoredge.unirise.tenancy.TenantDirectory directory;

	public InstitutionController(@Qualifier("tenantJdbc") JdbcClient db, AccessService access, DataSlice slice, Records records, Profiles profiles, InstitutionSettings settings, AdminLog log,
		Sessions sessions, in.co.mentoredge.unirise.tenancy.TenantDirectory directory) {
		this.sessions = sessions;
		this.directory = directory;
		this.db = db;
		this.access = access;
		this.slice = slice;
		this.records = records;
		this.profiles = profiles;
		this.settings = settings;
		this.log = log;
	}

	/**
	 * Everything the caller may see, in one JSON document. Answers 304 when the caller already has this exact version
	 * (ETag), so the UI's automatic refresh costs little when nothing changed (G38).
	 */
	@GetMapping("/data")
	ResponseEntity<String> data(HttpServletRequest req) throws Exception {
		String body = Json.write(slice.build(access.actor(req)));
		String etag = "\"" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8))).substring(0, 32) + "\"";
		if (etag.equals(req.getHeader("If-None-Match"))) return ResponseEntity.status(HttpStatus.NOT_MODIFIED).eTag(etag).header("Cache-Control", "no-cache, private").build();
		return ResponseEntity.ok().eTag(etag).header("Cache-Control", "no-cache, private").contentType(MediaType.APPLICATION_JSON).body(body);
	}

	// ---------- entries ----------

	@PostMapping("/records/{kind}")
	Map<String, Object> save(@PathVariable String kind, @RequestBody(required = false) Map<String, Object> body, HttpServletRequest req) {
		Map<String, Object> b = body == null ? Map.of() : body;
		return Json.of("ok", true, "result", records.save(access.actor(req), kind, Json.obj(b.get("record")), Boolean.TRUE.equals(b.get("submit"))));
	}

	@DeleteMapping("/records/{kind}/{id}")
	Map<String, Object> delete(@PathVariable String kind, @PathVariable String id, HttpServletRequest req) {
		records.delete(access.actor(req), kind, id);
		return Json.of("ok", true, "result", null);
	}

	/** Kept so an old client gets a clear answer: only the Office of Research reviews (see /api/office/approvals). */
	@PostMapping("/records/{kind}/{id}/review")
	Map<String, Object> review(@PathVariable String kind, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b, HttpServletRequest req) {
		Map<String, Object> body = b == null ? Map.of() : b;
		records.review(access.actor(req), kind, id, Json.str(body.get("decision")), Json.str(body.get("remark"), 1000), body.get("sanctionedAmount"));
		return Json.of("ok", true, "result", null);
	}

	@PostMapping("/grants/{id}/outcome")
	Map<String, Object> outcome(@PathVariable String id, @RequestBody(required = false) Map<String, Object> b, HttpServletRequest req) {
		records.grantOutcome(access.actor(req), id, b == null ? Map.of() : b);
		return Json.of("ok", true, "result", null);
	}

	// ---------- profiles ----------

	/** A faculty member proposes a profile update; it waits for the Office of Research. Management gets 403. */
	@PostMapping("/profile-changes")
	Map<String, Object> proposeProfile(@RequestBody(required = false) Map<String, Object> b, HttpServletRequest req) {
		Map<String, Object> body = b == null ? Map.of() : b;
		return Json.of("ok", true, "result", profiles.propose(access.actor(req), Json.obj(body.get("biodata")), Json.obj(body.get("contact")), Boolean.TRUE.equals(body.get("submit"))));
	}

	@PutMapping("/biodata/{facultyId}")
	ResponseEntity<Map<String, String>> biodataDirect() {
		return AuthController.error(HttpStatus.FORBIDDEN, "Profile updates are submitted for approval by the Office of Research.");
	}

	@PostMapping("/faculty")
	ResponseEntity<Map<String, String>> newFaculty() {
		return AuthController.error(HttpStatus.FORBIDDEN, "Faculty profiles are created with the account, under User Management.");
	}

	/** Official details, and marking someone as former faculty or restoring them. Office of Research only. */
	@PutMapping("/faculty/{id}")
	Map<String, Object> saveFaculty(@PathVariable String id, @RequestBody(required = false) Map<String, Object> b, HttpServletRequest req) {
		Actor a = access.actor(req);
		Map<String, Object> before = profiles.facultyById(id).orElse(null);
		profiles.saveFaculty(a, id, b == null ? Map.of() : b);
		if (b != null && Boolean.FALSE.equals(b.get("active"))) { // former faculty: their sessions end at once (they also can no longer act, see AccessService)
			long inst = (Long) (req.getAttribute("institutionId") == null ? directory.bySlug(in.co.mentoredge.unirise.tenancy.TenantContext.require()).orElseThrow().id() : req.getAttribute("institutionId"));
			for (Long u : db.sql("SELECT u.id FROM app_user u JOIN researcher r ON r.id = u.researcher_id WHERE r.employee_id = :c").param("c", id).query(Long.class).list()) sessions.endAll(inst, u, null);
		}
		boolean wasActive = before == null || Boolean.TRUE.equals(before.get("active")), nowActive = b == null || !Boolean.FALSE.equals(b.get("active"));
		log.record(a, wasActive && !nowActive ? "Faculty marked as former" : !wasActive && nowActive ? "Faculty restored as current" : "Faculty details updated", id,
			nowActive ? null : Json.str(b.get("exitReason")) + " · last working day " + Json.str(b.get("exitDate")));
		return Json.of("ok", true, "result", null);
	}

	// ---------- settings and notices ----------

	/** Institution, departments, targets and weights: the Office of Research only. A department with faculty cannot be removed. */
	@PutMapping("/settings")
	Map<String, Object> saveSettings(@RequestBody(required = false) Map<String, Object> b, HttpServletRequest req) {
		Actor a = access.actor(req);
		if (!a.isAdmin()) throw forbid("Only the Office of Research can do this.");
		Map<String, Object> s = b == null ? Map.of() : b, current = settings.get();
		String name = Json.str(s.get("institutionName"), 200).trim();
		if (name.isEmpty()) throw invalid("Institution name is required.");
		List<String> departments = new ArrayList<>();
		for (Object d : Json.arr(s.get("departments"))) { String x = Json.str(d, 200).trim(); if (!x.isEmpty() && !departments.contains(x) && departments.size() < 100) departments.add(x); }
		if (departments.isEmpty()) throw invalid("Keep at least one department.");
		List<String> used = db.sql("SELECT DISTINCT department FROM researcher WHERE employee_id IS NOT NULL AND department <> ''").query(String.class).list();
		for (Object d : Json.arr(current.get("departments"))) if (used.contains(d) && !departments.contains(d)) throw invalid("“" + d + "” still has faculty; move them first.");
		Map<String, Object> next = new LinkedHashMap<>(current);
		next.put("institutionName", name);
		next.put("institutionTagline", Json.str(s.get("institutionTagline"), 200));
		next.put("departments", departments);
		// Schools of a university (none for an institute). An older client that does not send them keeps the current ones,
		// which must still fit the departments.
		List<Map<String, Object>> schools = schools(s.containsKey("schools") ? s.get("schools") : current.get("schools"), departments);
		if (schools.isEmpty()) next.remove("schools"); else next.put("schools", schools);
		long month = Math.round(Json.dbl(s.get("academicYearStartMonth")));
		next.put("academicYearStartMonth", month >= 1 && month <= 12 ? month : 6L);
		next.put("seedMoneyWindowOpen", Json.bool(s.get("seedMoneyWindowOpen")));
		next.put("targets", numbers(Json.obj(s.get("targets")), Json.obj(current.get("targets"))));
		next.put("weights", numbers(Json.obj(s.get("weights")), Json.obj(current.get("weights"))));
		if (s.get("features") instanceof Map<?, ?> f) { // G28: switch record kinds on or off
			Map<String, Object> features = new LinkedHashMap<>(Json.obj(current.get("features")));
			for (String k : Records.KINDS) if (f.get(k) instanceof Boolean on) features.put(k, on);
			next.put("features", features);
		}
		if (s.get("customFields") instanceof Map<?, ?> cf) next.put("customFields", cf);   // G29
		if (s.get("lists") instanceof Map<?, ?> l) next.put("lists", l);                   // G30
		settings.put(next);
		log.record(a, "Institution settings saved", name, null);
		return Json.of("ok", true, "result", null);
	}

	/**
	 * A university's schools, each holding some of the departments; the same rules as rdms-web (domain.ts cleanSchools):
	 * unique names, every department in exactly one school, only the institution's departments, kept in its order.
	 */
	static List<Map<String, Object>> schools(Object in, List<String> departments) {
		List<Object> raw = Json.arr(in);
		if (raw.isEmpty()) return List.of();
		if (raw.size() > 50) throw invalid("At most 50 schools.");
		List<String> names = new ArrayList<>();
		Map<String, String> placed = new LinkedHashMap<>();
		List<Map<String, Object>> out = new ArrayList<>();
		for (Object x : raw) {
			Map<String, Object> o = Json.obj(x);
			String name = Json.str(o.get("name"), 200).trim();
			if (name.isEmpty()) throw invalid("Every school needs a name.");
			if (names.contains(name.toLowerCase())) throw invalid("There are two schools called “" + name + "”.");
			names.add(name.toLowerCase());
			List<String> mine = new ArrayList<>();
			for (Object d : Json.arr(o.get("departments"))) {
				String dept = Json.str(d, 200).trim();
				if (dept.isEmpty()) continue;
				if (!departments.contains(dept)) throw invalid("“" + dept + "” is not one of the institution's departments.");
				if (placed.containsKey(dept)) throw invalid("“" + dept + "” is in both “" + placed.get(dept) + "” and “" + name + "”; a department belongs to one school.");
				placed.put(dept, name);
				mine.add(dept);
			}
			Map<String, Object> school = new LinkedHashMap<>();
			school.put("name", name);
			school.put("departments", departments.stream().filter(mine::contains).toList());
			out.add(school);
		}
		List<String> unplaced = departments.stream().filter((d) -> !placed.containsKey(d)).map((d) -> "“" + d + "”").toList();
		if (!unplaced.isEmpty()) throw invalid("Choose a school for " + String.join(", ", unplaced) + ".");
		return out;
	}

	private static Map<String, Object> numbers(Map<String, Object> in, Map<String, Object> ref) {
		Map<String, Object> out = new LinkedHashMap<>();
		for (String k : ref.keySet()) out.put(k, in.containsKey(k) ? (Json.dbl(in.get(k)) < 0 ? (Object) 0L : Json.num(in.get(k))) : ref.get(k));
		return out;
	}

	@PostMapping("/notices")
	Map<String, Object> addNotice(@RequestBody(required = false) Map<String, Object> b, HttpServletRequest req) {
		Actor a = access.actor(req);
		if (!a.isAdmin()) throw forbid("Only the Office of Research can do this.");
		String title = Json.str(b == null ? null : b.get("title"), 200).trim();
		if (title.isEmpty()) throw invalid("Title is required.");
		String id = records.nextId("N");
		db.sql("INSERT INTO notice(id, title, body) VALUES (:id, :t, :b)").param("id", id).param("t", title).param("b", Json.str(b.get("body"), 2000).trim()).update();
		log.record(a, "Notice posted", title, null);
		return Json.of("ok", true, "result", null);
	}

	@DeleteMapping("/notices/{id}")
	Map<String, Object> deleteNotice(@PathVariable String id, HttpServletRequest req) {
		Actor a = access.actor(req);
		if (!a.isAdmin()) throw forbid("Only the Office of Research can do this.");
		db.sql("DELETE FROM notice WHERE id = :id").param("id", id).update();
		log.record(a, "Notice deleted", id, null);
		return Json.of("ok", true, "result", null);
	}
}
