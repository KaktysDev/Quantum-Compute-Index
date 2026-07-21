export const QUANTUM_EXPERIENCE_LEVELS = [
  "exploring",
  "student",
  "researcher",
  "developer",
  "professional",
] as const;

export const WAITLIST_REFERRAL_SOURCES = [
  "linkedin",
  "search",
  "university",
  "colleague",
  "event",
  "other",
] as const;

export type WaitlistSubmission = {
  name: string;
  email: string;
  linkedinUrl: string;
  jobTitle: string;
  quantumExperience: typeof QUANTUM_EXPERIENCE_LEVELS[number];
  referralSource: typeof WAITLIST_REFERRAL_SOURCES[number];
};

type ValidationResult =
  | { ok: true; submission: WaitlistSubmission }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXPERIENCE_LEVELS = new Set<string>(QUANTUM_EXPERIENCE_LEVELS);
const REFERRAL_SOURCES = new Set<string>(WAITLIST_REFERRAL_SOURCES);

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function validateWaitlistSubmission(body: Record<string, unknown>): ValidationResult {
  const name = clean(body.name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const linkedinUrl = clean(body.linkedin, 500);
  const jobTitle = clean(body.jobTitle, 160);
  const quantumExperience = clean(body.quantumExperience, 40);
  const referralSource = clean(body.referralSource, 40);

  if (!name || !email || !linkedinUrl || !jobTitle || !quantumExperience || !referralSource) {
    return { ok: false, error: "Complete every field to join the waitlist." };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  let linkedin: URL;
  try {
    linkedin = new URL(linkedinUrl);
  } catch {
    return { ok: false, error: "Enter a valid LinkedIn profile URL." };
  }
  if (linkedin.protocol !== "https:" || !/(^|\.)linkedin\.com$/i.test(linkedin.hostname)) {
    return { ok: false, error: "Use an https://linkedin.com profile URL." };
  }
  if (!EXPERIENCE_LEVELS.has(quantumExperience) || !REFERRAL_SOURCES.has(referralSource)) {
    return { ok: false, error: "Choose a valid experience and referral option." };
  }

  return {
    ok: true,
    submission: {
      name,
      email,
      linkedinUrl: linkedin.toString(),
      jobTitle,
      quantumExperience: quantumExperience as WaitlistSubmission["quantumExperience"],
      referralSource: referralSource as WaitlistSubmission["referralSource"],
    },
  };
}
