export const CONSOLE_EMAIL = "gouthamkrishnaronanki@gmail.com";

export function canAccessConsole(email?: string | null) {
  return email?.trim().toLowerCase() === CONSOLE_EMAIL;
}

export function consoleDevBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.QROUTER_DEV_AUTH_BYPASS === "true";
}
