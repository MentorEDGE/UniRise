export interface ReportDef { slug: string; title: string; text: string }

export const publicationReports: ReportDef[] = [
  { slug: "pub-university", title: "University-wide, by year", text: "Verified publications per year across the whole scope." },
  { slug: "pub-institute-count", title: "Institute-wise count", text: "Verified publications per institute." },
  { slug: "pub-institute-department", title: "Institute and department wise", text: "Verified publications per department within each institute." },
  { slug: "pub-employee", title: "Employee ID wise", text: "Each faculty author's verified publications." },
  { slug: "pub-employee-count", title: "Employee ID wise count", text: "Publication count per faculty author." },
  { slug: "pub-roll", title: "Roll number wise", text: "Each student author's verified publications." },
  { slug: "pub-journal", title: "Journal wise", text: "Publications per journal or venue." },
  { slug: "pub-faculty-journal", title: "Faculty authored, journal wise", text: "Journals with at least one faculty author." },
  { slug: "pub-student-journal", title: "Student authored, journal wise", text: "Journals with at least one student author." },
  { slug: "pub-inter-institution", title: "Joint publications by partner institution", text: "Publications written with authors from other institutions." },
  { slug: "pub-continent", title: "Continent wise", text: "Publications by the continent of outside authors." },
];

export const grantReports: ReportDef[] = [
  { slug: "grant-type", title: "Grant type wise", text: "Grants, applied and sanctioned amounts per grant type. Choose the date basis." },
  { slug: "grant-institute-department", title: "Institute and department wise", text: "Grants per department of the lead investigator." },
  { slug: "grant-institution-count", title: "Institute-wise count", text: "Grants per institute." },
  { slug: "grant-year-received", title: "Year wise amount received", text: "Sanctioned amounts per year." },
  { slug: "grant-inter-institute", title: "Inter-institute grants", text: "Grants with investigators from more than one institution." },
  { slug: "grant-sharing", title: "Percentage sharing", text: "Each investigator's share of every grant." },
  { slug: "grant-sanctioned", title: "Sanctioned grant details", text: "Sanctioned grants with agency, date, amount and duration." },
  { slug: "grant-employee", title: "Employee ID wise", text: "Grants and applied amounts per investigator." },
];
