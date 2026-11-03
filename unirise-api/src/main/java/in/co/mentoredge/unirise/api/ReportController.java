package in.co.mentoredge.unirise.api;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/**
 * The report catalogue (PRD R39-R41): 11 publication and 8 grant reports. Only approved publications and submitted or sanctioned grants count,
 * and every report covers only the caller's slice. Aggregates are distinct per group, so a paper is never counted twice in one row.
 */
@RestController
@RequestMapping("/api/reports")
public class ReportController {
	public record Table(List<String> columns, List<List<Object>> rows) {}
	private record Spec(boolean grants, List<String> columns, String sql) {}

	private static final String RU = """
		ru AS (SELECT ap.researcher_id, ou.name AS dept,
		  (SELECT cu.name FROM org_unit_closure c JOIN org_unit cu ON cu.id = c.ancestor_id WHERE c.descendant_id = ou.id AND cu.type = 'campus' ORDER BY c.depth DESC LIMIT 1) AS institute
		  FROM appointment ap JOIN org_unit ou ON ou.id = ap.org_unit_id WHERE ap.valid_from <= current_date AND (ap.valid_to IS NULL OR ap.valid_to >= current_date))""";
	private static final String AU = "au AS (SELECT DISTINCT a.publication_id, a.researcher_id, a.kind FROM publication_author a JOIN pubs ON pubs.id = a.publication_id WHERE a.researcher_id IS NOT NULL)";

