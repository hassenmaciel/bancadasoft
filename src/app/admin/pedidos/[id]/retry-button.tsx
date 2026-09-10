"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function RetryButton({orderId}:{orderId:string}){const router=useRouter();const[message,setMessage]=useState("");const[loading,setLoading]=useState(false);async function retry(){setLoading(true);setMessage("");const response=await fetch(`/api/admin/orders/${orderId}/retry`,{method:"POST"});const result=await response.json();setLoading(false);if(!response.ok)return setMessage(result.error??"Retry não permitido.");setMessage("Retry executado com sucesso.");router.refresh();}return <div className="retry-action"><button className="admin-primary" onClick={retry} disabled={loading}>{loading?"Executando...":"Tentar novamente"}</button>{message&&<small>{message}</small>}</div>}
