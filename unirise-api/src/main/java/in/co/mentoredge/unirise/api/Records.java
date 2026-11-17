package in.co.mentoredge.unirise.api;

import static in.co.mentoredge.unirise.api.RuleException.forbid;
import static in.co.mentoredge.unirise.api.RuleException.invalid;
import static in.co.mentoredge.unirise.api.RuleException.notFound;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * The workflow records of the seven kinds (G4-G15, G39), ported rule for rule from rdms-web/src/lib/domain.ts:
 * faculty create, edit and submit their own entries; only the Office of Research starts reviews, approves, requests
 * changes or rejects, and records funding outcomes. Records are kept as the UI's JSON; the server indexes owner, status
 * and the faculty credited on each one.
 */
@Service
public class Records {
	public static final List<String> KINDS = List.of("publications", "grants", "seedMoney", "fdps", "conferences", "awards", "ipr");
	static final Map<String, String> PREFIX = Map.of("publications", "PUB", "grants", "GRT", "seedMoney", "SM", "fdps", "FDP", "conferences", "CNF", "awards", "AWD", "ipr", "IPR");
	static final List<String> PUB_TYPES = List.of("Journal Article", "Book", "Book Chapter", "Conference Paper", "Technical Report");
	static final List<String> AUTHOR_KINDS = List.of("Faculty", "Student", "External", "Ex-Faculty", "Ex-Student");
	static final List<String> LEVELS = List.of("Institutional", "State", "National", "International");
	static final List<String> AWARD_CATEGORIES = List.of("Award", "Honour / Distinction", "Fellowship of a Learned Society", "Best Paper / Presentation", "Academic or Editorial Recognition", "Scholarship / Travel Grant");
	static final List<String> IP_TYPES = List.of("Patent", "Design", "Copyright", "Trademark", "Other");
	static final List<String> IP_STATUSES = List.of("Filed", "Published", "Granted / Registered");
	static final List<String> IP_OWNERS = List.of("University", "Individual(s)", "Joint", "Other");
	static final List<String> GRANT_OUTCOMES = List.of("Applied", "Sanctioned", "Not Sanctioned", "Completed");
	static final List<String> DECISIONS = List.of("Approved", "Rework", "Rejected");
	static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

	/** Field name to type, per kind (SPECS in domain.ts). Workflow fields are never taken from input. */
	static final Map<String, Map<String, String>> SPECS = Map.of(
		"publications", spec("entryType:s category:s title:s doi:s month:s year:n issn:s venue:s indexing:s quartile:s impactFactor:n erfRelated:b projectReference:s openAccess:b authors:authors pdfName:s attachments:files"),
		"grants", spec("unit:s grantType:s utn:s title:s description:s callTitle:s callSource:s source:s agency:s agencyComment:s appliedDate:s appliedAmount:n durationMonths:n erfRelated:b matchingGrant:b contactNumber:s investigators:investigators enclosures:strings otherRemarks:s attachments:files"),
		"seedMoney", spec("appliedDate:s category:s title:s abstract:s requestedAmount:n investigators:investigators attachments:files"),
		"fdps", spec("role:s programmeType:s title:s organiser:s sponsoredBy:s mode:s level:s fromDate:s toDate:s hours:n outcome:s certificateName:s attachments:files"),
		"conferences", spec("participation:s conferenceName:s paperTitle:s organiser:s venue:s country:s level:s mode:s fromDate:s toDate:s proceedingsIndexed:s funding:s registrationFee:n amountClaimed:n award:s certificateName:s attachments:files"),
		"awards", spec("category:s title:s awardedBy:s level:s awardDate:s citation:s prizeAmount:n certificateName:s attachments:files"),
		"ipr", spec("ipType:s ipTypeOther:s title:s description:s stage:s applicationNumber:s filingDate:s grantDate:s office:s owner:s ownerOther:s funding:s licensed:b licensee:s coOwners:s documentName:s agreementName:s declared:b attachments:files"));

	private static Map<String, String> spec(String s) {
		Map<String, String> m = new LinkedHashMap<>();
		for (String p : s.split(" ")) { String[] kv = p.split(":"); m.put(kv[0], kv[1]); }
		return m;
	}

	private final JdbcClient db;
	private final InstitutionSettings settings;

	public Records(@Qualifier("tenantJdbc") JdbcClient db, InstitutionSettings settings) {
		this.db = db;
		this.settings = settings;
	}

	static String now() { return Instant.now().toString(); }

