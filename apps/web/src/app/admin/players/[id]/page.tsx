import { AdminFrame } from "../../AdminFrame";
import { AdminPlayer } from "./AdminPlayer";

export default async function AdminPlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminFrame>
      <AdminPlayer id={decodeURIComponent(id)} />
    </AdminFrame>
  );
}
