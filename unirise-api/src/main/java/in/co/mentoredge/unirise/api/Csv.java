package in.co.mentoredge.unirise.api;

import java.util.ArrayList;
import java.util.List;

/** Minimal RFC 4180 reader: quoted fields may hold commas, quotes ("") and line breaks. */
final class Csv {
	private Csv() {}

	static List<List<String>> parse(String text) {
		List<List<String>> rows = new ArrayList<>();
		List<String> row = new ArrayList<>();
		StringBuilder cell = new StringBuilder();
		boolean quoted = false, any = false;
		if (text.startsWith("﻿")) text = text.substring(1);
		for (int i = 0; i < text.length(); i++) {
			char c = text.charAt(i);
			if (quoted) {
				if (c == '"') {
					if (i + 1 < text.length() && text.charAt(i + 1) == '"') { cell.append('"'); i++; } else quoted = false;
				} else cell.append(c);
			} else if (c == '"') { quoted = true; any = true; }
			else if (c == ',') { row.add(cell.toString()); cell.setLength(0); any = true; }
			else if (c == '\n' || c == '\r') {
				if (c == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') i++;
				if (any || cell.length() > 0) { row.add(cell.toString()); rows.add(row); }
				row = new ArrayList<>(); cell.setLength(0); any = false;
			} else { cell.append(c); any = true; }
		}
		if (any || cell.length() > 0) { row.add(cell.toString()); rows.add(row); }
		return rows;
	}
}
