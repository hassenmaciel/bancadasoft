export const LEGACY_ADMIN_EMAIL = "admin@bancadasoft.local";

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function validateAdminEmail(value) {
  const email = normalizeEmail(value);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido.");
  return email;
}

export function validateAdminPassword(value) {
  const password = String(value ?? "");
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error("A senha deve ter ao menos 12 caracteres, com maiúscula, minúscula, número e símbolo.");
  }
  return password;
}

export function validateProductionDatabaseUrl(value) {
  const databaseUrl=String(value??"").trim();
  let parsed;
  try{parsed=new URL(databaseUrl)}catch{throw new Error("DATABASE_URL de Production inválida.")}
  if(!["postgresql:","postgres:"].includes(parsed.protocol))throw new Error("DATABASE_URL deve usar PostgreSQL.");
  if(["localhost","127.0.0.1","::1"].includes(parsed.hostname))throw new Error("Banco local não é permitido neste comando de Production.");
  return databaseUrl;
}
