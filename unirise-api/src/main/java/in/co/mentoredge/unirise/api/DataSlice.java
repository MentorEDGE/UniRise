package in.co.mentoredge.unirise.api;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * The slice of the institution's data a caller may receive, in the UI's DB shape (decision D2: the browser computes
 * reports and analytics from it). Port of scopeFor in rdms-web/src/lib/domain.ts:
 * - Office of Research: everything except faculty drafts: an entry or profile update is private to its author until it
 *   is submitted, as the entry form promises (QA finding 2026-11-20).
 * - Top-Level Management: current (active) faculty only; approved records that credit at least one of them, with the
 *   review conversation removed; no pending profile updates (G1, G35, G39).
 * - Faculty: their own profile and every record they are credited on, in every status; colleagues by name only.
 */
@Service
public class DataSlice {
	private final JdbcClient db;
	private final Records records;
	private final Profiles profiles;
	private final InstitutionSettings settings;

	public DataSlice(@Qualifier("tenantJdbc") JdbcClient db, Records records, Profiles profiles, InstitutionSettings settings) {
		this.db = db;
		this.records = records;
		this.profiles = profiles;
		this.settings = settings;
	}

	public Map<String, Object> build(Actor a) {
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("version", 1);
		out.put("settings", settings.get());
		List<Map<String, Object>> faculty = profiles.faculty();
		List<Map<String, Object>> biodata = profiles.biodata();
		out.put("notices", notices());
		out.put("seq", db.sql("SELECT last_value FROM display_seq").query(Long.class).single());

		if (a.isAdmin()) {
			out.put("faculty", faculty);
			out.put("biodata", biodata);
			for (String k : Records.KINDS) out.put(k, records.all(k).stream().filter(r -> !"Draft".equals(r.get("status"))).toList());
			out.put("profileChanges", profiles.profileChanges(" WHERE status <> 'Draft'", Map.of()));
			return out;
		}
		if (a.isManagement()) {
			Set<String> current = faculty.stream().filter(f -> Boolean.TRUE.equals(f.get("active"))).map(f -> (String) f.get("id")).collect(Collectors.toSet());
			out.put("faculty", faculty.stream().filter(f -> current.contains((String) f.get("id"))).toList());
			out.put("biodata", biodata.stream().filter(b -> current.contains((String) b.get("facultyId"))).toList());
			for (String k : Records.KINDS) {
				out.put(k, records.all(k).stream().filter(r -> "Approved".equals(r.get("status")) && Records.credited(k, r).stream().anyMatch(current::contains))
					.map(r -> { r.put("history", managementHistory(Json.arr(r.get("history")))); return r; }).toList());
			}
			out.put("profileChanges", List.of()); // pending profile edits are not institutional information until approved
			return out;
		}
		String me = records.facultyCode(a);
		out.put("faculty", faculty.stream().filter(f -> f.get("id").equals(me) || Boolean.TRUE.equals(f.get("active")))
			.map(f -> f.get("id").equals(me) ? f : colleague(f)).toList());
		out.put("biodata", biodata.stream().filter(b -> me.equals(b.get("facultyId"))).toList());
		for (String k : Records.KINDS) out.put(k, records.all(k).stream().filter(r -> Records.credited(k, r).contains(me)).toList());
		out.put("profileChanges", profiles.profileChanges(" WHERE faculty = :f", Map.of("f", me)));
		return out;
	}

	/** Colleagues: only name, title, department and employee code, so co-authors can be picked in entry forms. */
	private static Map<String, Object> colleague(Map<String, Object> f) {
		return Json.of("id", f.get("id"), "title", f.get("title"), "name", f.get("name"), "department", f.get("department"), "designation", "", "email", "", "phone", "",
			"joiningDate", "", "orcid", "", "scopusId", "", "active", true);
	}

	/** What management sees of a record's history: creation, the final approval and funding outcomes, never a remark. */
	static List<Object> managementHistory(List<Object> h) {
		Object approved = null;
		for (Object x : h) if ("Approved".equals(Json.obj(x).get("action"))) approved = x;
		List<Object> out = new ArrayList<>();
		boolean created = false;
		for (Object x : h) {
			String action = Json.str(Json.obj(x).get("action"));
			boolean keep = (action.equals("Created") && !created) || x == approved || action.startsWith("Outcome");
			if (action.equals("Created")) created = true;
			if (!keep) continue;
			Map<String, Object> copy = new LinkedHashMap<>(Json.obj(x));
			copy.remove("remark");
			out.add(copy);
		}
		return out;
	}

	List<Map<String, Object>> notices() {
		return db.sql("SELECT id, at, title, body FROM notice ORDER BY at DESC, id DESC").query((r, n) -> Json.of("id", r.getString("id"), "at", r.getTimestamp("at").toInstant().toString(),
			"title", r.getString("title"), "body", r.getString("body"))).list();
	}
}
