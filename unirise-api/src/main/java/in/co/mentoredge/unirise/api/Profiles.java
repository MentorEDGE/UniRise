package in.co.mentoredge.unirise.api;

import static in.co.mentoredge.unirise.api.RuleException.forbid;
import static in.co.mentoredge.unirise.api.RuleException.invalid;
import static in.co.mentoredge.unirise.api.RuleException.notFound;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.TreeSet;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Faculty profiles (G16, G17, G20, G35-G37), ported from rdms-web/src/lib/domain.ts: official details kept by the
 * Office of Research (including former faculty), the biodata and researcher profile, and profile updates that wait for
 * the Office's approval before they replace the live profile.
 */
@Service
public class Profiles {
	static final List<String> EXIT_REASONS = List.of("Retired", "Resigned", "Transferred", "Other");
	static final List<String> ENGAGEMENT_TYPES = List.of("Editorial board", "Professional society", "Industry / advisory", "Policy contribution", "Other");
	static final List<String> SUPERVISION_DEGREES = List.of("PhD", "MPhil", "Masters");
	static final List<String> SUPERVISION_STATUS = List.of("Current", "Completed");
	/** Follow me links and the sites each may point to (PROFILE_LINKS in types.ts); empty = any https address. */
	static final Map<String, List<String>> LINKS = new LinkedHashMap<>();
	static final Map<String, String> LINK_LABEL = Map.of("linkedin", "LinkedIn", "twitter", "X (Twitter)", "researchgate", "ResearchGate", "github", "GitHub", "youtube", "YouTube", "ssrn", "SSRN", "website", "Personal website");
	static {
		LINKS.put("linkedin", List.of("linkedin.com"));
		LINKS.put("twitter", List.of("x.com", "twitter.com"));
		LINKS.put("researchgate", List.of("researchgate.net"));
		LINKS.put("github", List.of("github.com"));
		LINKS.put("youtube", List.of("youtube.com", "youtu.be"));
		LINKS.put("ssrn", List.of("ssrn.com"));
		LINKS.put("website", List.of());
	}
	static final List<String> PROFILE_KEYS = List.of("dob", "gender", "address", "summary", "researchInterests", "googleScholar", "phdGuided", "phdOngoing", "qualifications", "experience",
		"memberships", "expertise", "keywords", "sdgs", "photo", "scholar", "primaryInterest", "highlights", "teaching", "supervision", "availableToSupervise", "availableForMedia",
		"engagement", "media", "office", "links");
	static final Map<String, String> FIELD_LABEL = new LinkedHashMap<>();
	static {
		String[] l = { "dob", "Date of birth", "gender", "Gender", "address", "Address", "summary", "Biography", "researchInterests", "Research interests", "googleScholar", "Google Scholar link",
			"phdGuided", "Ph.D. guided", "phdOngoing", "Ph.D. ongoing", "qualifications", "Qualifications", "experience", "Experience", "memberships", "Memberships",
			"expertise", "Areas of expertise", "keywords", "Keywords", "sdgs", "SDGs", "photo", "Photograph", "scholar", "Google Scholar metrics",
			"primaryInterest", "Primary interest", "highlights", "Highlights", "teaching", "Teaching", "supervision", "Supervision", "availableToSupervise", "Available to supervise",
			"availableForMedia", "Available for media comment", "engagement", "Engagement", "media", "Media coverage", "office", "Office location", "links", "Profile links",
			"email", "Email", "phone", "Phone", "orcid", "ORCID", "scopusId", "Scopus ID" };
		for (int i = 0; i < l.length; i += 2) FIELD_LABEL.put(l[i], l[i + 1]);
	}

	private final JdbcClient db;
	private final Records records;
	private final InstitutionSettings settings;

	private final Notifier notifier;
	private final DecisionMail decisionMail;