	static String today() { return LocalDate.now(INDIA).toString(); }

	static void requireKind(String kind) { if (!KINDS.contains(kind)) throw notFound("Entry type"); }

	// ---------- reading ----------

	/** All records of a kind, in the UI's shape (fields + id, facultyId, status, createdAt, updatedAt, history). */
	public List<Map<String, Object>> all(String kind) { return load(" WHERE kind = :k", Map.of("k", kind)); }

	public Optional<Map<String, Object>> one(String kind, String id) { return load(" WHERE kind = :k AND id = :id", Map.of("k", kind, "id", id)).stream().findFirst(); }

	private List<Map<String, Object>> load(String where, Map<String, Object> params) {
		var q = db.sql("SELECT id, owner, status, data::text AS data, created_at, updated_at FROM record" + where + " ORDER BY created_at DESC, id DESC");
		for (var e : params.entrySet()) q = q.param(e.getKey(), e.getValue());
		List<Map<String, Object>> rows = q.query((r, n) -> {
			Map<String, Object> m = Json.map(r.getString("data"));
			m.put("id", r.getString("id"));
			m.put("facultyId", r.getString("owner"));
			m.put("status", r.getString("status"));
			m.put("createdAt", r.getTimestamp("created_at").toInstant().toString());
			m.put("updatedAt", r.getTimestamp("updated_at").toInstant().toString());
			return m;
		}).list();
		if (rows.isEmpty()) return rows;
		Map<String, List<Object>> history = history(rows.stream().map(m -> (String) m.get("id")).toList());
		for (var m : rows) m.put("history", history.getOrDefault((String) m.get("id"), new ArrayList<>()));
		return rows;
	}

	/** History items in order, keyed by record or profile-update id. */
	Map<String, List<Object>> history(List<String> ids) {
		Map<String, List<Object>> out = new LinkedHashMap<>();
		if (ids.isEmpty()) return out;
		db.sql("SELECT record_id, at, by_name, action, remark FROM record_event WHERE record_id IN (:ids) ORDER BY id").param("ids", ids).query((r, n) -> {
			Map<String, Object> h = Json.of("at", r.getTimestamp("at").toInstant().toString(), "by", r.getString("by_name"), "action", r.getString("action"));
			if (r.getString("remark") != null) h.put("remark", r.getString("remark"));
			out.computeIfAbsent(r.getString("record_id"), k -> new ArrayList<>()).add(h);
			return null;
		}).list();
		return out;
	}

	void event(String id, String at, String by, String action, String remark) {
		db.sql("INSERT INTO record_event(record_id, at, by_name, action, remark) VALUES (:id, CAST(:at AS timestamptz), :by, :a, :r)")
			.param("id", id).param("at", at).param("by", by).param("a", action).param("r", remark == null || remark.isBlank() ? null : remark).update();
	}

	String nextId(String prefix) { return prefix + db.sql("SELECT nextval('display_seq')").query(Long.class).single(); }

	/** Faculty credited on a record: the owner plus internal faculty co-authors and co-investigators (G15). */
	static Set<String> credited(String kind, Map<String, Object> r) {
		Set<String> ids = new LinkedHashSet<>();
		ids.add((String) r.get("facultyId"));
		String list = kind.equals("publications") ? "authors" : kind.equals("grants") || kind.equals("seedMoney") ? "investigators" : null;
		if (list != null) for (Object x : Json.arr(r.get(list))) {
			var a = Json.obj(x);
			if ("Faculty".equals(a.get("kind")) && !Json.str(a.get("code")).isEmpty()) ids.add(Json.str(a.get("code")));
		}
		return ids;
	}

	// ---------- faculty: create, edit, submit, delete ----------

	/** The faculty member's employee code; their profile must be active. */
	String facultyCode(Actor a) {
		if (!a.isFaculty() || a.researcherId() == null) throw forbid("Entries are made by faculty members.");
		var row = db.sql("SELECT employee_id, active FROM researcher WHERE id = :r").param("r", a.researcherId())
			.query((r, n) -> new Object[] { r.getString("employee_id"), r.getBoolean("active") }).optional().orElseThrow(() -> forbid("Your faculty profile is inactive."));
		if (row[0] == null || !(Boolean) row[1]) throw forbid("Your faculty profile is inactive.");
		return (String) row[0];
	}

