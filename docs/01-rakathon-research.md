# Rakathon 2026 & ProstaPaper — research dossier

Compiled 2026-10-02 from rakathon.cz, the official rules PDF (not included in the public copy), MOÚ pages, Luma, partner university news and the 2025 edition coverage. Czech quotes are kept verbatim where wording matters for judging.

---

## 1. Event facts

| Item          | Value                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Event         | Rakathon 2026 — "Národní AI hackathon proti rakovině"                                                              |
| Dates         | Fri 16 – Sun 18 Oct 2026                                                                                           |
| Cities        | Prague (FN Motol a Homolka, 2. LF UK, ČVUT), **Brno (MOÚ, MUNI MED, VUT FEKT)**, Ostrava (FN Ostrava, VŠB-TUO)     |
| Organizer     | Insane Business Ideas s.r.o. (IČO 24818607), Tomáš Studeník / Caelestinus / CEE Hacks                              |
| Contacts      | info@rakathon.cz, info@ceehacks.com                                                                                |
| Team size     | 2–4 recommended (individuals allowed); 18+                                                                         |
| Participation | Free, but **selection by organizers** — registration ≠ place                                                       |
| Registration  | https://registrace.rakathon.cz/register — **Brno & Ostrava deadline extended to 6 Oct 2026** (Prague closed 1 Oct) |
| Prizes        | 1st 100 000 Kč, 2nd 50 000 Kč, 3rd 25 000 Kč, partner prizes "in preparation"                                      |
| Expected size | 500+ participants across 3 cities (2025: ~150 participants, 29 teams, one city)                                    |
| Patronage     | PM Andrej Babiš, Health Minister Adam Vojtěch, Gov. AI commissioner Lukáš Kačena                                   |
| Funding       | Prague City Hall                                                                                                   |

### Schedule

| When                | What                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Thu 15 Oct (online) | Expert session: tools & data sources you can use. Join — it's where they announce formats/data. |
| Fri 16 Oct 09:30    | Opening in all cities; registration, challenge presentations, meet mentors                      |
| Fri 16 Oct 12:00    | **Hacking starts** (24 h)                                                                       |
| Sat 17 Oct 12:00    | **Submission deadline**                                                                         |
| Sat 17 Oct 13:00    | Local pitching per city                                                                         |
| Sat 17 Oct 17:00    | Local TOP teams announced → advance to national final                                           |
| Sun 18 Oct 14:00    | National final, Kampus Plzeňská (2. LF UK, Prague) — re-pitch before main jury                  |
| Sun 18 Oct 17:00    | Overall winners announced                                                                       |

Implication: the actual build window is **24 hours** (Fri 12:00 → Sat 12:00), not 48. Everything must be pre-planned, scaffolded and deployable before Friday noon; only the challenge-specific data/logic should be left for the event.

---

## 2. The ProstaPaper challenge

**Zadavatel:** Masarykův onkologický ústav (MOÚ), Brno. Brno-only challenge.

Verbatim (rakathon.cz):

> Převeďte papírové schéma a textový popis karcinomu prostaty do dat, se kterými lze skutečně pracovat. Vytvořte AI řešení, které z patologického nálezu automaticky získá potřebné parametry a připraví je pro registr REDCap. Umožní tak systematicky porovnávat výsledky histologie s nálezy magnetické rezonance.

Translation: Convert the paper schema (diagram) and free-text description of prostate carcinoma into data you can actually work with. Build an AI solution that automatically extracts the needed parameters from the pathology report and prepares them for the REDCap registry. This enables systematic comparison of histology results with MRI findings.

### What's behind it (MOÚ context)

- MOÚ's **Centrum pro nádory prostaty** (head: doc. MUDr. Michal Staník, Ph.D.) does ~200 robot-assisted radical prostatectomies/year, plus MRI/fusion biopsy.
- They run the **COMPARE registry**: "registr pro průběžné porovnávání výsledků MR vyšetření a histologie u operovaných pacientů" — prostate MRI results compared with surgical (histopathology) outcomes. This is almost certainly the REDCap registry the challenge targets.
- Related research: **ProstaPilot** (NU22-09-00539, NCT05603351) — MRI screening with abbreviated biparametric protocol, PI-RADS ≥4 positive, >450 men enrolled; PI Staník, co-PI Ondřej Májek (IBA MU).
- Pathology: Oddělení onkologické patologie, head **MUDr. Iva Babánková**; MUDr. Pavel Fabian, Ph.D. Radiology: MUDr. Jan Křístek, Ph.D., MUDr. Miloš Pacal, MUDr. Michal Standara.
- MOÚ people on the Rakathon jury/mentor list: **MUDr. Jiří Šedo, Ph.D.** (deputy director, head of Centrum digitální medicíny MOÚ — _mentor AND judge_), **MUDr. Mgr. Martin Rusinko** (MOÚ oncologist + data science/AI researcher, IDEA4RC/SALVAGE/EMPOWER — mentor). Prof. Marek Svoboda (MOÚ director) gives a keynote.

### What the input most likely is

