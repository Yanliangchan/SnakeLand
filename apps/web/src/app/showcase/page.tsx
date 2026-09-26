import { notFound } from "next/navigation";
import { Showcase } from "./Showcase";

export default function ShowcasePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Showcase />;
}
