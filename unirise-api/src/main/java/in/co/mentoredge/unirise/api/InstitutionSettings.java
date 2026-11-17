package in.co.mentoredge.unirise.api;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Institution settings (G21, G28-G31) in the shape of the UI's Settings type: name, tagline, departments, academic-year
 * start, seed-money window, targets and score weights; plus enabled features, custom fields and option lists. Defaults
 * are the UI's (rdms-web/src/lib/seed.ts). Departments are also kept as org units, so earlier endpoints still see them.
 */
@Service
public class InstitutionSettings {
	static final Map<String, Object> DEFAULT_TARGETS = Json.of("publicationsPerFaculty", 2L, "fdpHoursPerFaculty", 30L, "conferencesPerFaculty", 1L, "grantAppliedPerFaculty", 0.5);
	static final Map<String, Object> DEFAULT_WEIGHTS = Json.of(
		"q1", 10L, "q2", 8L, "q3", 6L, "q4", 4L, "otherJournal", 3L, "book", 8L, "chapter", 4L, "confPaper", 3L, "techReport", 2L,
		"grantSanctioned", 10L, "grantPerLakh", 0.5, "seedMoney", 3L, "fdpAttended", 2L, "fdpOrganised", 4L, "fdpResource", 3L,
		"confPresented", 3L, "confInvited", 4L, "confChair", 2L, "confAttended", 1L, "confOrganised", 4L,
		"awardInternational", 6L, "awardNational", 4L, "awardOther", 2L,
		"patentGranted", 10L, "patentFiled", 4L, "design", 3L, "copyright", 3L, "trademark", 2L, "ipOther", 2L);
	/** Every record kind is on by default; an institution may turn one off (G28). */
	static final Map<String, Object> DEFAULT_FEATURES = Json.of("publications", true, "grants", true, "seedMoney", true, "fdps", true, "conferences", true, "awards", true, "ipr", true);

	private final JdbcClient db;
	private final OrgTree tree;

	public InstitutionSettings(@Qualifier("tenantJdbc") JdbcClient db, OrgTree tree) {
		this.db = db;
		this.tree = tree;
	}

	/** The settings with every field present (stored values over the defaults). */
	public Map<String, Object> get() {
		Map<String, Object> stored = db.sql("SELECT data::text FROM settings WHERE id = 1").query(String.class).optional().map(Json::map).orElse(new LinkedHashMap<>());
		String name = db.sql("SELECT name FROM institution WHERE id = 1").query(String.class).optional().orElse("");
		Map<String, Object> s = new LinkedHashMap<>();
		s.put("institutionName", stored.getOrDefault("institutionName", name));
		s.put("institutionTagline", stored.getOrDefault("institutionTagline", ""));
		s.put("departments", stored.containsKey("departments") ? stored.get("departments") : orgDepartments());
		if (!Json.arr(stored.get("schools")).isEmpty()) s.put("schools", stored.get("schools")); // universities only; see InstitutionController.schools
		s.put("academicYearStartMonth", stored.getOrDefault("academicYearStartMonth", 6L));
		s.put("seedMoneyWindowOpen", stored.getOrDefault("seedMoneyWindowOpen", false));
		s.put("targets", merge(DEFAULT_TARGETS, Json.obj(stored.get("targets"))));
		s.put("weights", merge(DEFAULT_WEIGHTS, Json.obj(stored.get("weights"))));
		s.put("features", merge(DEFAULT_FEATURES, Json.obj(stored.get("features"))));
		s.put("customFields", stored.getOrDefault("customFields", new LinkedHashMap<>()));
		s.put("lists", stored.getOrDefault("lists", new LinkedHashMap<>()));
		s.put("limits", merge(Json.of("seedMoneyMax", 500000L, "pdfRequired", true), Json.obj(stored.get("limits"))));
		return s;
	}

	public void put(Map<String, Object> s) {
		db.sql("INSERT INTO settings(id, data) VALUES (1, CAST(:d AS jsonb)) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data").param("d", Json.write(s)).update();
		db.sql("UPDATE institution SET name = :n WHERE id = 1").param("n", Json.str(s.get("institutionName"), 200)).update();
		for (Object d : Json.arr(s.get("departments"))) {
			String name = (String) d;
			if (db.sql("SELECT count(*) FROM org_unit WHERE type = 'department' AND lower(name) = lower(:n)").param("n", name).query(Long.class).single() == 0) tree.add(null, "department", name);
		}
	}

	@SuppressWarnings("unchecked")
	public List<String> departments() { return (List<String>) (List<?>) Json.arr(get().get("departments")); }

	public boolean enabled(String kind) { return !Boolean.FALSE.equals(Json.obj(get().get("features")).get(kind)); }

	private List<String> orgDepartments() {
		return new ArrayList<>(db.sql("SELECT name FROM org_unit WHERE type = 'department' ORDER BY id").query(String.class).list());
	}

	private static Map<String, Object> merge(Map<String, Object> defaults, Map<String, Object> stored) {
		Map<String, Object> out = new LinkedHashMap<>(defaults);
		out.putAll(stored);
		return out;
	}
}