The "paper schema" is the pathologist's **hand-annotated prostate map** on the radical prostatectomy (or biopsy) report: a schematic of the gland (apex/mid/base × left/right, often PZ/TZ zones) where tumour foci, Gleason patterns, EPE, positive margins are drawn in by hand. The "textual description" is the free-text Czech histopathology report. MRI side already uses the **PI-RADS v2.1 sector map (41 sectors: 38 prostate, 2 seminal vesicles, 1 external urethral sphincter)** — so the natural target is to map histology into the same sector vocabulary so MRI lesion ↔ histology focus can be joined per sector.

Likely input formats: scanned PDF / photo of printed report with hand-drawn schema; possibly typed report text from the LIS. Expect **Czech medical language**, abbreviations, and inconsistent formatting between pathologists.

### Parameters a radical prostatectomy report carries (ICCR dataset)

Required (core):

- Histological tumour type (acinar adenocarcinoma, ductal, small cell, …)
- Gleason primary / secondary / tertiary grade, Gleason score → **ISUP Grade Group 1–5**
- Extraprostatic extension (EPE): not identified / present / indeterminate; extent focal / non-focal; location(s)
- Seminal vesicle invasion: involved / not / N/A
- Bladder neck involvement
- Margin status: involved / not / indeterminate; location(s); total extent (mm); Gleason at margin; type (EPE vs intraprostatic incision)
- Lymphovascular invasion
- Lymph nodes: number examined, number positive, laterality, largest deposit (mm)
- pTNM (pT2 / pT2a-c / pT3a / pT3b / pT4; pN0/1/X; pM)
- Specimen weight, dimensions, seminal vesicles present

Recommended (non-core):

- Pre-biopsy PSA, intraglandular extent (%), max size of dominant nodule (mm), tumour location(s) / index lesion location, multifocality

Biopsy reports (if those are also in scope) add: per-core site (sector), core length, cancer length / %, Gleason per core, perineural invasion, number of positive cores.

### REDCap target

- REDCap imports via **CSV** or the **API `import_records`** (CSV/JSON/XML). Variable names lowercase, no spaces, must match the project's **data dictionary**; each row keyed by `record_id` (plus `redcap_event_name` / `redcap_repeat_instrument` for longitudinal/repeating projects).
- We will not get MOÚ's real data dictionary before the event. Plan: ship our own REDCap data dictionary CSV (instrument "histopathology_rp" + "histopathology_sector") so the demo is end-to-end, and make the field mapping configurable so we can swap in theirs on Friday.
- Offer two outputs: (a) REDCap-ready CSV download, (b) direct push via REDCap API token (configurable URL).

---

## 3. Judging criteria (from the rules PDF, §8 "Hodnocení a ceny")

> Výstupy mohou být hodnoceny odbornou porotou podle kritérií stanovených pořadatelem. Kritéria mohou zahrnovat zejména:

1. **relevanci vůči výzvě** — relevance to the challenge
2. **inovativnost** — innovativeness
3. **technickou proveditelnost** — technical feasibility
4. **dopad na zdravotnictví** — impact on healthcare
5. **kvalitu prototypu** — prototype quality
6. **práci s daty** — work with data
7. **uživatelskou přívětivost** — user-friendliness
8. **implementační potenciál** — implementation potential
9. **kvalitu prezentace** — presentation quality

Jury decision is final; organizer may withhold prizes or disqualify for rule breaches. The organizer may also set a **mandatory submission format, deadline, pitch length and technical requirements** (§3) — not yet published; watch the Thursday online session and the event comms platform.

Two-stage judging: local jury Saturday, main jury Sunday. Known jury/mentors: prof. Tomáš Büchler (keynote, judge), Lukáš Kačena (judge), MUDr. Alina Pirshtuk (mentor, judge), **MUDr. Jiří Šedo (MOÚ, mentor + judge)**, prof. Aleksi Šedo (NÚVR, final jury), Martin Rusinko (MOÚ mentor), Jiří Netušil (mentor), MUDr. Majerčák, MUDr. Klimeš Lipánová (mentors).

### What won in 2025 (signals for what the jury rewards)

- **RadioProtect (1st, 50k):** novel method (3D CT-to-CT transform instead of 2D slices) filling a gap with "no similar control mechanism in clinical practice"; FN Motol oncology **signed on to deploy it** after the event.
- **RadMan (Hacker Prize):** PET scheduling as MILP; a **working deployed version existed** (radman.cz) by pitch time.
- **IOC / FIT ČVUT (3rd + Novartis prize):** breast cancer recurrence predictor built on **synthetic ÚZIS records** — i.e. no real patient data, still placed.

Takeaways: working end-to-end demo > slides; a crisp clinical gap statement; a believable path to deployment inside the hospital (who uses it, where it sits in the workflow); clean handling of data/privacy.

---

## 4. Other rules that shape our build (rules PDF §4–§7)

- **§4 Data:** No real patient data, medical records or sensitive data in the solution unless explicitly authorized in writing. If MOÚ hands over data, use only as instructed and delete/return afterwards. Outputs are prototypes, not medical devices — say so in the UI/pitch.
  → Build and demo on **synthetic / de-identified reports we author ourselves**; keep a toggle so MOÚ-provided samples can be loaded locally on event day without going to a cloud LLM if they object.