	/** Creates or edits the caller's entry; submit sends it for approval. Returns the id. */
	public String save(Actor a, String kind, Map<String, Object> input, boolean submit) {
		requireKind(kind);
		String me = facultyCode(a);
		if (!settings.enabled(kind)) throw forbid("This kind of entry is not used at your institution.");
		String id = Json.str(input.get("id"), 40);
		Map<String, Object> existing = id.isEmpty() ? null : one(kind, id).orElse(null);
		if (!id.isEmpty() && (existing == null || !credited(kind, existing).contains(me))) throw notFound("Entry");
		if (existing != null && !me.equals(existing.get("facultyId"))) throw forbid("You can only edit entries you created.");
		if (existing != null && !editable((String) existing.get("status"))) {
			String st = (String) existing.get("status");
			throw forbid(st.equals("Submitted") || st.equals("UnderReview") ? "This entry is with the Office of Research and is locked until it is reviewed." : "This entry is " + st.toLowerCase() + " and can no longer be edited.");
		}
		if (kind.equals("seedMoney") && existing == null && !Json.bool(settings.get().get("seedMoneyWindowOpen"))) throw forbid("The seed money window is closed for this quarter.");

		Map<String, Object> data = sanitize(kind, input);
		// A file belongs to this institution's uploads only (its key starts with the institution).
		String tenant = in.co.mentoredge.unirise.tenancy.TenantContext.require();
		for (Object f : Json.arr(data.get("attachments"))) if (!Json.str(Json.obj(f).get("key")).startsWith(tenant + "/")) throw invalid("That file belongs to another institution.");
		// Funding outcomes belong to the Office of Research: keep what is stored.
		if (kind.equals("grants")) for (String k : List.of("outcome", "sanctionDate", "sanctionedAmount", "receivedAmount")) {
			Object def = k.equals("outcome") ? "Applied" : k.equals("sanctionDate") ? "" : (Object) 0L;
			data.put(k, existing == null ? def : existing.getOrDefault(k, def));
		}
		if (kind.equals("seedMoney")) data.put("sanctionedAmount", existing == null ? 0L : existing.getOrDefault("sanctionedAmount", 0L));
		String newId = id.isEmpty() ? nextId(PREFIX.get(kind)) : id;
		String status = submit ? "Submitted" : existing == null ? "Draft" : (String) existing.get("status");
		Map<String, Object> rec = new LinkedHashMap<>(data);
		rec.put("id", newId);
		rec.put("facultyId", me);
		validate(kind, rec, submit);

		String at = now();
		if (existing == null) {
			db.sql("INSERT INTO record(id, kind, owner, status, data, created_at, updated_at) VALUES (:id, :k, :o, :s, CAST(:d AS jsonb), CAST(:at AS timestamptz), CAST(:at AS timestamptz))")
				.param("id", newId).param("k", kind).param("o", me).param("s", status).param("d", Json.write(data)).param("at", at).update();
		} else {
			db.sql("UPDATE record SET status = :s, data = CAST(:d AS jsonb), updated_at = CAST(:at AS timestamptz), version = version + 1 WHERE id = :id")
				.param("s", status).param("d", Json.write(data)).param("at", at).param("id", newId).update();
		}
		setCredits(kind, newId, rec);
		event(newId, at, a.name(), existing == null ? "Created" : "Edited", null);
		String note = Json.str(input.get("note"), 1000).trim(); // the faculty member's reply to the Office, sent with a (re)submission
		if (submit) event(newId, at, a.name(), existing != null && "Rework".equals(existing.get("status")) ? "Resubmitted" : "Submitted", note);
		return newId;
	}

	void setCredits(String kind, String id, Map<String, Object> rec) {
		db.sql("DELETE FROM record_credit WHERE record_id = :id").param("id", id).update();
		for (String f : credited(kind, rec)) db.sql("INSERT INTO record_credit(record_id, faculty) VALUES (:id, :f) ON CONFLICT DO NOTHING").param("id", id).param("f", f).update();
	}

	static boolean editable(String status) { return status.equals("Draft") || status.equals("Rework"); }

	public void delete(Actor a, String kind, String id) {
		requireKind(kind);
		String me = facultyCode(a);
		Map<String, Object> r = one(kind, id).filter(x -> credited(kind, x).contains(me)).orElseThrow(() -> notFound("Entry"));
		if (!me.equals(r.get("facultyId"))) throw forbid("You can only delete your own entries.");
		if (!"Draft".equals(r.get("status"))) throw forbid("Only drafts can be deleted.");
		db.sql("DELETE FROM record WHERE id = :id").param("id", id).update();
		db.sql("DELETE FROM record_event WHERE record_id = :id").param("id", id).update();
	}

