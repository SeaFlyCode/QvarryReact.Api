export const BASE_URL = process.env.E2E_API_URL || "http://localhost:3000";

export interface Creds {
  email: string;
  password: string;
}

function creds(emailVar: string, passVar: string): Creds | null {
  const email = process.env[emailVar];
  const password = process.env[passVar];
  return email && password ? { email, password } : null;
}

export const USER1 = creds("E2E_TEST_EMAIL", "E2E_TEST_PASSWORD");
export const USER2 = creds("E2E_TEST_EMAIL_2", "E2E_TEST_PASSWORD_2");
export const ADMIN = creds("E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD");

export const API = "/api/v1";