	public Profiles(@Qualifier("tenantJdbc") JdbcClient db, Records records, InstitutionSettings settings, Notifier notifier, DecisionMail decisionMail) {
		this.notifier = notifier;
		this.decisionMail = decisionMail;
		this.db = db;
		this.records = records;
		this.settings = settings;
	}

	// ---------- faculty (official details) ----------

	/** Every faculty profile (researchers with an employee code), in the UI's Faculty shape. */
	public List<Map<String, Object>> faculty() {
		return db.sql("SELECT * FROM researcher WHERE employee_id IS NOT NULL ORDER BY id").query((r, n) -> {
			Map<String, Object> f = new LinkedHashMap<>();
			f.put("id", r.getString("employee_id"));
			f.put("title", r.getString("title"));
			f.put("name", r.getString("name"));
			f.put("designation", r.getString("designation"));
			f.put("department", r.getString("department"));
			f.put("email", Objects.toString(r.getString("email"), ""));
			f.put("phone", r.getString("phone"));
			f.put("joiningDate", r.getString("joining_date"));
			f.put("orcid", Objects.toString(r.getString("orcid"), ""));
			f.put("scopusId", Objects.toString(r.getString("scopus_id"), ""));
			f.put("active", r.getBoolean("active"));
			if (!r.getBoolean("active")) { f.put("exitReason", r.getString("exit_reason")); f.put("exitDate", r.getString("exit_date")); }
			return f;
		}).list();
	}

	Optional<Map<String, Object>> facultyById(String code) { return faculty().stream().filter(f -> f.get("id").equals(code)).findFirst(); }

	/** Official details, and recording that someone has left (G20, G35). Office of Research only. */
	public void saveFaculty(Actor a, String code, Map<String, Object> in) {
		if (!a.isAdmin()) throw forbid("Only the Office of Research can do this.");
		Map<String, Object> current = facultyById(code).orElseThrow(() -> notFound("Faculty member"));
		String name = Json.str(in.get("name"), 200).trim(), department = Json.str(in.get("department"), 200);
		if (name.isEmpty()) throw invalid("Name is required.");
		if (!settings.departments().contains(department)) throw invalid("Choose one of the institution’s departments.");
		boolean active = !Boolean.FALSE.equals(in.get("active"));
		String exitReason = "", exitDate = "", joining = Json.str(in.get("joiningDate"), 10);
		if (!active) {
			exitReason = Json.str(in.get("exitReason"), 40);
			exitDate = Json.str(in.get("exitDate"), 10);
			if (!EXIT_REASONS.contains(exitReason)) throw invalid("Choose why the faculty member left: Retired, Resigned, Transferred or Other.");
			if (!exitDate.matches("\\d{4}-\\d{2}-\\d{2}")) throw invalid("Enter the last working day.");
			if (!joining.isEmpty() && exitDate.compareTo(joining) < 0) throw invalid("The last working day cannot be before the joining date.");
		}
		if (!validPhone(Json.str(in.get("phone"), 20))) throw invalid(PHONE_RULE);
		db.sql("""
			UPDATE researcher SET title = :t, name = :n, designation = :d, department = :dep, email = :e, phone = :p, joining_date = :j, orcid = :o, scopus_id = :s,
			active = :a, exit_reason = :er, exit_date = :ed WHERE employee_id = :code""")
			.param("t", Json.str(in.get("title"), 10)).param("n", name).param("d", Json.str(in.get("designation"), 100)).param("dep", department)
			.param("e", Json.str(in.get("email"), 200).trim()).param("p", Json.str(in.get("phone"), 20)).param("j", joining).param("o", Json.str(in.get("orcid"), 19))
			.param("s", Json.str(in.get("scopusId"), 20)).param("a", active).param("er", exitReason).param("ed", exitDate).param("code", current.get("id")).update();
	}

