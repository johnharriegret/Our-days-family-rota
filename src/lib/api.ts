import { NextResponse } from "next/server";
import { AuthError } from "./session";

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function withApi(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthError) {
      return apiError(err.message, err.status);
    }
    console.error(err);
    return apiError("Something went wrong", 500);
  }
}
