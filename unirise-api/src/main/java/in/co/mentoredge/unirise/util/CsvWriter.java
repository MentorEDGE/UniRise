package in.co.mentoredge.unirise.util;

import java.util.List;

/** One CSV rule for every export. */
public final class CsvWriter {
	private CsvWriter() {}

	/** Text cells starting with = + - @ tab or CR would run as formulas in a spreadsheet, so they get a leading quote. */
	public static String line(List<?> cells) {
		StringBuilder sb = new StringBuilder();
		for (int i = 0; i < cells.size(); i++) {
			Object cell = cells.get(i);
			String s = cell == null ? "" : String.valueOf(cell);
			if (!s.isEmpty() && "=+-@\t\r".indexOf(s.charAt(0)) >= 0 && !(cell instanceof Number)) s = "'" + s;
			if (i > 0) sb.append(',');
			sb.append('"').append(s.replace("\"", "\"\"")).append('"');
		}
		return sb.append("\r\n").toString();
	}
}
