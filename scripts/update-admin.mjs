import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaClient } from "@prisma/client";
import { validateAdminEmail, validateAdminPassword, validateProductionDatabaseUrl } from "./update-admin-lib.mjs";
import { hashPassword } from "../src/lib/password.ts";

function readHidden(prompt) {
  if (!stdin.isTTY || !stdin.setRawMode) throw new Error("Execute este comando em um terminal interativo.");
  return new Promise((resolve,reject)=>{let value="";const finish=error=>{stdin.setRawMode(false);stdin.pause();stdin.removeListener("data",onData);stdout.write("\n");error?reject(error):resolve(value)};const onData=chunk=>{for(const char of String(chunk)){if(char==="\u0003")return finish(new Error("Operação cancelada."));if(char==="\r"||char==="\n")return finish();if(char==="\u007f"||char==="\b")value=value.slice(0,-1);else if(char>=" ")value+=char}};stdout.write(prompt);stdin.setEncoding("utf8");stdin.setRawMode(true);stdin.resume();stdin.on("data",onData)});
}

async function main(){
  const production=process.argv.includes("--production"),checkOnly=process.argv.includes("--check");
  if(!production)throw new Error("Ambiente não selecionado. Use obrigatoriamente --production.");
  stdout.write("Ambiente selecionado: PRODUCTION\n");
  const databaseUrl=validateProductionDatabaseUrl(await readHidden("Cole a DATABASE_URL de Production (entrada oculta): "));
  const prisma=new PrismaClient({datasources:{db:{url:databaseUrl}}});
  try{
    const admins=await prisma.user.findMany({where:{role:"ADMIN"},select:{id:true,email:true,role:true},orderBy:{createdAt:"asc"}});
    stdout.write("Banco acessível: SIM\n");
    stdout.write(`Identificador seguro do banco: ${createHash("sha256").update(databaseUrl).digest("hex").slice(0,12)}\n`);
    if(admins.length!==1)throw new Error(`Esperado exatamente 1 ADMIN; encontrados: ${admins.length}. Nenhum dado foi alterado.`);
    const current=admins[0];stdout.write("ADMIN encontrado: SIM\n");stdout.write(`E-mail atual do ADMIN: ${current.email}\n`);
    if(checkOnly){stdout.write("Modo somente leitura concluído. Nenhum dado foi alterado.\n");return}
    const confirmationReader=createInterface({input:stdin,output:stdout});
    const confirmation=await confirmationReader.question('Digite CONFIRMAR para continuar: ');confirmationReader.close();
    if(confirmation!=="CONFIRMAR")throw new Error("Confirmação recusada. Nenhum dado foi alterado.");
    const emailReader=createInterface({input:stdin,output:stdout});
    const newEmail=validateAdminEmail(await emailReader.question("Novo e-mail do ADMIN: "));emailReader.close();
    const newPassword=validateAdminPassword(await readHidden("Nova senha do ADMIN (entrada oculta): "));
    const passwordConfirmation=validateAdminPassword(await readHidden("Confirme a nova senha (entrada oculta): "));
    if(newPassword!==passwordConfirmation)throw new Error("As senhas não coincidem. Nenhum dado foi alterado.");
    const passwordHash=await hashPassword(newPassword);
    await prisma.$transaction(async tx=>{const conflict=await tx.user.findUnique({where:{email:newEmail},select:{id:true}});if(conflict&&conflict.id!==current.id)throw new Error("O novo e-mail já pertence a outro usuário. Nenhum dado foi alterado.");const unchanged=await tx.user.findUnique({where:{id:current.id},select:{email:true,role:true}});if(!unchanged||unchanged.email!==current.email||unchanged.role!=="ADMIN")throw new Error("O ADMIN foi alterado durante a operação. Nenhum dado foi modificado.");await tx.user.update({where:{id:current.id},data:{email:newEmail,passwordHash,role:"ADMIN"}})});
    stdout.write(`ADMIN atualizado com sucesso para: ${newEmail}\n`);
  }finally{await prisma.$disconnect()}
}

main().catch(error=>{console.error(error instanceof Error?error.message:"Não foi possível atualizar o ADMIN.");process.exitCode=1});