	private static final Map<String, Spec> CATALOGUE = Map.ofEntries(
		pub("pub-university", List.of("Year", "Publications"), "SELECT pub_year, count(*) FROM pubs GROUP BY 1 ORDER BY 1"),
		pub("pub-institute-count", List.of("Institute", "Publications"),
			"SELECT COALESCE(ru.institute, 'Unassigned'), count(DISTINCT au.publication_id) FROM au JOIN ru ON ru.researcher_id = au.researcher_id GROUP BY 1 ORDER BY 2 DESC, 1"),
		pub("pub-institute-department", List.of("Institute", "Department", "Publications"),
			"SELECT COALESCE(ru.institute, 'Unassigned'), ru.dept, count(DISTINCT au.publication_id) FROM au JOIN ru ON ru.researcher_id = au.researcher_id GROUP BY 1, 2 ORDER BY 1, 2"),
		pub("pub-employee", List.of("Employee ID", "Name", "Year", "Title", "DOI"),
			"SELECT COALESCE(r.employee_id, ''), r.name, p.pub_year, p.title, COALESCE(p.doi, '') FROM au JOIN researcher r ON r.id = au.researcher_id JOIN pubs p ON p.id = au.publication_id WHERE au.kind = 'internal-faculty' ORDER BY 1, 3 DESC"),
		pub("pub-employee-count", List.of("Employee ID", "Name", "Publications"),
			"SELECT COALESCE(r.employee_id, ''), r.name, count(DISTINCT au.publication_id) FROM au JOIN researcher r ON r.id = au.researcher_id WHERE au.kind = 'internal-faculty' GROUP BY 1, 2 ORDER BY 3 DESC, 1"),
		pub("pub-roll", List.of("Roll number", "Name", "Year", "Title", "DOI"),
			"SELECT COALESCE(r.roll_no, ''), r.name, p.pub_year, p.title, COALESCE(p.doi, '') FROM au JOIN researcher r ON r.id = au.researcher_id JOIN pubs p ON p.id = au.publication_id WHERE au.kind = 'internal-student' ORDER BY 1, 3 DESC"),
		pub("pub-journal", List.of("Journal", "Publications"), "SELECT COALESCE(venue, '(none)'), count(*) FROM pubs GROUP BY 1 ORDER BY 2 DESC, 1"),
		pub("pub-faculty-journal", List.of("Journal", "Publications"),
			"SELECT COALESCE(venue, '(none)'), count(*) FROM pubs WHERE EXISTS (SELECT 1 FROM au WHERE au.publication_id = pubs.id AND au.kind = 'internal-faculty') GROUP BY 1 ORDER BY 2 DESC, 1"),
		pub("pub-student-journal", List.of("Journal", "Publications"),
			"SELECT COALESCE(venue, '(none)'), count(*) FROM pubs WHERE EXISTS (SELECT 1 FROM au WHERE au.publication_id = pubs.id AND au.kind = 'internal-student') GROUP BY 1 ORDER BY 2 DESC, 1"),
		pub("pub-inter-institution", List.of("Partner institution", "Joint publications"),
			"SELECT a.institution, count(DISTINCT a.publication_id) FROM publication_author a JOIN pubs ON pubs.id = a.publication_id WHERE a.kind IN ('external','ex-faculty','ex-student') AND a.institution IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1"),
		pub("pub-continent", List.of("Continent", "Publications"),
			"SELECT a.continent, count(DISTINCT a.publication_id) FROM publication_author a JOIN pubs ON pubs.id = a.publication_id WHERE a.kind IN ('external','ex-faculty','ex-student') AND a.continent IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1"),
		grant("grant-type", List.of("Grant type", "Grants", "Applied", "Sanctioned"),
			"SELECT COALESCE(type, '(none)'), count(*), sum(applied_amount), COALESCE(sum(sanctioned_amount), 0) FROM gr GROUP BY 1 ORDER BY 1"),
		grant("grant-institute-department", List.of("Institute", "Department", "Grants", "Applied"),
			"SELECT COALESCE(ru.institute, 'Unassigned'), COALESCE(ru.dept, 'Unassigned'), count(*), sum(gr.applied_amount) FROM gr LEFT JOIN gl ON gl.grant_id = gr.id LEFT JOIN ru ON ru.researcher_id = gl.researcher_id GROUP BY 1, 2 ORDER BY 1, 2"),
		grant("grant-institution-count", List.of("Institute", "Grants"),
			"SELECT COALESCE(ru.institute, 'Unassigned'), count(DISTINCT gr.id) FROM gr LEFT JOIN gl ON gl.grant_id = gr.id LEFT JOIN ru ON ru.researcher_id = gl.researcher_id GROUP BY 1 ORDER BY 2 DESC, 1"),
		grant("grant-year-received", List.of("Year", "Sanctioned amount"),
			"SELECT extract(year FROM sanctioned_on)::int, sum(sanctioned_amount) FROM gr WHERE sanctioned_on IS NOT NULL GROUP BY 1 ORDER BY 1"),
		grant("grant-inter-institute", List.of("Grant", "Institutions", "Names"),
			"SELECT gr.title, count(DISTINCT gi.institution), string_agg(DISTINCT gi.institution, '; ') FROM gr JOIN grant_investigator gi ON gi.grant_id = gr.id GROUP BY gr.id, gr.title HAVING count(DISTINCT gi.institution) > 1 ORDER BY 1"),
		grant("grant-sharing", List.of("Grant", "Investigator", "Role", "Share %"),
			"SELECT gr.title, gi.name, gi.role, gi.share_pct FROM gr JOIN grant_investigator gi ON gi.grant_id = gr.id ORDER BY gr.id, gi.id"),
		grant("grant-sanctioned", List.of("Grant", "Agency", "Sanctioned on", "Amount", "Months"),
			"SELECT gr.title, COALESCE(gr.agency, ''), gr.sanctioned_on, gr.sanctioned_amount, gr.duration_months FROM gr WHERE gr.status = 'sanctioned' ORDER BY gr.sanctioned_on, gr.id"),
		grant("grant-employee", List.of("Employee ID", "Investigator", "Grants", "Applied"),
			"SELECT COALESCE(r.employee_id, ''), gi.name, count(DISTINCT gr.id), sum(gr.applied_amount) FROM gr JOIN grant_investigator gi ON gi.grant_id = gr.id LEFT JOIN researcher r ON r.id = gi.researcher_id GROUP BY 1, 2 ORDER BY 3 DESC, 1"));

	private static Map.Entry<String, Spec> pub(String slug, List<String> cols, String sql) { return Map.entry(slug, new Spec(false, cols, sql)); }

	private static Map.Entry<String, Spec> grant(String slug, List<String> cols, String sql) { return Map.entry(slug, new Spec(true, cols, sql)); }

	private final JdbcClient db;
	private final AccessService access;

