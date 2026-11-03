package in.co.mentoredge.unirise.api;

import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Draft, submit, review and edit rules shared by publications, grants and seed proposals (PRD R37-R41).
 * Visibility comes from AccessService via the owner; this class decides who may change an entry and who may review it.
 */
@Service
public class EntryWorkflow {
	public record Kind(String table, String statusCol, String type, boolean grant) {}

	public static final Kind PUB = new Kind("publication", "entry_status", "publication", false);
	public static final Kind GRANT = new Kind("research_grant", "status", "grant", true);
	public static final Kind SEED = new Kind("seed_proposal", "status", "seed", false);
	private static final Set<String> ACTIONS = Set.of("approve", "rework", "revision_required", "reject");
	private static final Set<String> EDITABLE = Set.of("draft", "rework", "revision_required");

	private final JdbcClient db;
	private final AccessService access;

	public EntryWorkflow(@Qualifier("tenantJdbc") JdbcClient db, AccessService access) {
		this.db = db;
		this.access = access;
	}

	public record Head(long ownerId, String status) {}

	/** Owner and status, or 404 when the entry is missing or its owner is outside the caller's slice. */
	public Head head(Actor a, Kind k, long id) {
		Head h = db.sql("SELECT owner_id, " + k.statusCol() + " AS status FROM " + k.table() + " WHERE id = :id").param("id", id)
			.query((r, n) -> new Head(r.getLong("owner_id"), r.getString("status"))).optional()
			.orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
		if (!access.visible(a).allows(h.ownerId())) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
		return h;
	}

	/** Admins may edit anything; owners only while the entry is a draft or has been sent back. */
	public Head requireEditable(Actor a, Kind k, long id) {
		Head h = head(a, k, id);
		if (a.isAdmin()) return h;
		if (a.researcherId() == null || a.researcherId() != h.ownerId()) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
		if (!EDITABLE.contains(h.status())) throw new ResponseStatusException(HttpStatus.CONFLICT, "locked");
		return h;
	}

	public long ownerForNew(Actor a, Long requested) {
		if (a.researcherId() != null && (requested == null || requested.equals(a.researcherId()))) return a.researcherId();
		if (a.isAdmin() && requested != null) return requested;
		throw new ResponseStatusException(a.researcherId() == null ? HttpStatus.BAD_REQUEST : HttpStatus.FORBIDDEN);
	}

	public void submit(Actor a, Kind k, long id) {
		Head h = requireEditable(a, k, id);
		if (!EDITABLE.contains(h.status())) throw new ResponseStatusException(HttpStatus.CONFLICT, "locked");
		db.sql("UPDATE " + k.table() + " SET " + k.statusCol() + " = 'submitted', review_comment = NULL WHERE id = :id").param("id", id).update();
		event(k, id, "submit", a, null);
	}

	/** Review by an admin or by a HoD, Dean or Executive whose scope covers the owner. Nobody reviews their own entry. */
	public String review(Actor a, Kind k, long id, String action, String comment) {
		if (action == null || !ACTIONS.contains(action)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "action");
		Head h = head(a, k, id);
		boolean reviewer = a.isAdmin() || a.hasRole("HOD", "DEAN", "EXECUTIVE");
		if (!reviewer) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
		if (!a.service() && a.researcherId() != null && a.researcherId() == h.ownerId()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "own entry");
		if (!h.status().equals("submitted")) throw new ResponseStatusException(HttpStatus.CONFLICT, "not submitted");
		if (!action.equals("approve") && (comment == null || comment.isBlank())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "comment");
		String status = switch (action) {
			case "approve" -> k.grant() ? "sanctioned" : "approved";
			case "rework" -> "rework";
			case "revision_required" -> k.grant() ? "rework" : "revision_required"; // grants have no revision_required state
			default -> "rejected";
		};
		db.sql("UPDATE " + k.table() + " SET " + k.statusCol() + " = :s, review_comment = :c WHERE id = :id").param("s", status).param("c", comment).param("id", id).update();
		event(k, id, action, a, comment);
		return status;
	}

	private void event(Kind k, long id, String action, Actor a, String comment) {
		db.sql("INSERT INTO review_event(entity_type, entity_id, action, actor_user_id, comment) VALUES (:t, :i, :a, :u, :c)")
			.param("t", k.type()).param("i", id).param("a", action).param("u", a.userId()).param("c", comment).update();
	}

	/** SQL fragment limiting a listing to the caller's slice; bind with bindScope(). */
	public String scope(Actor a, String ownerCol) {
		return access.visible(a).all() ? "" : " AND " + ownerCol + " IN (:ids)";
	}

	public JdbcClient.StatementSpec bindScope(JdbcClient.StatementSpec s, Actor a) {
		var v = access.visible(a);
		return v.all() ? s : s.param("ids", v.ids().isEmpty() ? java.util.Set.of(-1L) : v.ids());
	}

	public static Map<String, Object> page(java.util.List<?> items, long total, int page, int size) {
		return Map.of("items", items, "total", total, "page", page, "size", size);
	}
}
