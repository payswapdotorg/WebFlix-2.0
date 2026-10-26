import { redirect } from "next/navigation";

/** P58 — /tiktok/v without an id: back to the hub (honest entry). */
export default function Page() {
  redirect("/tiktok");
}
