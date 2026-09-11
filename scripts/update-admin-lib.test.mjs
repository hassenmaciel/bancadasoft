import { describe,expect,it } from "vitest";
import { normalizeEmail,validateAdminEmail,validateAdminPassword,validateProductionDatabaseUrl } from "./update-admin-lib.mjs";

describe("admin credential validation",()=>{
  it("normalizes and validates email",()=>expect(validateAdminEmail(" Admin@Example.COM ")).toBe("admin@example.com"));
  it("rejects invalid email",()=>expect(()=>validateAdminEmail("invalid-email")).toThrow("e-mail válido"));
  it("accepts a strong test-only password",()=>expect(validateAdminPassword("Strong-Test-123!")).toBe("Strong-Test-123!"));
  it.each(["short","onlylowercase123!","ONLYUPPERCASE123!","WithoutNumber!","WithoutSymbol123"])("rejects weak password: %s",password=>expect(()=>validateAdminPassword(password)).toThrow());
  it("normalizes null safely",()=>expect(normalizeEmail(null)).toBe(""));
  it("accepts a remote PostgreSQL URL without exposing it",()=>expect(validateProductionDatabaseUrl("postgresql://user:secret@db.example.test:5432/app")).toContain("db.example.test"));
  it.each(["invalid","mysql://db.example.test/app","postgresql://user:pass@localhost:5432/app"])("rejects unsafe production database target: %s",value=>expect(()=>validateProductionDatabaseUrl(value)).toThrow());
});
