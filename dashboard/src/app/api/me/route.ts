import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getUserPermissions } from "@/lib/rbac";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    allowed_clients: user.allowed_clients || [],
    allowed_industries: user.allowed_industries || [],
    permissions: getUserPermissions(user),
  });
}