	// ---------- Office of Research: review and outcomes ----------

	static void requireOffice(Actor a) { if (!a.isAdmin()) throw forbid("Only the Office of Research can approve entries."); }

	/** Opening a submitted entry starts its review: Submitted → Under Review. Already under review: no change. */
	public void startReview(Actor a, String kind, String id) {
		requireOffice(a);
		requireKind(kind);
		Map<String, Object> r = one(kind, id).orElseThrow(() -> notFound("Entry"));
		if ("UnderReview".equals(r.get("status"))) return;
		if (!"Submitted".equals(r.get("status"))) throw invalid("Only submitted entries can be reviewed.");
		String at = now();
		db.sql("UPDATE record SET status = 'UnderReview', updated_at = CAST(:at AS timestamptz) WHERE id = :id").param("at", at).param("id", id).update();
		event(id, at, a.name(), "Review started", null);
	}

	/** Approve, request changes to, or reject an entry that is submitted or under review. */
	public void review(Actor a, String kind, String id, String decision, String remark, Object sanctionedAmount) {
		requireOffice(a);
		requireKind(kind);
		if (!DECISIONS.contains(decision)) throw invalid("Unknown decision.");
		Map<String, Object> r = one(kind, id).orElseThrow(() -> notFound("Entry"));
		String status = (String) r.get("status");
		if (!status.equals("Submitted") && !status.equals("UnderReview")) throw invalid("Only submitted entries can be reviewed.");
		String note = Json.str(remark, 1000).trim();
		if (!decision.equals("Approved") && note.isEmpty()) throw invalid("Give a remark so the faculty member knows what to change.");
		String at = now();
		if (status.equals("Submitted")) event(id, at, a.name(), "Review started", null); // every decision passes through review
		if (kind.equals("seedMoney") && decision.equals("Approved") && sanctionedAmount != null) {
			if (Json.dbl(sanctionedAmount) < 0) throw invalid("Sanctioned amount cannot be negative.");
			db.sql("UPDATE record SET data = jsonb_set(data, '{sanctionedAmount}', to_jsonb(CAST(:v AS numeric))) WHERE id = :id").param("v", Json.dbl(sanctionedAmount)).param("id", id).update();
		}
		db.sql("UPDATE record SET status = :s, updated_at = CAST(:at AS timestamptz) WHERE id = :id").param("s", decision).param("at", at).param("id", id).update();
		event(id, at, a.name(), decision.equals("Approved") ? "Approved" : decision.equals("Rework") ? "Returned for correction" : "Rejected", note);
	}

	/** The funding outcome of an approved grant, recorded by the Office of Research. */
	public void grantOutcome(Actor a, String id, Map<String, Object> patch) {
		requireOffice(a);
		Map<String, Object> g = one("grants", id).orElseThrow(() -> notFound("Grant"));
		if (!"Approved".equals(g.get("status"))) throw invalid("Record the outcome after the grant entry is approved.");
		String outcome = Json.str(patch.get("outcome"));
		if (!GRANT_OUTCOMES.contains(outcome)) throw invalid("Unknown outcome.");
		double sanctioned = Json.dbl(patch.get("sanctionedAmount")), received = Json.dbl(patch.get("receivedAmount"));
		if (received > sanctioned) throw invalid("Received amount cannot exceed the sanctioned amount.");
		Map<String, Object> data = Json.map(db.sql("SELECT data::text FROM record WHERE id = :id").param("id", id).query(String.class).single());
		data.put("outcome", outcome);
		data.put("sanctionDate", Json.str(patch.get("sanctionDate"), 10));
		data.put("sanctionedAmount", Json.num(patch.get("sanctionedAmount")));
		data.put("receivedAmount", Json.num(patch.get("receivedAmount")));
		String at = now();
		db.sql("UPDATE record SET data = CAST(:d AS jsonb), updated_at = CAST(:at AS timestamptz) WHERE id = :id").param("d", Json.write(data)).param("at", at).param("id", id).update();
		event(id, at, a.name(), "Outcome set to " + outcome, null);
	}

	// ---------- input cleaning and validation (sanitize and validate in domain.ts) ----------

