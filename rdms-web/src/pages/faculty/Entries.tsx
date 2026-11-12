import { useState } from 'react';
import type { ReactNode } from 'react';
import { Field, FileName, Input, NumberInput, PageTitle, Panel, Select, TextArea, YesNo } from '../../components/ui';
import { getDB, useStore } from '../../lib/store';
import {
  AWARD_CATEGORIES, CONF_PARTICIPATION, IP_DESCRIPTION_WORDS, IP_OWNERS, IP_STATUSES, IP_TYPES, wordCount, FDP_ROLES, FDP_TYPES, FUNDING, GRANT_SOURCES, GRANT_TYPES, GRANT_UNITS, INDEXING, LEVELS, MODES, MONTHS,
  PUB_CATEGORIES, PUB_TYPES, QUARTILES,
} from '../../lib/types';
import type { Conference, Fdp, Grant, Honour, IntellectualProperty, PubType, Publication, SeedMoney } from '../../lib/types';
import { AuthorTable, BlockedEntry, InvestigatorTable, SaveBar, selfAuthor, selfInvestigator, useEntry, validateInvestigators } from './entryKit';
import type { Errors } from './entryKit';

const today = () => new Date().toISOString().slice(0, 10);
const thisYear = () => new Date().getFullYear();
const required = (errs: Errors, key: string, v: unknown, label: string) => { if (v === '' || v == null || (typeof v === 'number' && !v)) errs[key] = `${label} is required.`; };

// ---------------- Publication ----------------

const VENUE_LABEL: Record<PubType, string> = {
  'Journal Article': 'Name Of Journal', Book: 'Publisher', 'Book Chapter': 'Book Title / Publisher', 'Conference Paper': 'Conference / Proceedings', 'Technical Report': 'Issuing Organisation',
};

const PUB_TYPE_HINT: Record<string, string> = {
  'Journal Article': 'A paper in a journal, with its DOI and quartile',
  'Conference Paper': 'A paper in conference proceedings',
  Book: 'An authored or edited book',
  'Book Chapter': 'A chapter in an edited book',
  'Technical Report': 'A report, white paper or working paper',
};
const SUB = 'Saved entries stay private to you until you submit them. The Office of Research then reviews them.';