- **§5 IP:** We keep ownership but grant organizer + partners + challenge owners a **non-exclusive, royalty-free, worldwide, sublicensable** license to use, modify, publish and commercialize the output. Non-exclusive, so we can keep building it.
- **§6 OSS & AI tools:** Must comply with licenses of libraries/datasets/models/APIs; organizer may ask for a list of components used. Keep a `THIRD_PARTY.md` / SBOM-ish list. Don't push patient data into AI tools without authorization.
- **§7 Publicity:** No confidentiality; everything pitched may be public. Don't put secrets or anything patentable in the repo/pitch.
- **§10 Media:** Photos/videos of us can be used freely.

---

## 5. All 2026 challenges (for positioning and in case of pivot)

Shared (all cities), zadavatel VZP: Kvalita péče na konci života · Od pozvánky k mamografu · Jedna cesta klienta.

Prague: AI Trial Matching (FN Motol) · MEDDI ONCO Challenge (MEDDI Hub) · PACS Comparator Check (FN Motol) · Digitální hlídač nežádoucích účinků (FN Motol) · NÚVR Research Matchmaker (NÚVR) · SMART ONCO AA (VFN) · Twincer (Fuck Cancer).

**Brno:** Když realita překoná prognózu (FN Brno, dětská onkologie) · PillGaze (MOÚ) · **ProstaPaper (MOÚ)** · Vzkazy pro budoucnost (FN Olomouc) · TriaLink (MOÚ) · EduAIttractive (MOÚ).

Ostrava: Onkologický AI průvodce · AI asistent multidisciplinárního týmu · Chytřejší plánování onkologického stacionáře · **AI NOR** (registry extraction from clinical docs — closest cousin to ProstaPaper) · AI Surgical Copilot (FN Olomouc).

Note: "Jedna cesta klienta" (shared) and "AI NOR" (Ostrava) are also document-extraction-to-structured-data problems. Our extraction core should be generic enough that the pitch can mention reuse for those — that's "implementační potenciál".

---

## 6. Partners (logos on rakathon.cz)

Main partner: VZP ČR. Technology partners (logos): **Microsoft**, InterSystems, Asseco. Pharma: AstraZeneca, Bristol-Myers Squibb. Others: MEDDI, CzechInvest, WHO, ÚZIS, NÚVR, brno.ai, AVDZP, Mladí lékaři, Po medině, Akeso, CAUI, CNAIP, FBMI ČVUT, FEI VŠB, FEKT VUT, VFN, FN Ostrava, FN Motol a Homolka.

Microsoft as "hlavní technologický partner" suggests Azure credits / Azure OpenAI may be offered at the Thursday session. Our architecture is AWS-first; keep the LLM provider behind an interface so we can swap if Azure credits are the only free compute.

---

## 7. Open questions to resolve at the Thursday session / Friday briefing

1. Exact input samples: scanned PDFs? Photos? LIS text export? How many? Biopsy, prostatectomy, or both?
2. Is the "schema" a standard printed template (which one?) or free-hand?
3. MOÚ REDCap data dictionary for COMPARE — can we get the CSV export of the instrument?
4. Does MRI data (PI-RADS sector map, lesion list) already live in REDCap, and what key joins MRI ↔ histology (record_id = patient? per-lesion repeating instrument?)
5. Mandatory submission format, pitch length, demo rules.
6. Can MOÚ sample data leave the room (cloud LLM) or must inference be local?

---

## Sources

- https://www.rakathon.cz/ · https://www.rakathon.cz/eng · https://www.rakathon.cz/lide
- Rules PDF: https://bqcunktidwhqgkjnisbp.supabase.co/storage/v1/object/public/terms/terms/1782206443390-Rakathon_2026_pravidla_a_podminky_ucasti_2_.pdf
- https://luma.com/vyf6uavq · https://www.nuvr.cz/en/2026/09/04/ready-to-hack-cancer-6695/
- https://www.mou.cz/centrum-pro-nadory-prostaty/t1311 · https://www.mou.cz/mou-prostapilot/t1792 · https://www.mou.cz/oddeleni-onkologicke-patologie/t1365
- 2025 coverage: https://fel.cvut.cz/en/what-s-on/news/37553-... · https://fit.cvut.cz/en/life-at-fit/fit-live/success-stories/22708-... · https://www.fnmotol.cz/clanky/rakathon-2025/
- ICCR RP dataset: https://www.iccr-cancer.org/wp-content/uploads/attachments/ICCR-Prostate-Rad-Pros-1st-edn-v1-0-bookmark.pdf
- PI-RADS v2.1: https://geiselmed.dartmouth.edu/radiology/wp-content/uploads/sites/47/2024/04/PIRADS-V2.1_2019.pdf
- REDCap import: https://www.iths.org/wp-content/uploads/REDCap-Importing-Exporting-302.pdf · http://redcap-tools.github.io/PyCap/api_reference/records/