	static final String PHONE_RULE = "Enter a valid phone number (digits, spaces, + and -, 7 to 15 characters).";
	/** Empty, or 7-15 digits, spaces, + and - (the rule a grant's contact number already follows). QA finding 2026-11-20. */
	static boolean validPhone(String phone) { return phone == null || phone.isBlank() || phone.trim().matches("[0-9+\\- ]{7,15}"); }

	// ---------- biodata ----------

	public List<Map<String, Object>> biodata() {
		return db.sql("SELECT faculty, data::text AS data, updated_at FROM biodata ORDER BY faculty").query((r, n) -> {
			Map<String, Object> b = normalize(Json.map(r.getString("data")), r.getString("faculty"));
			b.put("updatedAt", r.getTimestamp("updated_at").toInstant().toString());
			return b;
		}).list();
	}

	Optional<Map<String, Object>> biodataOf(String code) { return biodata().stream().filter(b -> code.equals(b.get("facultyId"))).findFirst(); }

	static Map<String, Object> blank(String code) {
		return Json.of("facultyId", code, "dob", "", "gender", "", "address", "", "summary", "", "researchInterests", "", "googleScholar", "", "phdGuided", 0L, "phdOngoing", 0L,
			"qualifications", new ArrayList<>(), "experience", new ArrayList<>(), "awards", new ArrayList<>(), "memberships", new ArrayList<>(), "expertise", "", "keywords", "",
			"sdgs", new ArrayList<>(), "photo", "", "scholar", Json.of("citations", null, "hIndex", null, "i10Index", null, "updatedAt", "", "updatedBy", ""),
			"primaryInterest", "", "highlights", new ArrayList<>(), "teaching", new ArrayList<>(), "supervision", new ArrayList<>(), "availableToSupervise", false,
			"availableForMedia", false, "engagement", new ArrayList<>(), "media", new ArrayList<>(), "office", "", "links", blankLinks(), "updatedAt", Records.now());
	}

	static Map<String, Object> blankLinks() {
		Map<String, Object> l = new LinkedHashMap<>();
		for (String k : LINKS.keySet()) l.put(k, "");
		return l;
	}

	/** Fills in fields added after a biodata document was stored (normalizeBiodata). */
	static Map<String, Object> normalize(Map<String, Object> b, String code) {
		Map<String, Object> out = blank(code);
		out.putAll(b);
		out.put("facultyId", code);
		Map<String, Object> scholar = Json.obj(blank(code).get("scholar"));
		scholar.putAll(Json.obj(b.get("scholar")));
		out.put("scholar", scholar);
		Map<String, Object> links = blankLinks();
		links.putAll(Json.obj(b.get("links")));
		out.put("links", links);
		if (!(b.get("sdgs") instanceof List)) out.put("sdgs", new ArrayList<>());
		return out;
	}

	public void putBiodata(String code, Map<String, Object> b) {
		db.sql("INSERT INTO biodata(faculty, data, updated_at) VALUES (:f, CAST(:d AS jsonb), now()) ON CONFLICT (faculty) DO UPDATE SET data = EXCLUDED.data, updated_at = now()")
			.param("f", code).param("d", Json.write(b)).update();
	}

	/** Ph.D. guided and ongoing counted from the scholars listed under supervision; null when no Ph.D. scholar is listed (G37). */
	static long[] phdCounts(List<Object> supervision) {
		var phd = supervision.stream().map(Json::obj).filter(x -> "PhD".equals(x.get("degree"))).toList();
		return phd.isEmpty() ? null : new long[] { phd.stream().filter(x -> "Completed".equals(x.get("status"))).count(), phd.stream().filter(x -> "Current".equals(x.get("status"))).count() };
	}

	static boolean linkAllowed(String key, String url) {
		try {
			URI u = URI.create(url);
			if (!"https".equals(u.getScheme()) || u.getHost() == null) return false;
			String host = u.getHost().toLowerCase();
			List<String> hosts = LINKS.getOrDefault(key, List.of());
			return hosts.isEmpty() || hosts.stream().anyMatch(h -> host.equals(h) || host.endsWith("." + h));
		} catch (IllegalArgumentException e) { return false; }
	}