	static Map<String, Object> sanitize(String kind, Map<String, Object> input) {
		Map<String, Object> out = new LinkedHashMap<>();
		for (var e : SPECS.get(kind).entrySet()) {
			Object v = input.get(e.getKey());
			out.put(e.getKey(), switch (e.getValue()) {
				case "s" -> Json.str(v);
				case "n" -> Json.num(v);
				case "b" -> Json.bool(v);
				case "strings" -> new ArrayList<>(Json.arr(v).stream().limit(50).map(x -> Json.str(x, 300)).filter(x -> !x.isEmpty()).toList());
				case "files" -> files(v);
				case "authors" -> Json.take(v, 100, x -> Json.of("kind", kindOf(x.get("kind")), "code", Json.str(x.get("code"), 40), "name", Json.str(x.get("name"), 200),
					"institution", Json.str(x.get("institution"), 300), "department", Json.str(x.get("department"), 300), "email", Json.str(x.get("email"), 200), "country", Json.str(x.get("country"), 80)));
				default -> Json.take(v, 30, x -> Json.of("kind", kindOf(x.get("kind")), "code", Json.str(x.get("code"), 40), "name", Json.str(x.get("name"), 200),
					"role", List.of("PI", "Co-PI", "Co-I").contains(x.get("role")) ? x.get("role") : "Co-I", "institution", Json.str(x.get("institution"), 300),
					"department", Json.str(x.get("department"), 300), "sharePct", Json.num(x.get("sharePct")), "country", Json.str(x.get("country"), 80)));
			});
		}
		return out;
	}

	private static String kindOf(Object v) { return AUTHOR_KINDS.contains(v) ? (String) v : "External"; }

	/** Where an uploaded file is stored: <institution>/<uploader>/<uuid>/<file name> in the uploads bucket (UploadController). */
	static final java.util.regex.Pattern FILE_KEY = java.util.regex.Pattern.compile("^[a-z][a-z0-9_]{2,30}/[0-9]{1,18}/[0-9a-f-]{36}/[^/\\\\]{1,150}$");

	/** Files attached to a record: which form field, where it is stored, its name and size. Anything else is dropped. */
	static List<Map<String, Object>> files(Object v) {
		List<Map<String, Object>> out = new ArrayList<>();
		for (Object x : Json.arr(v)) {
			if (out.size() >= 30) break;
			Map<String, Object> f = Json.obj(x);
			String key = Json.str(f.get("key"), 400), field = Json.str(f.get("field"), 40);
			if (!FILE_KEY.matcher(key).matches() || !field.matches("^[a-zA-Z]{1,40}$")) continue;
			out.add(Json.of("field", field, "key", key, "name", Json.str(f.get("name"), 150), "size", Json.num(f.get("size"))));
		}
		return out;
	}

	private static void need(Object v, String label) {
		boolean empty = v instanceof String s ? s.isBlank() : v == null || Boolean.FALSE.equals(v) || (v instanceof Number n && n.doubleValue() == 0);
		if (empty) throw invalid(label + " is required.");
	}

