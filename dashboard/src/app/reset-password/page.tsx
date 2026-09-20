"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">Loading reset form...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = useMemo(() => String(params.get("token") || ""), [params]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-gray-800 border border-gray-700 rounded-lg p-6">
        <h1 className="text-xl font-semibold mb-4">Reset password</h1>
        <div className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (min 8 chars)"
            className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
          />
          {error && <div className="text-sm text-red-400">{error}</div>}
          {message && <div className="text-sm text-green-400">{message}</div>}
          <button
            onClick={async () => {
              setError("");
              setMessage("");
              if (!token) {
                setError("Missing reset token.");
                return;
              }
              if (password.length < 8) {
                setError("Password must be at least 8 characters.");
                return;
              }
              if (password !== confirmPassword) {
                setError("Passwords do not match.");
                return;
              }
              const res = await fetch("/api/auth/password-reset/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, password }),
              });
              const json = await res.json().catch(() => ({} as any));
              if (!res.ok) {
                setError(json?.error || "Reset failed.");
                return;
              }
              setMessage("Password reset successful. Redirecting to sign in...");
              setTimeout(() => router.push("/"), 1200);
            }}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded"
          >
            Reset password
          </button>
        </div>
      </div>
    </div>
  );
}
