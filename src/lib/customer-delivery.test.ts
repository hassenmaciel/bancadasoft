import { describe,expect,it } from "vitest";
import { customerOrderState,hasCredentialDelivery } from "./customer-delivery";

describe("customer delivery presentation",()=>{
  it("shows payment confirmed before processing",()=>expect(customerOrderState("PAID","PAID")).toBe("Pagamento confirmado"));
  it("shows release processing",()=>expect(customerOrderState("PROCESSING","PAID","PROCESSING")).toBe("Processando liberação"));
  it("shows released access only for delivered order",()=>expect(customerOrderState("DELIVERED","PAID","FULFILLED")).toBe("Acesso liberado"));
  it("shows actionable failure",()=>expect(customerOrderState("FAILED","PAID","FAILED")).toBe("Falha — requer atenção"));
  it("requires both credentials",()=>{expect(hasCredentialDelivery({username:"user",password:"pass"})).toBe(true);expect(hasCredentialDelivery({username:"user"})).toBe(false);expect(hasCredentialDelivery({instructions:"text"})).toBe(false)});
});
