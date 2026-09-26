"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "@/components/AppHeader";
import { Button, Card, Field } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { fadeUp } from "@/lib/motion";
import { useSession } from "@/providers/session";

type Mode = "sign-in" | "sign-up";

const MIN_PASSWORD = 10;

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const { me, refresh } = useSession();
  const isGuest = Boolean(me?.user.isGuest);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string; form?: string }>({});

  function validate() {
    const next: typeof errors = {};
    if (mode === "sign-up" && !name.trim()) next.name = "What should we call you?";
    if (mode === "sign-up" && name.trim().length > 32) next.name = "Keep it under 32 characters";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = "Enter a valid email";
    if (mode === "sign-up" && password.length < MIN_PASSWORD) next.password = `At least ${MIN_PASSWORD} characters`;
    if (mode === "sign-in" && !password) next.password = "Enter your password";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setPending(true);
    const res =
      mode === "sign-up"
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
    if (res.error) {
      setPending(false);
      // Deliberately generic on sign-in so we don't reveal which emails exist.
      setErrors({
        form:
          mode === "sign-in"
            ? res.error.status === 429
              ? "Too many attempts. Try again in a minute."
              : "Email or password is incorrect"
            : (res.error.message ?? "Couldn't create your account"),
      });
      return;
    }
    await refresh();
    router.replace("/");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center px-4 sm:px-6">
        <Wordmark />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <motion.h1 {...fadeUp} className="text-[32px] font-semibold leading-tight">
            {mode === "sign-up" ? (isGuest ? "Save your progress" : "Create account") : "Welcome back"}
          </motion.h1>
          <motion.p {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.05 }} className="mt-2 text-[15px] text-fg-muted">
            {mode === "sign-up"
              ? isGuest
                ? `Your ${me!.wallet.balance.toLocaleString()} chips come with you.`
                : "Virtual chips only. No card, no catch."
              : isGuest
                ? "Signing in switches to your account. Guest chips stay with the guest."
                : "Sign in to pick up where you left off."}
          </motion.p>

          <Card className="mt-8" transition={{ ...fadeUp.transition, delay: 0.1 }}>
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
              {mode === "sign-up" && (
                <Field
                  label="Name"
                  autoComplete="nickname"
                  maxLength={32}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  error={errors.name}
                />
              )}
              <Field
                label="Email"
                type="email"
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
              />
              <Field
                label="Password"
                type="password"
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
                hint={mode === "sign-up" ? `${MIN_PASSWORD}+ characters` : undefined}
              />
              <AnimatePresence>
                {errors.form && (
                  <motion.p {...fadeUp} role="alert" className="text-[14px] text-loss">
                    {errors.form}
                  </motion.p>
                )}
              </AnimatePresence>
              <Button type="submit" size="lg" block loading={pending}>
                {mode === "sign-up" ? "Create account" : "Sign in"}
              </Button>
            </form>
          </Card>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mt-6 text-center text-[14px] text-fg-muted"
          >
            {mode === "sign-up" ? "Already have an account? " : "New here? "}
            <Link href={mode === "sign-up" ? "/sign-in" : "/sign-up"} className="text-fg hover:underline">
              {mode === "sign-up" ? "Sign in" : "Create one"}
            </Link>
          </motion.p>
        </div>
      </main>
    </div>
  );
}
