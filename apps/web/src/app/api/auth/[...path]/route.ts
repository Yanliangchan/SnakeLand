import type { NextRequest } from "next/server";
import { proxyToApi } from "@/lib/api-proxy";

export const dynamic = "force-dynamic";

export const GET = (req: NextRequest) => proxyToApi(req);
export const POST = (req: NextRequest) => proxyToApi(req);
