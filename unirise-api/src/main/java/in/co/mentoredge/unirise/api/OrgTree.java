package in.co.mentoredge.unirise.api;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Adds org units and keeps the closure table in step. */
@Service
public class OrgTree {
	private final JdbcClient db;

	public OrgTree(@Qualifier("tenantJdbc") JdbcClient db) { this.db = db; }

	public long add(Long parentId, String type, String name) {
		long id = db.sql("INSERT INTO org_unit(parent_id, type, name) VALUES (:p, :t, :n) RETURNING id").param("p", parentId).param("t", type).param("n", name).query(Long.class).single();
		db.sql("INSERT INTO org_unit_closure VALUES (:i, :i, 0)").param("i", id).update();
		if (parentId != null) {
			db.sql("INSERT INTO org_unit_closure SELECT ancestor_id, :i, depth + 1 FROM org_unit_closure WHERE descendant_id = :p").param("i", id).param("p", parentId).update();
		}
		return id;
	}
}
