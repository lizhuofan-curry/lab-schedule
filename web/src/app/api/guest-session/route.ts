import { GUEST_COOKIE } from "@/lib/server-auth";

export async function POST() {
  const response = Response.json({ data: { mode: "guest" } });
  response.headers.append("set-cookie", `${GUEST_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  return response;
}

export async function DELETE() {
  const response = Response.json({ data: { cleared: true } });
  response.headers.append("set-cookie", `${GUEST_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  return response;
}
