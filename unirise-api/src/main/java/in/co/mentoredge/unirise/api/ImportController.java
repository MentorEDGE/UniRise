package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import in.co.mentoredge.unirise.tenancy.TenantRoutingDataSource;

/**
 * CSV onboarding for org units and people (TRD 9a). A preview lists every row's problems and what would happen; a commit is refused while any row
 * has an error, and runs in one transaction. Re-running the same file only updates, so HR can stay the source of truth.
 */
@RestController
@RequestMapping("/api/imports")
public class ImportController {
	public record Row(int line, Map<String, String> values, List<String> errors, String action) {}
	public record Preview(String kind, List<Row> rows, long ok, long failed, long creates, long updates) {}
	public record Result(long created, long updated, long skipped) {}

	private static final int MAX_ROWS = 5000, MAX_BYTES = 2 * 1024 * 1024;
	private static final Set<String> KINDS = Set.of("faculty", "scholar", "student", "staff", "guest");
	private static final Set<String> UNIT_TYPES = Set.of("campus", "school", "department", "group");

	private final JdbcClient db;
	private final AccessService access;
	private final OrgTree tree;
	private final TransactionTemplate tx;

	public ImportController(@Qualifier("tenantJdbc") JdbcClient db, AccessService access, OrgTree tree, TenantRoutingDataSource ds) {
		this.db = db;
		this.access = access;
		this.tree = tree;
		this.tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
	}