	void validate(String kind, Map<String, Object> r, boolean submit) {
		String today = today(), owner = (String) r.get("facultyId");
		Map<String, Object> limits = Json.obj(settings.get().get("limits"));
		switch (kind) {
			case "publications" -> {
				if (!PUB_TYPES.contains(r.get("entryType"))) throw invalid("Choose an entry type.");
				need(r.get("title"), "Title");
				need(r.get("venue"), "Venue");
				long year = Json.num(r.get("year")).longValue();
				if (year > LocalDate.now(INDIA).getYear() || year < 1950) throw invalid("Enter a valid publication year.");
				if (Json.arr(r.get("authors")).stream().noneMatch(x -> owner.equals(Json.obj(x).get("code")))) throw invalid("You must be listed as one of the authors.");
				String doi = Json.str(r.get("doi")).trim().toLowerCase();
				if (!doi.isEmpty()) db.sql("SELECT id FROM record WHERE kind = 'publications' AND id <> :id AND lower(trim(data->>'doi')) = :d").param("id", r.get("id")).param("d", doi).query(String.class).optional()
					.ifPresent(dup -> { throw invalid("This DOI is already entered as " + dup + ". Ask the owner to add you as an author instead."); });
				if (submit && !"Book".equals(r.get("entryType")) && Json.str(r.get("pdfName")).isEmpty() && !Boolean.FALSE.equals(limits.get("pdfRequired"))) throw invalid("Upload the PDF before submitting (optional for books).");
			}
			case "grants", "seedMoney" -> {
				need(r.get("title"), "Title");
				if (kind.equals("grants")) { need(r.get("agency"), "Grant agency"); if (Json.dbl(r.get("appliedAmount")) <= 0) throw invalid("Enter the applied amount."); }
				double max = Json.dbl(limits.getOrDefault("seedMoneyMax", 500000L));
				if (kind.equals("seedMoney") && (Json.dbl(r.get("requestedAmount")) <= 0 || Json.dbl(r.get("requestedAmount")) > max)) throw invalid("Requested amount must be between ₹1 and ₹" + java.text.NumberFormat.getIntegerInstance(java.util.Locale.of("en", "IN")).format((long) max) + ".");
				List<Object> inv = Json.arr(r.get("investigators"));
				if (inv.stream().noneMatch(x -> owner.equals(Json.obj(x).get("code")))) throw invalid("You must be one of the investigators.");
				if (Math.abs(inv.stream().mapToDouble(x -> Json.dbl(Json.obj(x).get("sharePct"))).sum() - 100) > 1e-9) throw invalid("Investigator shares must add up to 100%.");
				if (inv.stream().filter(x -> "PI".equals(Json.obj(x).get("role"))).count() != 1) throw invalid("There must be exactly one PI.");
			}
			case "fdps", "conferences" -> {
				need(kind.equals("fdps") ? r.get("title") : r.get("conferenceName"), kind.equals("fdps") ? "Programme title" : "Conference name");
				need(r.get("fromDate"), "From date");
				need(r.get("toDate"), "To date");
				if (Json.str(r.get("toDate")).compareTo(Json.str(r.get("fromDate"))) < 0) throw invalid("To date must be on or after the from date.");
				if (Json.str(r.get("toDate")).compareTo(today) > 0) throw invalid("Enter it after it has taken place.");
			}
			case "awards" -> {
				if (!AWARD_CATEGORIES.contains(r.get("category"))) throw invalid("Choose a category.");
				need(r.get("title"), "Name of the honour or award");
				need(r.get("awardedBy"), "Conferred by");
				need(r.get("awardDate"), "Date received");
				if (!LEVELS.contains(r.get("level"))) throw invalid("Choose a level.");
				if (Json.str(r.get("awardDate")).compareTo(today) > 0) throw invalid("Enter an honour after it has been received.");
				if (Json.dbl(r.get("prizeAmount")) < 0) throw invalid("Prize amount cannot be negative.");
			}
			case "ipr" -> {
				if (!IP_TYPES.contains(r.get("ipType"))) throw invalid("Choose the type of IP.");
				if ("Other".equals(r.get("ipType"))) need(r.get("ipTypeOther"), "The type of IP (other)");
				need(r.get("title"), "Title");
				need(r.get("description"), "Brief description");
				String desc = Json.str(r.get("description")).trim();
				if (!desc.isEmpty() && desc.split("\\s+").length > 50) throw invalid("Keep the brief description to 50 words.");
				if (!IP_STATUSES.contains(r.get("stage"))) throw invalid("Choose the status.");
				need(r.get("applicationNumber"), "Application / registration number");
				need(r.get("filingDate"), "Filing date");
				need(r.get("office"), "Office / country");
				String filed = Json.str(r.get("filingDate")), granted = Json.str(r.get("grantDate"));
				if (filed.compareTo(today) > 0) throw invalid("Enter it after it has been filed.");
				if (!granted.isEmpty() && granted.compareTo(filed) < 0) throw invalid("The grant / registration date cannot be before the filing date.");
				if (granted.compareTo(today) > 0) throw invalid("The grant / registration date cannot be in the future.");
				if (!IP_OWNERS.contains(r.get("owner"))) throw invalid("Choose the registered owner / applicant.");
				if ("Other".equals(r.get("owner"))) need(r.get("ownerOther"), "The registered owner / applicant (other)");
				if (Json.bool(r.get("licensed"))) need(r.get("licensee"), "Partner name");
				db.sql("SELECT id FROM record WHERE kind = 'ipr' AND id <> :id AND lower(trim(data->>'applicationNumber')) = :n").param("id", r.get("id")).param("n", Json.str(r.get("applicationNumber")).trim().toLowerCase())
					.query(String.class).optional().ifPresent(dup -> { throw invalid("This application / registration number is already entered as " + dup + "."); });
				if (submit && Json.str(r.get("documentName")).isEmpty()) throw invalid("Attach the filing receipt or registration certificate before submitting.");
				if (submit && !Json.bool(r.get("declared"))) throw invalid("Confirm the declaration before submitting.");
			}
			default -> throw new RuleException(HttpStatus.NOT_FOUND, "Entry type not found.");
		}
	}
}
