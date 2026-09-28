import type { Prisma } from "../generated/prisma/client.ts";

type FieldSeed = Omit<Prisma.FieldDefinitionCreateInput, "order">;

/**
 * Default profile fields. The first block comes from the college sheet
 * (`fromSeed`); the rest are filled in by students after they claim their
 * account. Admins can add, edit and reorder fields from the Control Center,
 * so this list only runs on an empty table.
 */
export const DEFAULT_FIELDS: FieldSeed[] = [
  // from the college sheet
  { key: "studentMobile", labelEn: "Mobile", labelBn: "মোবাইল", type: "phone", group: "Contact", defaultVisibility: "members", fromSeed: true },
  { key: "group", labelEn: "HSC Group", labelBn: "গ্রুপ", type: "select", options: ["Science", "Humanities", "Business Studies"], group: "College", isFilterable: true, filterUi: "chips", isEditableByUser: false, fromSeed: true },
  { key: "session", labelEn: "Session", labelBn: "সেশন", type: "select", options: ["2018-2019", "2019-2020"], group: "College", isFilterable: true, filterUi: "chips", isEditableByUser: false, fromSeed: true },
  { key: "fatherName", labelEn: "Father's name", labelBn: "বাবার নাম", type: "text", group: "Family", defaultVisibility: "admins", fromSeed: true },
  { key: "guardianMobile", labelEn: "Guardian mobile", labelBn: "অভিভাবকের মোবাইল", type: "phone", group: "Family", defaultVisibility: "admins", fromSeed: true },
  { key: "gender", labelEn: "Gender", labelBn: "লিঙ্গ", type: "select", options: ["Male", "Female"], group: "About", isEditableByUser: false, fromSeed: true },
  { key: "religion", labelEn: "Religion", labelBn: "ধর্ম", type: "select", options: ["Islam(Sunni)", "Islam(Shia)", "Hindu", "Buddhist", "Christian", "Other"], group: "About", defaultVisibility: "admins", fromSeed: true },
  { key: "academicYear", labelEn: "Academic year (sheet)", labelBn: "একাডেমিক বর্ষ", type: "text", group: "College", isEditableByUser: false, defaultVisibility: "admins", visibilityLocked: true, fromSeed: true },

  // filled in by students
  { key: "currentCity", labelEn: "Current city", labelBn: "বর্তমান শহর", type: "text", group: "Now", isFilterable: true, filterUi: "dropdown" },
  { key: "currentCountry", labelEn: "Country", labelBn: "দেশ", type: "text", group: "Now", isFilterable: true, filterUi: "dropdown" },
  { key: "hometown", labelEn: "Home district", labelBn: "নিজ জেলা", type: "text", group: "About", isFilterable: true, filterUi: "dropdown" },
  { key: "university", labelEn: "University", labelBn: "বিশ্ববিদ্যালয়", type: "text", group: "Study", isFilterable: true, filterUi: "dropdown" },
  { key: "department", labelEn: "Department / Subject", labelBn: "বিভাগ / বিষয়", type: "text", group: "Study", isFilterable: true, filterUi: "dropdown" },
  { key: "profession", labelEn: "Profession", labelBn: "পেশা", type: "text", group: "Work", isFilterable: true, filterUi: "dropdown" },
  { key: "organization", labelEn: "Organization", labelBn: "প্রতিষ্ঠান", type: "text", group: "Work", isFilterable: true, filterUi: "search" },
  { key: "askMeAbout", labelEn: "Ask me about", labelBn: "যে বিষয়ে সাহায্য করতে পারি", type: "tags", group: "Work", isFilterable: true, filterUi: "chips" },
  { key: "bloodGroup", labelEn: "Blood group", labelBn: "রক্তের গ্রুপ", type: "select", options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"], group: "About", isFilterable: true, filterUi: "chips" },
  { key: "dateOfBirth", labelEn: "Birthday", labelBn: "জন্মদিন", type: "date", group: "About" },
  { key: "email", labelEn: "Email", labelBn: "ইমেইল", type: "email", group: "Contact" },
  { key: "facebook", labelEn: "Facebook", labelBn: "ফেসবুক", type: "url", group: "Contact" },
  { key: "linkedin", labelEn: "LinkedIn", labelBn: "লিংকডইন", type: "url", group: "Contact" },
  { key: "about", labelEn: "About me", labelBn: "আমার সম্পর্কে", type: "textarea", group: "About" },
];

/** Maps college-sheet headers to field keys. SL, Photo and HSC Reg are not stored. */
export const SHEET_COLUMNS: Record<string, string> = {
  "Father's Name": "fatherName",
  Gender: "gender",
  Religion: "religion",
  "Student Mobile": "studentMobile",
  "Guardian Mobile": "guardianMobile",
  "Group/Department": "group",
  Session: "session",
  "Academic Year": "academicYear",
};