	public ReportController(@Qualifier("tenantJdbc") JdbcClient db, AccessService access) {
		this.db = db;
		this.access = access;
	}

	@GetMapping("/{slug}")
	Table report(@PathVariable String slug, @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to,
		@RequestParam(defaultValue = "applied") String basis, HttpServletRequest req) {
		return run(slug, from, to, basis, access.actor(req));
	}

	@GetMapping("/{slug}/export")
	ResponseEntity<byte[]> export(@PathVariable String slug, @RequestParam(defaultValue = "csv") String format, @RequestParam(required = false) LocalDate from,
		@RequestParam(required = false) LocalDate to, @RequestParam(defaultValue = "applied") String basis, HttpServletRequest req) {
		if (!format.equals("csv")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "format"); // shortcut: PDF needs a renderer, add with the printable annual report
		Table t = run(slug, from, to, basis, access.actor(req));
		StringBuilder sb = new StringBuilder("﻿").append(csvLine(new ArrayList<>(t.columns())));
		for (List<Object> row : t.rows()) sb.append(csvLine(row));
		return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + slug + ".csv\"") // slug is a catalogue key, never user text
			.contentType(new MediaType("text", "csv", StandardCharsets.UTF_8)).body(sb.toString().getBytes(StandardCharsets.UTF_8));
	}

	private Table run(String slug, LocalDate from, LocalDate to, String basis, Actor a) {
		Spec spec = CATALOGUE.get(slug);
		if (spec == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
		String dateCol = switch (basis) { case "applied" -> "applied_on"; case "entered" -> "entered_on"; case "sanctioned" -> "sanctioned_on"; default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "basis"); };
		if (from != null && to != null && to.isBefore(from)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "range");
		var v = access.visible(a);
		String with;
		if (spec.grants()) {
			with = "WITH gr AS (SELECT g.* FROM research_grant g WHERE g.status IN " + (basis.equals("sanctioned") ? "('sanctioned')" : "('submitted','sanctioned')")
				+ (v.all() ? "" : " AND g.owner_id IN (:ids)") + (from == null ? "" : " AND g." + dateCol + " >= :from") + (to == null ? "" : " AND g." + dateCol + " <= :to") + "), "
				+ "gl AS (SELECT grant_id, researcher_id FROM grant_investigator WHERE is_lead), " + RU;
		} else {
			with = "WITH pubs AS (SELECT p.* FROM publication p WHERE p.entry_status = 'approved'"
				+ (v.all() ? "" : " AND (p.owner_id IN (:ids) OR p.id IN (SELECT publication_id FROM publication_author WHERE researcher_id IN (:ids)))")
				+ (from == null ? "" : " AND p.pub_year >= :fy") + (to == null ? "" : " AND p.pub_year <= :ty") + "), " + AU + ", " + RU;
		}
		var q = db.sql(with + " " + spec.sql());
		if (!v.all()) q = q.param("ids", v.ids().isEmpty() ? java.util.Set.of(-1L) : v.ids());
		if (from != null) q = q.param("from", from).param("fy", from.getYear());
		if (to != null) q = q.param("to", to).param("ty", to.getYear());
		int n = spec.columns().size();
		List<List<Object>> rows = q.query((rs, i) -> {
			List<Object> row = new ArrayList<>(n);
			for (int c = 1; c <= n; c++) {
				Object x = rs.getObject(c);
				row.add(x == null ? "" : x instanceof java.sql.Date || x instanceof java.sql.Timestamp ? x.toString() : x);
			}
			return row;
		}).list();
		return new Table(spec.columns(), rows);
	}

	/** Cells starting with = + - @ would run as formulas in a spreadsheet, so they get a leading quote. */
	static String csvLine(List<Object> cells) {
		StringBuilder sb = new StringBuilder();
		for (int i = 0; i < cells.size(); i++) {
			String s = String.valueOf(cells.get(i));
			if (!s.isEmpty() && "=+-@\t\r".indexOf(s.charAt(0)) >= 0 && !(cells.get(i) instanceof Number)) s = "'" + s;
			if (i > 0) sb.append(',');
			sb.append('"').append(s.replace("\"", "\"\"")).append('"');
		}
		return sb.append("\r\n").toString();
	}
}