	private static Long metric(Object v, boolean[] bad) {
		if (v == null || "".equals(v)) return null;
		if (v instanceof Number n && n.doubleValue() >= 0 && !Double.isInfinite(n.doubleValue())) return Math.round(n.doubleValue());
		bad[0] = true;
		return null;
	}

	private static List<Object> rows(Object v, String... keys) {
		return new ArrayList<>(Json.take(v, 50, x -> { Map<String, Object> m = new LinkedHashMap<>(); for (String k : keys) m.put(k, Json.str(x.get(k), 300)); return (Object) m; }));
	}

	/** Checks and cleans a proposed profile (cleanBiodata). Google Scholar metrics keep their stamp unless the numbers changed. */
	static Map<String, Object> clean(Map<String, Object> b, Map<String, Object> prev, String code, String by) {
		Map<String, Object> inS = Json.obj(b.get("scholar"));
		boolean[] bad = { false };
		Long cit = metric(inS.get("citations"), bad), h = metric(inS.get("hIndex"), bad), i10 = metric(inS.get("i10Index"), bad);
		if (bad[0]) throw invalid("Google Scholar metrics must be whole numbers of 0 or more, or left blank.");
		if (h != null && cit != null && h * h > cit) throw invalid("The h-index cannot be that high for this citation count. Copy the values exactly from the Google Scholar profile.");
		if (h != null && i10 != null && h >= 10 && i10 < h) throw invalid("With an h-index of 10 or more, the i10-index is at least the h-index. Check the values on the Google Scholar profile.");
		Map<String, Object> old = prev == null ? Json.obj(blank(code).get("scholar")) : Json.obj(prev.get("scholar"));
		boolean changed = !Objects.equals(cit, toLong(old.get("citations"))) || !Objects.equals(h, toLong(old.get("hIndex"))) || !Objects.equals(i10, toLong(old.get("i10Index")));
		Map<String, Object> scholar = changed ? Json.of("citations", cit, "hIndex", h, "i10Index", i10, "updatedAt", Records.now(), "updatedBy", by) : old;
		String photo = Json.str(b.get("photo"), 400_000);
		if (!photo.isEmpty() && !photo.matches("data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+")) throw invalid("The photograph must be a JPEG, PNG or WebP image.");
		TreeSet<Long> sdgs = new TreeSet<>();
		for (Object x : Json.arr(b.get("sdgs"))) if (x instanceof Number n && n.doubleValue() == Math.rint(n.doubleValue()) && n.longValue() >= 1 && n.longValue() <= 17) sdgs.add(n.longValue());
		String scholarUrl = Json.str(b.get("googleScholar"), 300).trim();
		if (!scholarUrl.isEmpty() && !scholarUrl.matches("https://scholar\\.google\\.[a-z.]+/.*")) throw invalid("The Google Scholar link must start with https://scholar.google.");
		String dob = Json.str(b.get("dob"), 10);
		if (!dob.isEmpty() && dob.compareTo(Records.today()) > 0) throw invalid("Date of birth cannot be in the future.");
		List<Object> supervision = new ArrayList<>(rows(b.get("supervision"), "name", "degree", "status", "year", "topic").stream().map(Json::obj).filter(x -> !Json.str(x.get("name")).isBlank())
			.map(x -> { x.put("degree", SUPERVISION_DEGREES.contains(x.get("degree")) ? x.get("degree") : "PhD"); x.put("status", SUPERVISION_STATUS.contains(x.get("status")) ? x.get("status") : "Current"); return (Object) x; }).toList());
		long[] phd = phdCounts(supervision);
		List<Object> media = new ArrayList<>(rows(b.get("media"), "headline", "outlet", "date", "url").stream().map(Json::obj).filter(x -> !Json.str(x.get("headline")).isBlank())
			.map(x -> { String url = Json.str(x.get("url")); if (!url.isEmpty() && !url.matches("https?://.*")) throw invalid("Media links must start with http:// or https://."); return (Object) x; }).toList());
		Map<String, Object> inLinks = Json.obj(b.get("links")), links = new LinkedHashMap<>();
		for (String k : LINKS.keySet()) {
			String v = Json.str(inLinks.get(k), 300).trim();
			if (!v.isEmpty() && !linkAllowed(k, v)) throw invalid(LINKS.get(k).isEmpty() ? "The " + LINK_LABEL.get(k) + " link must start with https://." : "The " + LINK_LABEL.get(k) + " link must be an https:// address on " + String.join(" or ", LINKS.get(k)) + ".");
			links.put(k, v);
		}
		LinkedHashSet<String> highlights = new LinkedHashSet<>();
		for (Object x : Json.arr(b.get("highlights"))) { String s = Json.str(x, 40); if (highlights.size() < 6 && s.matches("(publications|grants|seedMoney|conferences|awards|ipr):[A-Z]+\\d+")) highlights.add(s); }

		Map<String, Object> out = new LinkedHashMap<>();
		out.put("facultyId", code);
		out.put("dob", dob);
		out.put("gender", Json.str(b.get("gender"), 40));
		out.put("address", Json.str(b.get("address"), 500));
		out.put("summary", Json.str(b.get("summary"), 3000));
		out.put("researchInterests", Json.str(b.get("researchInterests"), 1000));
		out.put("googleScholar", scholarUrl);
		out.put("phdGuided", phd != null ? (Object) phd[0] : Json.num(b.get("phdGuided")));
		out.put("phdOngoing", phd != null ? (Object) phd[1] : Json.num(b.get("phdOngoing")));
		out.put("qualifications", rows(b.get("qualifications"), "degree", "specialization", "institution", "year"));
		out.put("experience", rows(b.get("experience"), "organisation", "designation", "from", "to"));
		out.put("awards", prev == null ? new ArrayList<>() : prev.getOrDefault("awards", new ArrayList<>()));
		out.put("memberships", rows(b.get("memberships"), "body", "type", "since"));
		out.put("expertise", Json.str(b.get("expertise"), 1000));
		out.put("keywords", Json.str(b.get("keywords"), 500));
		out.put("sdgs", new ArrayList<>(sdgs));
		out.put("photo", photo);
		out.put("scholar", scholar);
		out.put("primaryInterest", Json.str(b.get("primaryInterest"), 120).trim());
		out.put("highlights", new ArrayList<>(highlights));
		out.put("teaching", new ArrayList<>(rows(b.get("teaching"), "code", "title", "level").stream().filter(x -> !Json.str(Json.obj(x).get("title")).isBlank()).toList()));
		out.put("supervision", supervision);
		out.put("availableToSupervise", Json.bool(b.get("availableToSupervise")));
		out.put("availableForMedia", Json.bool(b.get("availableForMedia")));
		out.put("engagement", new ArrayList<>(rows(b.get("engagement"), "type", "role", "organisation", "from", "to").stream().map(Json::obj)
			.filter(x -> !Json.str(x.get("organisation")).isBlank() || !Json.str(x.get("role")).isBlank())
			.map(x -> { x.put("type", ENGAGEMENT_TYPES.contains(x.get("type")) ? x.get("type") : "Other"); return (Object) x; }).toList()));
		out.put("media", media);
		out.put("office", Json.str(b.get("office"), 200));
		out.put("links", links);
		out.put("updatedAt", prev == null ? Records.now() : prev.getOrDefault("updatedAt", Records.now()));
		return out;
	}