	@PostMapping(value = "/{kind}", consumes = { "text/csv", "text/plain" })
	Object run(@PathVariable String kind, @RequestParam(defaultValue = "false") boolean commit, @RequestBody String csv, HttpServletRequest req) {
		access.requireAdmin(access.actor(req));
		if (!kind.equals("people") && !kind.equals("org-units")) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
		if (csv.length() > MAX_BYTES) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE);
		List<List<String>> table = Csv.parse(csv);
		if (table.size() < 2) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "no rows");
		if (table.size() - 1 > MAX_ROWS) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE);
		List<String> header = table.get(0).stream().map(String::trim).toList();
		Preview p = kind.equals("people") ? people(header, table) : units(header, table);
		if (!commit) return p;
		if (p.failed() > 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "fix the errors first");
		return tx.execute(st -> apply(kind, p));
	}

	private static Map<String, String> values(List<String> header, List<String> cells) {
		var m = new LinkedHashMap<String, String>();
		for (int i = 0; i < header.size(); i++) m.put(header.get(i), i < cells.size() ? cells.get(i).trim() : "");
		return m;
	}

	private Preview people(List<String> header, List<List<String>> table) {
		if (!header.contains("name")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "missing column: name");
		List<Row> rows = new ArrayList<>();
		Set<String> seen = new HashSet<>();
		for (int i = 1; i < table.size(); i++) {
			var v = values(header, table.get(i));
			List<String> err = new ArrayList<>();
			if (v.get("name").isBlank()) err.add("name is required");
			String email = v.getOrDefault("email", ""), orcid = v.getOrDefault("orcid", ""), kind = v.getOrDefault("kind", ""), dept = v.getOrDefault("department", "");
			if (!email.isEmpty() && !email.matches("[^@\\s]+@[^@\\s]+")) err.add("email is not valid");
			if (!orcid.isEmpty() && !orcid.matches("\\d{4}-\\d{4}-\\d{4}-\\d{3}[\\dX]")) err.add("ORCID must look like 0000-0002-1825-0097");
			if (!kind.isEmpty() && !KINDS.contains(kind)) err.add("kind must be faculty, scholar, student, staff or guest");
			if (!dept.isEmpty() && unitIds(dept).size() != 1) err.add(unitIds(dept).isEmpty() ? "department not found" : "department name is ambiguous");
			String key = key(v);
			if (key == null) err.add("needs employeeId, rollNo or email to match the person");
			else if (!seen.add(key)) err.add("appears twice in this file");
			String action = err.isEmpty() ? (existing(v) != null ? "update" : "create") : null;
			rows.add(new Row(i + 1, v, err, action));
		}
		return summary("people", rows);
	}

	private Preview units(List<String> header, List<List<String>> table) {
		if (!header.contains("name") || !header.contains("type")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "missing column: name, type");
		List<Row> rows = new ArrayList<>();
		Set<String> planned = new HashSet<>(); // "parent|name" created earlier in this file, so a child may follow its parent
		for (int i = 1; i < table.size(); i++) {
			var v = values(header, table.get(i));
			List<String> err = new ArrayList<>();
			String name = v.get("name"), type = v.get("type"), parent = v.getOrDefault("parent", "");
			if (name.isBlank()) err.add("name is required");
			if (!UNIT_TYPES.contains(type)) err.add("type must be campus, school, department or group");
			if (!parent.isEmpty() && unitIds(parent).size() != 1 && !planned.contains("|" + parent.toLowerCase())) err.add("parent not found or ambiguous");
			boolean exists = !name.isBlank() && (planned.contains("|" + name.toLowerCase()) || db.sql("SELECT count(*) FROM org_unit WHERE lower(name) = lower(:n) AND type = :t").param("n", name).param("t", type).query(Long.class).single() > 0); // a repeat inside the same file is skipped too
			if (err.isEmpty() && !exists) planned.add("|" + name.toLowerCase());
			rows.add(new Row(i + 1, v, err, err.isEmpty() ? (exists ? "skip" : "create") : null));
		}
		return summary("org-units", rows);
	}

	private static Preview summary(String kind, List<Row> rows) {
		long failed = rows.stream().filter(r -> !r.errors().isEmpty()).count();
		return new Preview(kind, rows, rows.size() - failed, failed, rows.stream().filter(r -> "create".equals(r.action())).count(), rows.stream().filter(r -> "update".equals(r.action())).count());
	}

	private List<Long> unitIds(String name) {
		return db.sql("SELECT id FROM org_unit WHERE lower(name) = lower(:n)").param("n", name).query(Long.class).list();
	}

	/** Match order: employee ID, then roll number, then email. */
	private static String key(Map<String, String> v) {
		if (!v.getOrDefault("employeeId", "").isEmpty()) return "e:" + v.get("employeeId");
		if (!v.getOrDefault("rollNo", "").isEmpty()) return "r:" + v.get("rollNo");
		if (!v.getOrDefault("email", "").isEmpty()) return "m:" + v.get("email").toLowerCase();
		return null;
	}

	private Long existing(Map<String, String> v) {
		String k = key(v);
		String sql = k.startsWith("e:") ? "SELECT id FROM researcher WHERE employee_id = :k" : k.startsWith("r:") ? "SELECT id FROM researcher WHERE roll_no = :k" : "SELECT id FROM researcher WHERE lower(email) = :k";
		return db.sql(sql).param("k", k.substring(2)).query(Long.class).optional().orElse(null);
	}

	private Result apply(String kind, Preview p) {
		long created = 0, updated = 0, skipped = 0;
		for (Row r : p.rows()) {
			var v = r.values();
			if (kind.equals("org-units")) {
				if (r.action().equals("skip")) { skipped++; continue; }
				String parent = v.getOrDefault("parent", "");
				tree.add(parent.isEmpty() ? null : unitIds(parent).get(0), v.get("type"), v.get("name"));
				created++;
				continue;
			}
			boolean scholar = Set.of("scholar", "student").contains(v.getOrDefault("kind", ""));
			Long id = existing(v);
			if (id == null) {
				id = db.sql("INSERT INTO researcher(name, email, orcid, employee_id, roll_no, is_scholar) VALUES (:n, NULLIF(:e, ''), NULLIF(:o, ''), NULLIF(:emp, ''), NULLIF(:rn, ''), :s) RETURNING id")
					.param("n", v.get("name")).param("e", v.getOrDefault("email", "")).param("o", v.getOrDefault("orcid", "")).param("emp", v.getOrDefault("employeeId", ""))
					.param("rn", v.getOrDefault("rollNo", "")).param("s", scholar).query(Long.class).single();
				created++;
			} else {
				db.sql("UPDATE researcher SET name = :n, email = COALESCE(NULLIF(:e, ''), email), orcid = COALESCE(NULLIF(:o, ''), orcid), is_scholar = :s WHERE id = :id")
					.param("n", v.get("name")).param("e", v.getOrDefault("email", "")).param("o", v.getOrDefault("orcid", "")).param("s", scholar || false).param("id", id).update();
				updated++;
			}
			String dept = v.getOrDefault("department", "");
			if (!dept.isEmpty()) {
				long unit = unitIds(dept).get(0);
				boolean has = db.sql("SELECT count(*) FROM appointment WHERE researcher_id = :r AND org_unit_id = :u AND valid_from <= current_date AND (valid_to IS NULL OR valid_to >= current_date)").param("r", id).param("u", unit).query(Long.class).single() > 0;
				if (!has) db.sql("INSERT INTO appointment(researcher_id, org_unit_id, designation) VALUES (:r, :u, NULLIF(:d, ''))").param("r", id).param("u", unit).param("d", v.getOrDefault("title", "")).update();
			}
		}
		return new Result(created, updated, skipped);
	}
}
