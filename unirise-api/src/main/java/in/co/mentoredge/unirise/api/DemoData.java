package in.co.mentoredge.unirise.api;

import in.co.mentoredge.unirise.tenancy.TenantContext;
import in.co.mentoredge.unirise.tenancy.TenantDirectory;
import in.co.mentoredge.unirise.tenancy.TenantInfo;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Loads an institution's data in the UI's DB shape (for example the sample data of rdms-web/src/lib/seed.ts) and its demo
 * accounts into a sandbox institution that has no records yet. Operator only. Used for demos and for running the
 * frontend's end-to-end tests against this API.
 */
@Service
public class DemoData {
	static final Set<String> WORKFLOW = Set.of("id", "facultyId", "status", "createdAt", "updatedAt", "history");
	private final JdbcClient db, control;
	private final TenantDirectory directory;
	private final InstitutionSettings settings;
	private final Records records;
	private final Profiles profiles;

	public DemoData(@Qualifier("tenantJdbc") JdbcClient db, @Qualifier("controlJdbc") JdbcClient control, TenantDirectory directory, InstitutionSettings settings, Records records, Profiles profiles) {
		this.db = db;
		this.control = control;
		this.directory = directory;
		this.settings = settings;
		this.records = records;
		this.profiles = profiles;
	}

	public Map<String, Object> load(String slug, Map<String, Object> body) {
		TenantInfo t = directory.bySlug(slug).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
		if (!t.status().equals("sandbox")) throw new ResponseStatusException(HttpStatus.CONFLICT, "demo data only for sandbox institutions");
		Map<String, Object> data = Json.obj(body.get("db"));
		List<Object> accounts = Json.arr(body.get("accounts"));
		for (Object a : accounts) {
			String email = Json.str(Json.obj(a).get("email"), 200).toLowerCase();
			if (control.sql("SELECT count(*) FROM account_login WHERE email = :e").param("e", email).query(Long.class).single() > 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "account exists: " + email);
		}
		TenantContext.set(slug);
		try {
			if (db.sql("SELECT count(*) FROM record").query(Long.class).single() > 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "institution already has records");
			settings.put(Json.obj(data.get("settings")));
			for (Object x : Json.arr(data.get("faculty"))) {
				var f = Json.obj(x);
				db.sql("""
					INSERT INTO researcher(name, email, orcid, employee_id, scopus_id, title, designation, department, phone, joining_date, active, exit_reason, exit_date)
					VALUES (:n, :e, :o, :id, :s, :t, :d, :dep, :p, :j, :a, :er, :ed)""")
					.param("n", Json.str(f.get("name"))).param("e", Json.str(f.get("email"))).param("o", Json.str(f.get("orcid"))).param("id", Json.str(f.get("id")))
					.param("s", Json.str(f.get("scopusId"))).param("t", Json.str(f.get("title"))).param("d", Json.str(f.get("designation"))).param("dep", Json.str(f.get("department")))
					.param("p", Json.str(f.get("phone"))).param("j", Json.str(f.get("joiningDate"))).param("a", !Boolean.FALSE.equals(f.get("active")))
					.param("er", Json.str(f.get("exitReason"))).param("ed", Json.str(f.get("exitDate"))).update();
			}
			for (Object x : Json.arr(data.get("biodata"))) {
				var b = Json.obj(x);
				profiles.putBiodata(Json.str(b.get("facultyId")), b);
			}
			int count = 0;
			for (String kind : Records.KINDS) for (Object x : Json.arr(data.get(kind))) {
				var r = Json.obj(x);
				var fields = new java.util.LinkedHashMap<String, Object>(r);
				WORKFLOW.forEach(fields::remove);
				db.sql("INSERT INTO record(id, kind, owner, status, data, created_at, updated_at) VALUES (:id, :k, :o, :s, CAST(:d AS jsonb), CAST(:c AS timestamptz), CAST(:u AS timestamptz))")
					.param("id", r.get("id")).param("k", kind).param("o", r.get("facultyId")).param("s", r.get("status")).param("d", Json.write(fields))
					.param("c", r.get("createdAt")).param("u", r.get("updatedAt")).update();
				records.setCredits(kind, (String) r.get("id"), r);
				events((String) r.get("id"), r);
				count++;
			}
			for (Object x : Json.arr(data.get("profileChanges"))) {
				var c = Json.obj(x);
				db.sql("""
					INSERT INTO profile_change(id, faculty, status, biodata, contact, changed, created_at, updated_at)
					VALUES (:id, :f, :s, CAST(:b AS jsonb), CAST(:c AS jsonb), CAST(:ch AS jsonb), CAST(:ca AS timestamptz), CAST(:u AS timestamptz))""")
					.param("id", c.get("id")).param("f", c.get("facultyId")).param("s", c.get("status")).param("b", Json.write(c.get("biodata"))).param("c", Json.write(c.get("contact")))
					.param("ch", Json.write(c.get("changed"))).param("ca", c.get("createdAt")).param("u", c.get("updatedAt")).update();
				events((String) c.get("id"), c);
			}
			for (Object x : Json.arr(data.get("notices"))) {
				var n = Json.obj(x);
				db.sql("INSERT INTO notice(id, at, title, body) VALUES (:id, CAST(:at AS timestamptz), :t, :b)").param("id", n.get("id")).param("at", n.get("at")).param("t", n.get("title")).param("b", Json.str(n.get("body"))).update();
			}
			long seq = Math.max(Json.num(data.get("seq")).longValue(), 1000);
			db.sql("SELECT setval('display_seq', :v)").param("v", seq).query(Long.class).single();
			for (Object x : accounts) {
				var a = Json.obj(x);
				String email = Json.str(a.get("email"), 200).toLowerCase(), role = Json.str(a.get("role"));
				Long researcher = role.equals("faculty") ? db.sql("SELECT id FROM researcher WHERE employee_id = :c").param("c", Json.str(a.get("facultyId"))).query(Long.class).single() : null;
				long uid = db.sql("""
					INSERT INTO app_user(email, researcher_id, role, status, name, title, designation, department, created_by)
					VALUES (:e, :r, :role, :st, :n, :t, :d, :dep, 'UniRise demo data') RETURNING id""")
					.param("e", email).param("r", researcher).param("role", role).param("st", Json.str(a.get("status")).isEmpty() ? "active" : Json.str(a.get("status")))
					.param("n", Json.str(a.get("name"))).param("t", Json.str(a.get("title"))).param("d", Json.str(a.get("designation"))).param("dep", Json.str(a.get("department"))).query(Long.class).single();
				control.sql("INSERT INTO account_login(email, institution_id, app_user_id, password_hash) VALUES (:e, :i, :u, :h)")
					.param("e", email).param("i", t.id()).param("u", uid).param("h", Passwords.hash(Json.str(a.get("password")))).update();
			}
			return Json.of("records", count, "faculty", Json.arr(data.get("faculty")).size(), "accounts", accounts.size());
		} finally {
			TenantContext.clear();
		}
	}

	private void events(String id, Map<String, Object> r) {
		for (Object h : Json.arr(r.get("history"))) {
			var e = Json.obj(h);
			records.event(id, Json.str(e.get("at")), Json.str(e.get("by")), Json.str(e.get("action")), (String) e.get("remark"));
		}
	}
}