	private static Long toLong(Object v) { return v instanceof Number n ? n.longValue() : null; }

	// ---------- profile updates (G17) ----------

	public List<Map<String, Object>> profileChanges(String where, Map<String, Object> params) {
		var q = db.sql("SELECT id, faculty, status, biodata::text AS b, contact::text AS c, changed::text AS ch, created_at, updated_at FROM profile_change" + where + " ORDER BY updated_at DESC");
		for (var e : params.entrySet()) q = q.param(e.getKey(), e.getValue());
		List<Map<String, Object>> rows = q.query((r, n) -> Json.of("id", r.getString("id"), "facultyId", r.getString("faculty"), "status", r.getString("status"),
			"createdAt", r.getTimestamp("created_at").toInstant().toString(), "updatedAt", r.getTimestamp("updated_at").toInstant().toString(),
			"biodata", normalize(Json.map(r.getString("b")), r.getString("faculty")), "contact", Json.map(r.getString("c")), "changed", Json.list(r.getString("ch")))).list();
		var history = records.history(rows.stream().map(m -> (String) m.get("id")).toList());
		for (var m : rows) m.put("history", history.getOrDefault((String) m.get("id"), new ArrayList<>()));
		return rows;
	}

	/** A faculty member proposes changes to their own profile; the live profile changes only when the Office approves. */
	public String propose(Actor a, Map<String, Object> biodataIn, Map<String, Object> contactIn, boolean submit) {
		if (!a.isFaculty()) throw forbid("Profiles are updated by the faculty member, and approved by the Office of Research.");
		String me = records.facultyCode(a);
		Map<String, Object> f = facultyById(me).orElseThrow(() -> forbid("Your faculty profile is inactive."));
		var open = profileChanges(" WHERE faculty = :f AND status IN ('Draft','Submitted','UnderReview','Rework')", Map.of("f", me)).stream().findFirst();
		if (open.isPresent() && "UnderReview".equals(open.get().get("status"))) throw forbid("Your profile update is being reviewed by the Office of Research. You can change it again after the review.");
		Map<String, Object> prev = biodataOf(me).orElse(null);
		Map<String, Object> bio = clean(biodataIn, prev, me, a.name());
		Map<String, Object> contact = Json.of("email", Json.str(contactIn.get("email"), 200).trim(), "phone", Json.str(contactIn.get("phone"), 20),
			"orcid", Json.str(contactIn.get("orcid"), 19).trim(), "scopusId", Json.str(contactIn.get("scopusId"), 20).trim());
		if (!((String) contact.get("email")).matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) throw invalid("Enter a valid email address.");
		if (!validPhone((String) contact.get("phone"))) throw invalid(PHONE_RULE);
		String orcid = (String) contact.get("orcid");
		if (!orcid.isEmpty() && !orcid.matches("\\d{4}-\\d{4}-\\d{4}-\\d{3}[\\dX]")) throw invalid("ORCID must look like 0000-0002-1825-0097.");
		Map<String, Object> base = prev == null ? blank(me) : prev;
		List<String> changed = new ArrayList<>();
		for (String k : PROFILE_KEYS) if (!Json.write(bio.get(k)).equals(Json.write(base.get(k)))) changed.add(FIELD_LABEL.get(k));
		for (String k : List.of("email", "phone", "orcid", "scopusId")) if (!Objects.equals(contact.get(k), f.get(k))) changed.add(FIELD_LABEL.get(k));
		if (changed.isEmpty()) throw invalid("Nothing has changed compared with your approved profile.");
		String at = Records.now();
		String id = open.map(o -> (String) o.get("id")).orElseGet(() -> records.nextId("PRF"));
		String prevStatus = open.map(o -> (String) o.get("status")).orElse(null);
		String status = submit ? "Submitted" : "Submitted".equals(prevStatus) ? "Submitted" : prevStatus == null ? "Draft" : prevStatus;
		db.sql("""
			INSERT INTO profile_change(id, faculty, status, biodata, contact, changed, created_at, updated_at)
			VALUES (:id, :f, :s, CAST(:b AS jsonb), CAST(:c AS jsonb), CAST(:ch AS jsonb), CAST(:at AS timestamptz), CAST(:at AS timestamptz))
			ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, biodata = EXCLUDED.biodata, contact = EXCLUDED.contact, changed = EXCLUDED.changed, updated_at = EXCLUDED.updated_at""")
			.param("id", id).param("f", me).param("s", status).param("b", Json.write(bio)).param("c", Json.write(contact)).param("ch", Json.write(changed)).param("at", at).update();
		records.event(id, at, a.name(), open.isPresent() ? "Edited" : "Created", null);
		if (submit) {
			records.event(id, at, a.name(), "Rework".equals(prevStatus) ? "Resubmitted" : "Submitted", null);
			notifier.office(("Rework".equals(prevStatus) ? "Resubmitted: " : "New submission: ") + "profile update " + id, a.name() + " changed: " + String.join(", ", changed), "/approvals?view=awaiting&kind=profiles");
			decisionMail.submitted("profiles", id, "", a.name(), "Rework".equals(prevStatus), "Changed: " + String.join(", ", changed));
		}
		return id;
	}