export function PublicationEntry() {
  const e = useEntry<Publication>('publications', (fid) => ({
    entryType: '' as PubType, category: 'Research Article', title: '', doi: '', month: MONTHS[new Date().getMonth()], year: thisYear(), issn: '', venue: '',
    indexing: 'Scopus', quartile: 'NA', impactFactor: 0, erfRelated: false, projectReference: '', openAccess: false, authors: [selfAuthor(fid)], pdfName: '',
  }), (r, submit) => {
    const errs: Errors = {};
    required(errs, 'entryType', r.entryType, 'Entry type');
    required(errs, 'title', r.title.trim(), 'Title');
    required(errs, 'venue', r.venue.trim(), VENUE_LABEL[r.entryType] ?? 'Venue');
    if (r.year > thisYear() || r.year < 1950) errs.year = 'Enter a valid publication year.';
    if (r.entryType === 'Journal Article') {
      required(errs, 'doi', r.doi.trim(), 'DOI / Webpage link');
      if (r.issn && !/^\d{7}[\dXx]$/.test(r.issn)) errs.issn = 'ISSN must be 8 characters without hyphen or space.';
    }
    if (r.doi.trim()) {
      const dup = getDB().publications.find((p) => p.id !== r.id && p.doi.trim().toLowerCase() === r.doi.trim().toLowerCase());
      if (dup) errs.doi = `This DOI is already entered as ${dup.id}. Ask the owner to add you as an author instead.`;
    }
    if (!r.authors.length) errs.authors = 'Add all authors.';
    else if (!r.authors.some((a) => a.code === r.facultyId)) errs.authors = 'You must be listed as one of the authors.';
    else if (r.authors.some((a) => !a.name.trim())) errs.authors = 'Every author needs a name.';
    if (submit && r.entryType !== 'Book' && !r.pdfName) errs.pdf = 'Upload the PDF before submitting (optional for books).';
    return errs;
  });
  if (e.blocked) return <BlockedEntry msg={e.blocked} />;
  const { rec: r, update: u, errors: x } = e;
  const t = r.entryType;
  return (
    <>
      <PageTitle sub={SUB}>{e.isNew ? 'Add Publication' : `Edit Publication ${e.rec.id}`}</PageTitle>
      {e.banner}
      <Panel title="Basic Details" size="wide">
        {e.isNew && (
          <fieldset className="type-pick">
            <legend>What are you adding?{x.entryType && <span className="err"> {x.entryType}</span>}</legend>
            <div>
              {PUB_TYPES.map((p) => (
                <label key={p} className={t === p ? 'on' : ''}>
                  <input type="radio" name="pub-type" value={p} checked={t === p} onChange={() => u({ entryType: p, quartile: p === 'Journal Article' ? r.quartile : 'NA' })} />
                  <b>{p}</b><span>{PUB_TYPE_HINT[p]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="grid">
          {!e.isNew && <Field label="Entry Type"><Select value={t} onChange={() => {}} options={PUB_TYPES} disabled /></Field>}
          {t && <>
            <Field label="Category"><Select value={r.category} onChange={(v) => u({ category: v })} options={PUB_CATEGORIES} /></Field>
            <Field label="DOI/Webpage Link" required={t === 'Journal Article'} error={x.doi}><Input value={r.doi} onChange={(v) => u({ doi: v })} placeholder="https://doi.org/…" /></Field>
            <Field label="Publication Id"><input type="text" readOnly value={r.id || 'Generated on save'} /></Field>
            <Field label="Title" required error={x.title} className="span2"><TextArea value={r.title} onChange={(v) => u({ title: v })} /></Field>
            <Field label="ERF Related?" hint="(Environmental Research Fund)"><YesNo value={r.erfRelated} onChange={(v) => u({ erfRelated: v })} /></Field>
            <Field label="Project Reference?" hint="Ongoing / completed project ID, if any"><Input value={r.projectReference} onChange={(v) => u({ projectReference: v })} placeholder="e.g. GRT1234" /></Field>
            <Field label="Publish Month"><Select value={r.month} onChange={(v) => u({ month: v })} options={MONTHS} /></Field>
            <Field label="Publish Year" error={x.year}><Select value={String(r.year)} onChange={(v) => u({ year: Number(v) })} options={Array.from({ length: 30 }, (_, i) => String(thisYear() - i))} /></Field>
            <Field label={t === 'Journal Article' ? 'ISSN' : 'ISBN / Report No.'} hint={t === 'Journal Article' ? 'Enter ISSN without hyphen (-) and space' : undefined} error={x.issn}>
              <Input value={r.issn} onChange={(v) => u({ issn: v.replace(/[\s-]/g, '') })} />
            </Field>
            <Field label={VENUE_LABEL[t]} required error={x.venue}><Input value={r.venue} onChange={(v) => u({ venue: v })} /></Field>
            <Field label="Indexing"><Select value={r.indexing} onChange={(v) => u({ indexing: v })} options={INDEXING} /></Field>
            {t === 'Journal Article' && <>
              <Field label="Quartile"><Select value={r.quartile} onChange={(v) => u({ quartile: v })} options={QUARTILES} /></Field>
              <Field label="Impact Factor"><NumberInput value={r.impactFactor} onChange={(v) => u({ impactFactor: v })} step="0.1" min={0} /></Field>
            </>}
            <Field label="Open Access?"><YesNo value={r.openAccess} onChange={(v) => u({ openAccess: v })} /></Field>
          </>}
        </div>
      </Panel>
      {t && <>
        <Panel title="Author Details" size="wide">
          <div className="note">
            <b>Note:</b>
            <ol style={{ margin: '2px 0', paddingLeft: 18 }}>
              <li>Internal and external authors should be entered here.</li>
              <li>Enter all authors in the order they appear in the publication.</li>
              <li>Enter relieved faculty and graduated students as Ex-Faculty and Ex-Student.</li>
              <li>Internal faculty co-authors get credit for this entry automatically; they do not need to enter it again.</li>
            </ol>
          </div>
          <AuthorTable value={r.authors} onChange={(v) => u({ authors: v })} error={x.authors} />
        </Panel>
        <Panel title="Full Text" size="wide">
          <Field label="Upload PDF" hint="Only PDF files (optional for Books), up to 10 MB. Larger files: contact the research office." error={x.pdf}>
            <FileName value={r.pdfName} onChange={(v) => u({ pdfName: v })} />
          </Field>
          <SaveBar onSave={e.save} isNew={e.isNew} resubmit={e.resubmit} />
        </Panel>
      </>}
    </>
  );
}

// ---------------- Grant (five-step wizard as in the reference) ----------------

const STEPS = ['Basic Details', 'Investigator Details', 'Enclosures', 'Others', 'Submit'] as const;

export function GrantEntry() {
  const [step, setStep] = useState(0);
  const e = useEntry<Grant>('grants', (fid) => ({
    unit: '', grantType: '', utn: '', title: '', description: '', callTitle: '', callSource: '', source: 'Central Government', agency: '', agencyComment: '',
    appliedDate: today(), appliedAmount: 0, durationMonths: 12, erfRelated: false, matchingGrant: false, contactNumber: '', outcome: 'Applied',
    sanctionDate: '', sanctionedAmount: 0, receivedAmount: 0, investigators: [selfInvestigator(fid)], enclosures: [], otherRemarks: '',
  }), (r, submit) => {
    const errs: Errors = {};
    required(errs, 'unit', r.unit, 'Grant unit');
    required(errs, 'grantType', r.grantType, 'Grant type');
    required(errs, 'title', r.title.trim(), 'Grant title');
    required(errs, 'appliedDate', r.appliedDate, 'Grant applied date');
    required(errs, 'agency', r.agency.trim(), 'Grant agency');
    if (r.appliedDate > today()) errs.appliedDate = 'Applied date cannot be in the future.';
    if (r.appliedAmount <= 0) errs.appliedAmount = 'Enter the applied amount.';
    if (r.contactNumber && !/^[0-9+\- ]{7,15}$/.test(r.contactNumber)) errs.contactNumber = 'Enter a valid phone number.';
    validateInvestigators(r.investigators, r.facultyId, errs);
    if (submit && !r.enclosures.length) errs.enclosures = 'Attach at least the proposal document before submitting.';
    return errs;
  });
  if (e.blocked) return <BlockedEntry msg={e.blocked} />;
  const { rec: r, update: u, errors: x } = e;
  const stepOf: Record<string, number> = { unit: 0, grantType: 0, title: 0, appliedDate: 0, agency: 0, appliedAmount: 0, contactNumber: 0, investigators: 1, enclosures: 2 };
  const firstErrStep = Math.min(...Object.keys(x).map((k) => stepOf[k] ?? 0));
  return (
    <>
      <PageTitle sub={SUB}>{e.isNew ? 'Add Grant or Fellowship' : `Edit Grant ${e.rec.id}`}</PageTitle>
      {e.banner}
      <Panel title="Add Grant Details" size="wide">
        <div className="steps" role="tablist">
          {STEPS.map((s, i) => <button key={s} type="button" role="tab" aria-selected={step === i} className={step === i ? 'on' : ''} onClick={() => setStep(i)}>{s}</button>)}
        </div>
        {Object.keys(x).length > 0 && firstErrStep !== step && <p className="note" style={{ color: 'var(--bad)' }}>There are errors on the “{STEPS[firstErrStep]}” step.</p>}

        {step === 0 && (
          <>
            <div className="grid">
              <Field label="Grant Unit" required error={x.unit}><Select value={r.unit} onChange={(v) => u({ unit: v })} options={GRANT_UNITS} placeholder="--Select--" /></Field>
              <Field label="Grant Status"><input type="text" readOnly value={r.status} /></Field>
              <Field label="Grant Type" required error={x.grantType}><Select value={r.grantType} onChange={(v) => u({ grantType: v })} options={GRANT_TYPES} placeholder="--Select--" /></Field>
              <Field label="Grant ID"><input type="text" readOnly value={r.id || 'Generated on save'} /></Field>
              <Field label="UTN" hint="Unique transaction number from the agency portal"><Input value={r.utn} onChange={(v) => u({ utn: v })} /></Field>
              <Field label="Grant Applied Date" required error={x.appliedDate}><input type="date" value={r.appliedDate} max={today()} onChange={(ev) => u({ appliedDate: ev.target.value })} /></Field>
              <Field label="Applied Amount (in INR)" required error={x.appliedAmount}><NumberInput value={r.appliedAmount} onChange={(v) => u({ appliedAmount: v })} min={0} /></Field>
              <Field label="Contact Number" error={x.contactNumber}><Input value={r.contactNumber} onChange={(v) => u({ contactNumber: v })} /></Field>
              <Field label="Grant Source"><Select value={r.source} onChange={(v) => u({ source: v })} options={GRANT_SOURCES} /></Field>
              <Field label="Duration Of The Grant" hint="(in months)"><NumberInput value={r.durationMonths} onChange={(v) => u({ durationMonths: v })} min={1} /></Field>
              <Field label="ERF Related?" hint="(Environmental Research Fund)"><YesNo value={r.erfRelated} onChange={(v) => u({ erfRelated: v })} /></Field>
              <Field label="Matching grant required for capital items?" hint="(If mandated by funding agency)"><YesNo value={r.matchingGrant} onChange={(v) => u({ matchingGrant: v })} /></Field>
              <Field label="Grant Title" required error={x.title} className="span2"><TextArea value={r.title} onChange={(v) => u({ title: v })} /></Field>
              <Field label="Description" className="span2"><TextArea value={r.description} onChange={(v) => u({ description: v })} /></Field>
              <Field label="Grant Call Title" className="span2"><TextArea value={r.callTitle} onChange={(v) => u({ callTitle: v })} /></Field>
              <Field label="Source Of Grant Call"><Select value={r.callSource} onChange={(v) => u({ callSource: v })} options={['Agency website', 'Research office circular', 'Email from agency', 'Other']} placeholder="--Select--" /></Field>
            </div>
            <fieldset style={{ border: '1px solid var(--line)', marginTop: 14, borderRadius: 12, padding: '10px 14px 14px' }}>
              <legend style={{ fontWeight: 600, fontSize: 14.5, padding: '0 6px' }}>Agency Details</legend>
              <div className="grid g2">
                <Field label="Grant Agency" required error={x.agency}><Input value={r.agency} onChange={(v) => u({ agency: v })} list="agencies" /></Field>
                <Field label="Agency Comment"><TextArea value={r.agencyComment} onChange={(v) => u({ agencyComment: v })} /></Field>
              </div>
              <datalist id="agencies">{[...new Set(getDB().grants.map((g) => g.agency))].map((a) => <option key={a} value={a} />)}</datalist>
            </fieldset>
          </>
        )}
        {step === 1 && <InvestigatorTable value={r.investigators} onChange={(v) => u({ investigators: v })} error={x.investigators} />}
        {step === 2 && (
          <>
            <Field label="Add enclosure" hint="Proposal, endorsement letter, budget sheet… PDF up to 10 MB each." error={x.enclosures}>
              <FileName value="" onChange={(v) => v && u({ enclosures: [...r.enclosures, v] })} />
            </Field>
            <ul>{r.enclosures.map((n, i) => <li key={i}>📎 {n} <button type="button" className="link-btn" onClick={() => u({ enclosures: r.enclosures.filter((_, j) => j !== i) })}>Remove</button></li>)}</ul>
            {!r.enclosures.length && <p className="note">No enclosures yet.</p>}
          </>
        )}
        {step === 3 && <Field label="Other remarks"><TextArea value={r.otherRemarks} onChange={(v) => u({ otherRemarks: v })} rows={5} /></Field>}
        {step === 4 && (
          <div className="note">
            <p>Check the details before you submit. After submission the entry is locked until the Office of Research approves it or sends it back for rework.
              The funding outcome (sanctioned / received amounts) is recorded by the research office after approval.</p>
            <dl className="kv">
              <dt>Title</dt><dd>{r.title || '—'}</dd><dt>Agency</dt><dd>{r.agency || '—'}</dd>
              <dt>Applied amount</dt><dd>₹{r.appliedAmount.toLocaleString('en-IN')}</dd><dt>Investigators</dt><dd>{r.investigators.map((i) => `${i.name} (${i.role}, ${i.sharePct}%)`).join('; ')}</dd>
              <dt>Enclosures</dt><dd>{r.enclosures.join(', ') || '—'}</dd>
            </dl>
          </div>
        )}
        <div className="btn-row">
          {step > 0 && <button type="button" className="btn secondary" onClick={() => setStep(step - 1)}>‹ Previous</button>}
          {step < STEPS.length - 1 && <button type="button" className="btn secondary" onClick={() => setStep(step + 1)}>Next ›</button>}
        </div>
        <SaveBar onSave={e.save} isNew={e.isNew} resubmit={e.resubmit} />
      </Panel>
    </>
  );
}

// ---------------- Seed money ----------------

export function SeedMoneyEntry() {
  const { db } = useStore();
  const e = useEntry<SeedMoney>('seedMoney', (fid) => ({
    appliedDate: today(), category: 'Faculty', title: '', abstract: '', requestedAmount: 0, sanctionedAmount: 0, investigators: [selfInvestigator(fid)],
  }), (r) => {
    const errs: Errors = {};
    required(errs, 'title', r.title.trim(), 'Title of the project');
    required(errs, 'abstract', r.abstract.trim(), 'Abstract');
    if (r.requestedAmount <= 0) errs.requestedAmount = 'Enter the requested amount.';
    if (r.requestedAmount > 500000) errs.requestedAmount = 'Seed money is limited to ₹5,00,000 per proposal.';
    validateInvestigators(r.investigators, r.facultyId, errs);
    return errs;
  });
  if (e.blocked) return <BlockedEntry msg={e.blocked} />;
  const { rec: r, update: u, errors: x } = e;
  const closed = e.isNew && !db.settings.seedMoneyWindowOpen;
  return (
    <>
      <PageTitle sub="Seed money supports pilot work that leads to an external research proposal.">{e.isNew ? 'Apply for Seed Money' : `Edit Seed Money Application ${e.rec.id}`}</PageTitle>
      {e.banner}
      {closed && <div className="panel"><p className="note" style={{ color: 'var(--bad)' }}><b>Note:</b> Reception of applications for seed money proposals for this quarter is closed.</p></div>}
      <fieldset disabled={closed} style={{ border: 0, padding: 0, margin: 0 }}>
        <Panel title="New Proposal" size="wide">
          <div className="grid g3">
            <Field label="ID"><input type="text" readOnly value={r.id || 'Generated on save'} /></Field>
            <Field label="Applied Date"><input type="text" readOnly value={r.appliedDate.split('-').reverse().join('/')} /></Field>
            <Field label="Category Applied"><Select value={r.category} onChange={(v) => u({ category: v })} options={['Faculty', 'Student']} /></Field>
            <Field label="Title of the Project" required error={x.title} className="span2"><TextArea value={r.title} onChange={(v) => u({ title: v })} /></Field>
            <Field label="Requested Amount (₹)" required error={x.requestedAmount}><NumberInput value={r.requestedAmount} onChange={(v) => u({ requestedAmount: v })} min={0} /></Field>
            <Field label="Abstract" required error={x.abstract} className="span3"><TextArea value={r.abstract} onChange={(v) => u({ abstract: v })} rows={4} /></Field>
          </div>
        </Panel>
        <Panel title="Investigator Details" size="wide">
          <InvestigatorTable value={r.investigators} onChange={(v) => u({ investigators: v })} error={x.investigators} />
          <SaveBar onSave={e.save} isNew={e.isNew} resubmit={e.resubmit} />
        </Panel>
      </fieldset>
    </>
  );
}

// ---------------- FDP ----------------

const daysBetween = (a: string, b: string) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1 : 0);

export function FdpEntry() {
  const e = useEntry<Fdp>('fdps', () => ({
    role: 'Attended', programmeType: 'FDP', title: '', organiser: '', sponsoredBy: '', mode: 'Offline', level: 'National', fromDate: '', toDate: '', hours: 0, outcome: '', certificateName: '',
  }), (r, submit) => {
    const errs: Errors = {};
    required(errs, 'title', r.title.trim(), 'Programme title');
    required(errs, 'organiser', r.organiser.trim(), 'Organising institution');
    required(errs, 'fromDate', r.fromDate, 'From date');
    required(errs, 'toDate', r.toDate, 'To date');
    if (r.fromDate && r.toDate && r.toDate < r.fromDate) errs.toDate = 'To date must be on or after the from date.';
    if (r.toDate > today()) errs.toDate = 'Enter programmes after they are completed.';
    if (r.hours <= 0) errs.hours = 'Enter the duration in hours.';
    else if (r.hours > daysBetween(r.fromDate, r.toDate) * 10 && r.fromDate && r.toDate) errs.hours = 'More than 10 hours per day — please check.';
    if (submit && !r.certificateName) errs.certificate = 'Upload the certificate before submitting.';
    return errs;
  });
  if (e.blocked) return <BlockedEntry msg={e.blocked} />;
  const { rec: r, update: u, errors: x } = e;
  return (
    <>
      <PageTitle sub={SUB}>{e.isNew ? 'Add Faculty Development Programme' : `Edit FDP ${e.rec.id}`}</PageTitle>
      {e.banner}
      <Panel title="Faculty Development Programme Details" size="wide">
        <div className="grid">
          <Field label="Your Role" required><Select value={r.role} onChange={(v) => u({ role: v })} options={FDP_ROLES} /></Field>
          <Field label="Programme Type" required><Select value={r.programmeType} onChange={(v) => u({ programmeType: v })} options={FDP_TYPES} /></Field>
          <Field label="Mode"><Select value={r.mode} onChange={(v) => u({ mode: v })} options={MODES} /></Field>
          <Field label="Level"><Select value={r.level} onChange={(v) => u({ level: v })} options={LEVELS} /></Field>
          <Field label="Programme Title" required error={x.title} className="span2"><TextArea value={r.title} onChange={(v) => u({ title: v })} /></Field>
          <Field label="Organising Institution" required error={x.organiser}><Input value={r.organiser} onChange={(v) => u({ organiser: v })} /></Field>
          <Field label="Sponsored By" hint="AICTE, ISTE, self-funded…"><Input value={r.sponsoredBy} onChange={(v) => u({ sponsoredBy: v })} /></Field>
          <Field label="From Date" required error={x.fromDate}><input type="date" value={r.fromDate} max={today()} onChange={(ev) => u({ fromDate: ev.target.value, hours: r.hours || daysBetween(ev.target.value, r.toDate) * 6 })} /></Field>
          <Field label="To Date" required error={x.toDate}><input type="date" value={r.toDate} min={r.fromDate} max={today()} onChange={(ev) => u({ toDate: ev.target.value, hours: r.hours || daysBetween(r.fromDate, ev.target.value) * 6 })} /></Field>
          <Field label="Duration (hours)" required error={x.hours} hint={r.fromDate && r.toDate ? `${daysBetween(r.fromDate, r.toDate)} day(s)` : undefined}><NumberInput value={r.hours} onChange={(v) => u({ hours: v })} min={0} /></Field>
          <Field label="Certificate" error={x.certificate}><FileName value={r.certificateName} onChange={(v) => u({ certificateName: v })} accept=".pdf,.jpg,.png" /></Field>
          <Field label="Key learning / how it was applied" className="span4"><TextArea value={r.outcome} onChange={(v) => u({ outcome: v })} /></Field>
        </div>
        <SaveBar onSave={e.save} isNew={e.isNew} resubmit={e.resubmit} />
      </Panel>
    </>
  );
}

// ---------------- Conference ----------------

export function ConferenceEntry() {
  const e = useEntry<Conference>('conferences', () => ({
    participation: 'Paper Presented', conferenceName: '', paperTitle: '', organiser: '', venue: '', country: 'India', level: 'National', mode: 'Offline',
    fromDate: '', toDate: '', proceedingsIndexed: 'Scopus', funding: 'Institution', registrationFee: 0, amountClaimed: 0, award: '', certificateName: '',
  }), (r, submit) => {
    const errs: Errors = {};
    required(errs, 'conferenceName', r.conferenceName.trim(), 'Conference name');
    required(errs, 'venue', r.venue.trim(), 'Venue');
    required(errs, 'fromDate', r.fromDate, 'From date');
    required(errs, 'toDate', r.toDate, 'To date');
    if (r.fromDate && r.toDate && r.toDate < r.fromDate) errs.toDate = 'To date must be on or after the from date.';
    if (r.toDate > today()) errs.toDate = 'Enter the conference after it has taken place.';
    if (r.participation.includes('Presented') || r.participation.includes('Invited')) required(errs, 'paperTitle', r.paperTitle.trim(), 'Paper / talk title');
    if (r.funding !== 'Institution' && r.amountClaimed > 0) errs.amountClaimed = 'Only institution-funded participation can claim an amount.';
    if (submit && !r.certificateName) errs.certificate = 'Upload the participation certificate before submitting.';
    return errs;
  });
  if (e.blocked) return <BlockedEntry msg={e.blocked} />;
  const { rec: r, update: u, errors: x } = e;
  const presenting = r.participation.includes('Presented') || r.participation.includes('Invited');
  return (
    <>
      <PageTitle sub={SUB}>{e.isNew ? 'Add Conference' : `Edit Conference ${e.rec.id}`}</PageTitle>
      {e.banner}
      <Panel title="Conference Participation Details" size="wide">
        <div className="grid">
          <Field label="Participation Type" required><Select value={r.participation} onChange={(v) => u({ participation: v, proceedingsIndexed: v.includes('Presented') ? r.proceedingsIndexed : 'NA' })} options={CONF_PARTICIPATION} /></Field>
          <Field label="Level"><Select value={r.level} onChange={(v) => u({ level: v })} options={['National', 'International']} /></Field>
          <Field label="Mode"><Select value={r.mode} onChange={(v) => u({ mode: v })} options={MODES} /></Field>
          <Field label="Organiser"><Input value={r.organiser} onChange={(v) => u({ organiser: v })} /></Field>
          <Field label="Conference Name" required error={x.conferenceName} className="span2"><TextArea value={r.conferenceName} onChange={(v) => u({ conferenceName: v })} /></Field>
          <Field label="Paper / Talk Title" required={presenting} error={x.paperTitle} className="span2"><TextArea value={r.paperTitle} onChange={(v) => u({ paperTitle: v })} disabled={!presenting && r.participation !== 'Session Chair'} /></Field>
          <Field label="Venue (city)" required error={x.venue}><Input value={r.venue} onChange={(v) => u({ venue: v })} /></Field>
          <Field label="Country"><Input value={r.country} onChange={(v) => u({ country: v, level: v.trim().toLowerCase() !== 'india' ? 'International' : r.level })} /></Field>
          <Field label="From Date" required error={x.fromDate}><input type="date" value={r.fromDate} max={today()} onChange={(ev) => u({ fromDate: ev.target.value })} /></Field>
          <Field label="To Date" required error={x.toDate}><input type="date" value={r.toDate} min={r.fromDate} max={today()} onChange={(ev) => u({ toDate: ev.target.value })} /></Field>
          {r.participation.includes('Presented') && <Field label="Proceedings Indexed In"><Select value={r.proceedingsIndexed} onChange={(v) => u({ proceedingsIndexed: v })} options={['Scopus', 'Web of Science', 'Not Indexed']} /></Field>}
          <Field label="Funding"><Select value={r.funding} onChange={(v) => u({ funding: v, amountClaimed: v === 'Institution' ? r.amountClaimed : 0 })} options={FUNDING} /></Field>
          <Field label="Registration Fee (₹)"><NumberInput value={r.registrationFee} onChange={(v) => u({ registrationFee: v })} min={0} /></Field>
          <Field label="Amount Claimed from Institution (₹)" error={x.amountClaimed} hint="Registration + travel"><NumberInput value={r.amountClaimed} onChange={(v) => u({ amountClaimed: v })} min={0} disabled={r.funding !== 'Institution'} /></Field>
          <Field label="Award (if any)"><Input value={r.award} onChange={(v) => u({ award: v })} placeholder="e.g. Best Paper Award" /></Field>
          <Field label="Certificate" error={x.certificate} className="span2"><FileName value={r.certificateName} onChange={(v) => u({ certificateName: v })} accept=".pdf,.jpg,.png" /></Field>
        </div>
        <SaveBar onSave={e.save} isNew={e.isNew} resubmit={e.resubmit} />
      </Panel>
    </>
  );
}

// ---------------- Honours & Awards ----------------

export function AwardEntry() {
  const e = useEntry<Honour>('awards', () => ({
    category: 'Award', title: '', awardedBy: '', level: 'National', awardDate: '', citation: '', prizeAmount: 0, certificateName: '',
  }), (r, submit) => {
    const errs: Errors = {};
    required(errs, 'title', r.title.trim(), 'Name of the honour or award');
    required(errs, 'awardedBy', r.awardedBy.trim(), 'Conferred by');
    required(errs, 'awardDate', r.awardDate, 'Date received');
    if (r.awardDate > today()) errs.awardDate = 'Enter an honour after it has been received.';
    if (r.prizeAmount < 0) errs.prizeAmount = 'Prize amount cannot be negative.';
    if (submit && !r.certificateName) errs.certificate = 'Upload the certificate or letter before submitting.';
    return errs;
  });
  if (e.blocked) return <BlockedEntry msg={e.blocked} />;
  const { rec: r, update: u, errors: x } = e;
  return (
    <>
      <PageTitle sub={SUB}>{e.isNew ? 'Add Honour or Award' : `Edit Honour or Award ${e.rec.id}`}</PageTitle>
      {e.banner}
      <Panel title="Honour / Award Details" size="wide">
        <div className="grid">
          <Field label="Category" required><Select value={r.category} onChange={(v) => u({ category: v })} options={AWARD_CATEGORIES} /></Field>
          <Field label="Level" required><Select value={r.level} onChange={(v) => u({ level: v })} options={LEVELS} /></Field>
          <Field label="Date Received" required error={x.awardDate}><input type="date" value={r.awardDate} max={today()} onChange={(ev) => u({ awardDate: ev.target.value })} /></Field>
          <Field label="Prize / Honorarium (₹)" error={x.prizeAmount} hint="0 if none"><NumberInput value={r.prizeAmount} onChange={(v) => u({ prizeAmount: v })} min={0} /></Field>
          <Field label="Name of the Honour / Award" required error={x.title} className="span2"><Input value={r.title} onChange={(v) => u({ title: v })} /></Field>
          <Field label="Conferred By" required error={x.awardedBy} hint="Body, society, government or university" className="span2"><Input value={r.awardedBy} onChange={(v) => u({ awardedBy: v })} /></Field>
          <Field label="Citation / What it recognises" className="span3"><TextArea value={r.citation} onChange={(v) => u({ citation: v })} /></Field>
          <Field label="Certificate / Letter" error={x.certificate}><FileName value={r.certificateName} onChange={(v) => u({ certificateName: v })} accept=".pdf,.jpg,.png" /></Field>
        </div>
        <SaveBar onSave={e.save} isNew={e.isNew} resubmit={e.resubmit} />
      </Panel>
    </>
  );
}

// ---------------- Intellectual Property ----------------

/** One row of the IP submission form table: the label on the left, the answer on the right. */
function Row({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <tr>
      <th scope="row">{label}{required && <span className="req"> *</span>}{hint && <small>{hint}</small>}</th>
      <td>{children}{error && <span className="err" role="alert">{error}</span>}</td>
    </tr>
  );
}
/** Tick-one choices, shown like the boxes on the paper form. */
function Choice({ name, value, options, onChange }: { name: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="ipf-choice" role="radiogroup">
      {options.map((o) => (
        <label key={o}><input type="radio" name={name} checked={value === o} onChange={() => onChange(o)} /> {o}</label>
      ))}
    </div>
  );
}

export function IpEntry() {
  const { db, user } = useStore();
  const e = useEntry<IntellectualProperty>('ipr', () => ({
    ipType: '', ipTypeOther: '', title: '', description: '', stage: '', applicationNumber: '', filingDate: '', grantDate: '', office: '',
    owner: '', ownerOther: '', funding: '', licensed: false, licensee: '', coOwners: '', documentName: '', agreementName: '', declared: false,
  }), (r, submit) => {
    const errs: Errors = {};
    required(errs, 'ipType', r.ipType, 'Type of IP');
    if (r.ipType === 'Other') required(errs, 'ipType', r.ipTypeOther.trim(), 'The type of IP');
    required(errs, 'title', r.title.trim(), 'Title');
    required(errs, 'description', r.description.trim(), 'Brief description');
    if (wordCount(r.description) > IP_DESCRIPTION_WORDS) errs.description = `Keep it to ${IP_DESCRIPTION_WORDS} words (now ${wordCount(r.description)}).`;
    required(errs, 'stage', r.stage, 'Status');
    required(errs, 'applicationNumber', r.applicationNumber.trim(), 'Application / registration number');
    required(errs, 'filingDate', r.filingDate, 'Filing date');
    if (r.filingDate > today()) errs.filingDate = 'Enter it after it has been filed.';
    if (r.grantDate && r.filingDate && r.grantDate < r.filingDate) errs.grantDate = 'Cannot be before the filing date.';
    if (r.grantDate > today()) errs.grantDate = 'Cannot be in the future.';
    required(errs, 'office', r.office.trim(), 'Office / country');
    required(errs, 'owner', r.owner, 'Registered owner / applicant');
    if (r.owner === 'Other') required(errs, 'owner', r.ownerOther.trim(), 'The registered owner / applicant');
    if (r.licensed) required(errs, 'licensee', r.licensee.trim(), 'Partner name');
    const no = r.applicationNumber.trim().toLowerCase();
    const dup = no && getDB().ipr.find((x) => x.id !== r.id && x.applicationNumber.trim().toLowerCase() === no);
    if (dup) errs.applicationNumber = `This number is already entered as ${dup.id}.`;
    if (submit && !r.documentName) errs.document = 'Attach the filing receipt or registration certificate before submitting.';
    if (submit && !r.declared) errs.declared = 'Confirm the declaration before submitting.';
    return errs;
  });
  if (e.blocked) return <BlockedEntry msg={e.blocked} />;
  const { rec: r, update: u, errors: x } = e;
  const me = db.faculty.find((f) => f.id === (r.facultyId || user?.facultyId));
  const words = wordCount(r.description);
  return (
    <>
      <PageTitle sub="Patents, designs, copyrights and trademarks. The Office of Research checks the filing documents before approval.">{e.isNew ? 'Add Intellectual Property' : `Edit Intellectual Property ${e.rec.id}`}</PageTitle>
      {e.banner}
      <Panel size="wide">
        <p className="note" style={{ textAlign: 'center' }}>Fields marked <span className="req">*</span> are mandatory.</p>
        <div className="ipf">
          <h3>1. Submitter Details</h3>
          <table className="ipf-table"><tbody>
            <Row label="Full name" required><span className="ipf-fixed">{me ? `${me.title} ${me.name}` : '—'}</span></Row>
            <Row label="Employee ID" required><span className="ipf-fixed">{me?.id ?? '—'}</span></Row>
            <Row label="Department / school" required><span className="ipf-fixed">{me?.department ?? '—'}</span></Row>
            <Row label="Email" required><span className="ipf-fixed">{me?.email ?? '—'}</span></Row>
            <Row label="Co-inventors / co-creators" hint="(name, affiliation)"><TextArea value={r.coOwners} onChange={(v) => u({ coOwners: v })} /></Row>
          </tbody></table>
          <p className="ipf-note">Your details come from your profile. To change them, update your profile.</p>

          <h3>2. IP Details</h3>
          <table className="ipf-table"><tbody>
            <Row label="Type of IP" required error={x.ipType}>
              <Choice name="ipType" value={r.ipType} options={IP_TYPES} onChange={(v) => u({ ipType: v })} />
              {r.ipType === 'Other' && <div className="ipf-other">Other: <Input value={r.ipTypeOther} onChange={(v) => u({ ipTypeOther: v })} /></div>}
            </Row>
            <Row label="Title" required error={x.title}><Input value={r.title} onChange={(v) => u({ title: v })} /></Row>
            <Row label="Brief description" required hint={`(max. ${IP_DESCRIPTION_WORDS} words)`} error={x.description}>
              <TextArea value={r.description} onChange={(v) => u({ description: v })} />
              <span className={`ipf-count ${words > IP_DESCRIPTION_WORDS ? 'over' : ''}`}>{words} / {IP_DESCRIPTION_WORDS} words</span>
            </Row>
            <Row label="Status" required error={x.stage}><Choice name="stage" value={r.stage} options={IP_STATUSES} onChange={(v) => u({ stage: v })} /></Row>
            <Row label="Application / registration number" required error={x.applicationNumber}><Input value={r.applicationNumber} onChange={(v) => u({ applicationNumber: v })} /></Row>
            <Row label="Filing date" required error={x.filingDate}><input type="date" value={r.filingDate} max={today()} onChange={(ev) => u({ filingDate: ev.target.value })} /></Row>
            <Row label="Grant / registration date" error={x.grantDate}><input type="date" value={r.grantDate} min={r.filingDate || undefined} max={today()} onChange={(ev) => u({ grantDate: ev.target.value })} /></Row>
            <Row label="Office / country" required hint="(e.g., Indian Patent Office, USPTO, PCT)" error={x.office}><Input value={r.office} onChange={(v) => u({ office: v })} /></Row>
            <Row label="Registered owner / applicant" required error={x.owner}>
              <Choice name="owner" value={r.owner} options={IP_OWNERS} onChange={(v) => u({ owner: v })} />
              {r.owner === 'Other' && <div className="ipf-other">Other: <Input value={r.ownerOther} onChange={(v) => u({ ownerOther: v })} /></div>}
            </Row>
            <Row label="Funding source / sponsor" hint="(if any)"><Input value={r.funding} onChange={(v) => u({ funding: v })} /></Row>
            <Row label="Licensed or commercialised?" error={x.licensee}>
              <Choice name="licensed" value={r.licensed ? 'Yes' : 'No'} options={['Yes', 'No']} onChange={(v) => u({ licensed: v === 'Yes', licensee: v === 'Yes' ? r.licensee : '' })} />
              {r.licensed && <div className="ipf-other">If yes, partner name: <Input value={r.licensee} onChange={(v) => u({ licensee: v })} /></div>}
            </Row>
          </tbody></table>

          <h3>3. Attachments and Declaration</h3>
          <table className="ipf-table"><tbody>
            <Row label="Filing receipt or registration certificate" required error={x.document}><FileName value={r.documentName} onChange={(v) => u({ documentName: v })} accept=".pdf,.jpg,.png" /></Row>
            <Row label="Funding or ownership agreement" hint="(if applicable)"><FileName value={r.agreementName} onChange={(v) => u({ agreementName: v })} accept=".pdf,.jpg,.png" /></Row>
          </tbody></table>
          <label className="ipf-declare">
            <input type="checkbox" checked={r.declared} onChange={(ev) => u({ declared: ev.target.checked })} />
            <span>I confirm that the information above is accurate and that all co-inventors / co-creators have been listed.<span className="req"> *</span></span>
          </label>
          {x.declared && <span className="err" role="alert">{x.declared}</span>}
          <p className="ipf-note">Submitting this form records your name and the date in place of a signature.</p>
        </div>
        <SaveBar onSave={e.save} isNew={e.isNew} resubmit={e.resubmit} />
      </Panel>
    </>
  );
}
