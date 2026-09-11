import bcrypt from "bcryptjs";
export const PASSWORD_HASH_COST=12;
export function hashPassword(password:string){return bcrypt.hash(password,PASSWORD_HASH_COST)}
export function verifyPassword(password:string,passwordHash:string){return bcrypt.compare(password,passwordHash)}
export function isSupportedPasswordHash(passwordHash:string){return /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(passwordHash)}