	public void startReview(Actor a, String id) {
		Records.requireOffice(a);
		var c = profileChanges(" WHERE id = :id", Map.of("id", id)).stream().findFirst().orElseThrow(() -> notFound("Profile update"));
		if ("UnderReview".equals(c.get("status"))) return;
		if (!"Submitted".equals(c.get("status"))) throw invalid("Only submitted profile updates can be reviewed.");
		String at = Records.now();
		db.sql("UPDATE profile_change SET status = 'UnderReview', updated_at = CAST(:at AS timestamptz) WHERE id = :id").param("at", at).param("id", id).update();
		records.event(id, at, a.name(), "Review started", null);
	}

	/** Office decision on a profile update. Only an approval touches the live profile. */
	public void review(Actor a, String id, String decision, String remark) {
		Records.requireOffice(a);
		if (!Records.DECISIONS.contains(decision)) throw invalid("Unknown decision.");
		var c = profileChanges(" WHERE id = :id", Map.of("id", id)).stream().findFirst().orElseThrow(() -> notFound("Profile update"));
		String status = (String) c.get("status");
		if (!status.equals("Submitted") && !status.equals("UnderReview")) throw invalid("Only submitted profile updates can be reviewed.");
		String note = Json.str(remark, 1000).trim();
		if (!decision.equals("Approved") && note.isEmpty()) throw invalid("Give a remark so the faculty member knows what to change.");
		String at = Records.now();
		if (status.equals("Submitted")) records.event(id, at, a.name(), "Review started", null);
		db.sql("UPDATE profile_change SET status = :s, updated_at = CAST(:at AS timestamptz) WHERE id = :id").param("s", decision).param("at", at).param("id", id).update();
		records.event(id, at, a.name(), decision.equals("Approved") ? "Approved" : decision.equals("Rework") ? "Returned for correction" : "Rejected", note);
		String code = (String) c.get("facultyId");
		notifier.faculty(code, (decision.equals("Approved") ? "Approved: " : decision.equals("Rework") ? "Changes requested: " : "Not approved: ") + "profile update " + id,
			decision.equals("Approved") ? "Your profile now shows the update." : note, decision.equals("Approved") ? "/my-profile" : "/submissions");
		decisionMail.decided(code, "profiles", id, "", decision, note); // emailed like entry decisions
		if (!decision.equals("Approved")) return;
		Map<String, Object> bio = new LinkedHashMap<>(Json.obj(c.get("biodata")));
		bio.put("updatedAt", at);
		putBiodata(code, bio);
		Map<String, Object> contact = Json.obj(c.get("contact"));
		db.sql("UPDATE researcher SET email = :e, phone = :p, orcid = :o, scopus_id = :s WHERE employee_id = :code")
			.param("e", contact.get("email")).param("p", contact.get("phone")).param("o", contact.get("orcid")).param("s", contact.get("scopusId")).param("code", code).update();
	}
}
