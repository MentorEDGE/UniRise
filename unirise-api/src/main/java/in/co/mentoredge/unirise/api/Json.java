package in.co.mentoredge.unirise.api;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.json.JsonMapper;

/**
 * JSON documents as plain maps and lists, and the input cleaning rules of rdms-web/src/lib/domain.ts (str, num, list):
 * a value of the wrong type becomes the empty value, text is cut to its maximum length.
 */
final class Json {
	static final JsonMapper MAPPER = JsonMapper.builder().build();

	private Json() {}

	static String write(Object v) { return MAPPER.writeValueAsString(v); }

	@SuppressWarnings("unchecked")
	static Map<String, Object> map(String json) { return json == null ? new LinkedHashMap<>() : MAPPER.readValue(json, LinkedHashMap.class); }

	@SuppressWarnings("unchecked")
	static List<Object> list(String json) { return json == null ? new ArrayList<>() : MAPPER.readValue(json, ArrayList.class); }

	/** The value as a map, or an empty map. */
	@SuppressWarnings("unchecked")
	static Map<String, Object> obj(Object v) { return v instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>(); }

	/** The value as a list, or an empty list. */
	@SuppressWarnings("unchecked")
	static List<Object> arr(Object v) { return v instanceof List<?> l ? (List<Object>) l : new ArrayList<>(); }

	static String str(Object v) { return str(v, 2000); }

	static String str(Object v, int max) { return v instanceof String s ? (s.length() > max ? s.substring(0, max) : s) : ""; }

	/** A finite number, or 0. Integral values come back as Long so they serialise without ".0". */
	static Number num(Object v) {
		if (!(v instanceof Number n)) return 0L;
		double d = n.doubleValue();
		if (Double.isNaN(d) || Double.isInfinite(d)) return 0L;
		return d == Math.rint(d) && Math.abs(d) < 1e15 ? (Number) (long) d : (Number) d;
	}

	static double dbl(Object v) { return num(v).doubleValue(); }

	static boolean bool(Object v) { return Boolean.TRUE.equals(v); }

	static <T> List<T> take(Object v, int max, java.util.function.Function<Map<String, Object>, T> fn) {
		List<T> out = new ArrayList<>();
		for (Object x : arr(v)) { if (out.size() >= max) break; out.add(fn.apply(obj(x))); }
		return out;
	}

	@SafeVarargs
	static Map<String, Object> of(Object... kv) {
		Map<String, Object> m = new LinkedHashMap<>();
		for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
		return m;
	}
}
