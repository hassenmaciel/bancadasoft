import type{Metadata}from"next";import GuestDelivery from"./guest-delivery";
export const metadata:Metadata={title:"Acompanhar pedido | BancadaSoft",robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{id:string}>}){return <GuestDelivery orderId={(await params).id}/>}
