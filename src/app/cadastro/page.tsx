"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { safeNextPath } from "@/lib/public-navigation";
import styles from "../login/login.module.css";

export default function RegisterPage() {
  const router=useRouter();const[error,setError]=useState("");const[loading,setLoading]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setLoading(true);setError("");const form=new FormData(event.currentTarget);const response=await fetch("/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:form.get("name"),email:form.get("email"),password:form.get("password")})});const body=await response.json();setLoading(false);if(!response.ok)return setError(body.error);router.push(safeNextPath(new URLSearchParams(window.location.search).get("next")));router.refresh();}
  return <main className={styles.page}><div className={styles.glow}/><section className={styles.card}><header className={styles.header}><Link href="/" className={styles.brand}>BANCADA<span>SOFT</span></Link><span className={styles.badge}>CADASTRO SEGURO</span></header><div className={styles.intro}><small>ÁREA DO CLIENTE</small><h1>Crie sua conta</h1><p>Consulte preços exclusivos e acompanhe seus pedidos.</p></div><form onSubmit={submit} className={styles.form}><label>Nome<input name="name" autoComplete="name" required minLength={2}/></label><label>E-mail<input name="email" type="email" autoComplete="email" required/></label><label>Senha<input name="password" type="password" autoComplete="new-password" minLength={12} required/><small>Use 12+ caracteres, maiúscula, minúscula, número e símbolo.</small></label>{error&&<p className={styles.error} role="alert">{error}</p>}<button disabled={loading}>{loading?"Criando...":"Criar conta"}</button></form><footer>Já tem conta? <Link href="/login">Entrar</Link></footer></section></main>;
}
