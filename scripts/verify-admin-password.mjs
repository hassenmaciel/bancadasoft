import { createInterface } from "node:readline/promises";
import { stdin,stdout } from "node:process";
import { PrismaClient } from "@prisma/client";
import { isSupportedPasswordHash,verifyPassword } from "../src/lib/password.ts";
import { validateAdminEmail,validateProductionDatabaseUrl } from "./update-admin-lib.mjs";

function readHidden(prompt){if(!stdin.isTTY||!stdin.setRawMode)throw new Error("TTY_REQUIRED");return new Promise((resolve,reject)=>{let value="";const finish=error=>{stdin.setRawMode(false);stdin.pause();stdin.removeListener("data",onData);stdout.write("\n");error?reject(error):resolve(value)};const onData=chunk=>{for(const char of String(chunk)){if(char==="\u0003")return finish(new Error("CANCELLED"));if(char==="\r"||char==="\n")return finish();if(char==="\u007f"||char==="\b")value=value.slice(0,-1);else if(char>=" ")value+=char}};stdout.write(prompt);stdin.setEncoding("utf8");stdin.setRawMode(true);stdin.resume();stdin.on("data",onData)})}

async function main(){if(!process.argv.includes("--production"))throw new Error("PRODUCTION_REQUIRED");const databaseUrl=validateProductionDatabaseUrl(await readHidden("Cole a DATABASE_URL de Production (entrada oculta): "));const reader=createInterface({input:stdin,output:stdout});const email=validateAdminEmail(await reader.question("E-mail do ADMIN: "));reader.close();const password=await readHidden("Senha do ADMIN (entrada oculta): ");const prisma=new PrismaClient({datasources:{db:{url:databaseUrl}}});try{const admin=await prisma.user.findFirst({where:{email,role:"ADMIN"},select:{passwordHash:true}});const match=Boolean(admin&&isSupportedPasswordHash(admin.passwordHash)&&await verifyPassword(password,admin.passwordHash));stdout.write(`PASSWORD_MATCH: ${match?"YES":"NO"}\n`)}finally{await prisma.$disconnect()}}
main().catch(()=>{stdout.write("PASSWORD_MATCH: NO\n");process.exitCode=1});
